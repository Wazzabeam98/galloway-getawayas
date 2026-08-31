import { stripeRequest } from '@/lib/stripe';
import { logError } from '@/lib/logError';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

// Stripe's own code for 'the connected account did not have the money'. It is
// the only failure that means the host genuinely owes us; everything else is
// a fault on our side or Stripe's, and must not be turned into a debt.
function isShortOfFunds(err: any): boolean {
    if (!err) return false;
    if (err.stripeCode === 'balance_insufficient') return true;
    return /insufficient/i.test(String(err.message || ''));
}

// What the host actually has sitting at Stripe right now, in pounds. Returns
// null if it cannot be read, which is different from zero.
async function availableAt(accountId: string): Promise<number | null> {
    try {
        const balance = await stripeRequest('GET', '/balance', undefined, undefined, accountId);
        const gbp = (balance && balance.available || []).find((b: any) => b.currency === 'gbp');
        return gbp ? round2(gbp.amount / 100) : 0;
    } catch (err) {
        return null;
    }
}

// How much of a payout we can actually pull back, in pounds.
//
// WHY `available` ON ITS OWN WAS THE WRONG QUESTION
//
// This used to be `available` and nothing else. That was written when a payout
// was an untied transfer out of the platform's settled balance, and it stopped
// being the whole story when lib/payoutSource.ts arrived: a payout now names
// the guest's charge as its `source_transaction`, which is what stopped the
// first real payout failing `balance_insufficient`. Stripe honours that by
// settling the transfer on the charge's own clock — so the money lands in the
// host's PENDING balance and sits there for about a week.
//
// The payout run goes the day after check-in. So for the whole week that
// matters, `available` reads £0 for every host — and a clawback in that window
// recovered nothing and wrote the entire amount up as a debt instead. Watched
// on the test project on 31 August 2026: £810 pending, £0 available, a £600
// refund, £540 carried forward as `payout_balance_owed` and not a penny
// reversed. The host is chased for money that is sitting right there, and if
// they never take another booking it is never recovered at all.
//
// WHY THE TOTAL BALANCE IS ALSO THE WRONG QUESTION
//
// `available + pending` looks like the obvious repair and it is not safe.
// A reversal unwinds the balance entry its own transfer created; it does not
// help itself to whatever else happens to be pending. Both halves of that were
// watched on the same accounts:
//
//   A transfer drawn on a charge, £0 available and £795 pending: the reversal
//   was ACCEPTED and came out of pending. £795 became £794 and available
//   stayed at £0. Nothing went negative.
//
//   An UNTIED transfer whose money had settled and been paid out to the bank:
//   the reversal was accepted against a total balance that looked healthy
//   because of other stays' pending money, and took the account to MINUS £270.
//   That is precisely the harm this file exists to prevent — Stripe then
//   absorbs it out of the next transfer we send, recovering the same money a
//   second time while our books show the host square.
//
// So the question is not "what has this host got", it is "is this particular
// payout still sitting where we put it". If the transfer's own entry on the
// connected account has not settled yet, the money is definitionally still
// there — unsettled money cannot have been paid out to a bank. If it has
// settled, the host may have spent it, and `available` is the honest limit.
//
// `spent` is the answer to a different question and has to stay separate from
// a shortfall: a transfer with nothing left un-reversed means the money has
// ALREADY come back, so there is nothing to recover and nothing owed either.
// Collapsing that into "reachable: 0" invents a debt out of a payout that was
// recovered in full — which is the one thing this file must never do.
interface Reversible {
    reachable: number | null;
    fullyReversed: boolean;
}

async function reversibleFrom(
    accountId: string,
    transferId: string
): Promise<Reversible> {
    const settled = await availableAt(accountId);

    try {
        const transfer = await stripeRequest('GET', '/transfers/' + transferId);
        const remaining = Number(transfer.amount || 0) - Number(transfer.amount_reversed || 0);
        if (!(remaining > 0)) return { reachable: 0, fullyReversed: true };

        // The charge this transfer created on the connected account. Without
        // it there is nothing to ask about, so fall back to the settled
        // balance — the cautious answer, and the old behaviour.
        const destinationPayment = transfer.destination_payment;
        if (!destinationPayment) return { reachable: settled, fullyReversed: false };

        const charge = await stripeRequest(
            'GET', '/charges/' + String(destinationPayment), undefined, undefined, accountId
        );
        const entryId = charge && charge.balance_transaction;
        if (!entryId) return { reachable: settled, fullyReversed: false };

        const entry = await stripeRequest(
            'GET', '/balance_transactions/' + String(entryId), undefined, undefined, accountId
        );

        if (entry && entry.status === 'pending') {
            // Still unsettled in the host's account. The reversal unwinds this
            // entry rather than drawing on the settled balance, so the whole
            // un-reversed remainder is reachable and nothing goes negative.
            return { reachable: round2(remaining / 100), fullyReversed: false };
        }

        return { reachable: settled, fullyReversed: false };
    } catch (err) {
        // A question we could not ask is not permission to assume the answer.
        // Fall back to the settled balance, which is what this did before any
        // of it existed.
        return { reachable: settled, fullyReversed: false };
    }
}

async function carryForward(admin: any, booking: any, amount: number, note: string): Promise<void> {
    // One statement, inside the database. This used to read the running total,
    // add to it here, and write it back — so a second debt arriving in that gap
    // was read from a stale value and overwritten. Two debts of £40 and £25
    // landing together left £40.
    const { error: adjustError } = await admin.rpc('adjust_payout_balance', {
        p_host: booking.host_id,
        p_delta: amount,
    });

    // A debt that failed to record is money we will never recover, and the
    // reversal above has already happened. It cannot be retried from here
    // without risking recording it twice, so it is reported instead.
    if (adjustError) {
        await logError('clawback: a shortfall could not be added to what the host owes', adjustError, {
            path: 'lib/clawback',
            userId: booking.host_id,
        });
    }

    await admin.from('payouts').insert({
        booking_id: booking.id,
        host_id: booking.host_id,
        amount: -amount,
        kind: 'reversal',
        status: 'owed',
        note: note,
    });
}

// Called when money goes back to a guest on a stay the host has already been
// paid for — a chargeback, a late goodwill refund, a host cancelling after
// check-in.
//
// Stripe will reverse a transfer whether or not the host can fund it. If they
// cannot, it does not refuse: it takes their connected account negative and
// quietly absorbs the difference out of the next transfer we send them. That
// is money recovered twice — once by Stripe silently, once by the payout run
// withholding against `payout_balance_owed` — and our books would show the
// host square the whole time.
//
// So we only ever reverse what they can actually fund, and carry the rest on
// `payout_balance_owed`, where the payout run can see it and a human can too.
// The connected account never goes negative and the debt lives in exactly one
// place.
//
// `reference` must be something unique to this particular clawback — the
// Stripe refund id is ideal. It goes into the idempotency key, so two refunds
// on one booking each reverse their own share.
export async function clawBackPayout(
    admin: any,
    booking: any,
    amount: number,
    reference?: string
): Promise<{ reversed: number; owed: number; failed: number }> {
    const target = round2(amount);
    if (target <= 0 || !booking.payout_transfer_id) {
        return { reversed: 0, owed: 0, failed: 0 };
    }

    const alreadyPaid = round2(Number(booking.payout_amount || 0));
    const toRecover = Math.min(target, alreadyPaid);

    if (toRecover <= 0) return { reversed: 0, owed: 0, failed: 0 };

    const { data: host } = await admin
        .from('profiles')
        .select('stripe_account_id')
        .eq('id', booking.host_id)
        .maybeSingle();

    // A balance we could not read must not silently become a debt, so an
    // unreadable one falls back to attempting the whole reversal and letting
    // Stripe answer.
    const reversible: Reversible = host && host.stripe_account_id
        ? await reversibleFrom(host.stripe_account_id, booking.payout_transfer_id)
        : { reachable: null, fullyReversed: false };

    // The payout has already been pulled back in full — a second refund on the
    // same stay, or a clawback repeated. There is nothing left to recover, and
    // the host owes nothing for money that is already back.
    if (reversible.fullyReversed) {
        return { reversed: 0, owed: 0, failed: 0 };
    }

    const available = reversible.reachable;

    const fundable = available === null
        ? toRecover
        : round2(Math.max(0, Math.min(toRecover, available)));
    const shortfall = round2(toRecover - fundable);

    try {
        if (fundable > 0) {
            await stripeRequest(
                'POST',
                '/transfers/' + booking.payout_transfer_id + '/reversals',
                { amount: Math.round(fundable * 100) },
                'clawback-' + booking.id + '-' + (reference || Math.round(toRecover * 100))
            );

            await admin.from('payouts').insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                amount: -fundable,
                kind: 'reversal',
                status: 'succeeded',
                stripe_transfer_id: booking.payout_transfer_id,
                note: shortfall > 0
                    ? 'All the host had at Stripe. £' + shortfall.toFixed(2) + ' carried forward'
                    : null,
            });
        }

        if (shortfall > 0) {
            await carryForward(
                admin, booking, shortfall,
                'The host’s Stripe balance was £' + shortfall.toFixed(2)
                    + ' short, carried to their next payout'
            );
        }

        return { reversed: fundable, owed: shortfall, failed: 0 };
    } catch (err: any) {
        // Only a genuine shortfall becomes money the host owes us. Anything
        // else — a bad transfer id, a reused key, Stripe being down — is our
        // problem to look at, and inventing a debt out of it would take money
        // off the host's next payout that they never owed.
        if (!isShortOfFunds(err)) {
            await logError('clawback: the reversal failed and was not a shortfall', err, {
                path: 'lib/clawback',
                userId: booking.host_id,
            });

            await admin.from('payouts').insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                amount: -toRecover,
                kind: 'reversal',
                status: 'failed',
                stripe_transfer_id: booking.payout_transfer_id,
                note: 'Reversal failed: ' + ((err && err.message) || 'unknown') + '. Not charged to the host.',
            });

            return { reversed: 0, owed: 0, failed: toRecover };
        }

        // Stripe says they were short after all — the balance moved between
        // reading it and reversing. Carry the whole amount.
        await carryForward(
            admin, booking, toRecover,
            'Could not be reversed at Stripe, carried to their next payout'
        );

        return { reversed: 0, owed: toRecover, failed: 0 };
    }
}
