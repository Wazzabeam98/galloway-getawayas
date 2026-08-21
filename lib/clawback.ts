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

async function carryForward(admin: any, booking: any, amount: number, note: string): Promise<void> {
    const { data: host } = await admin
        .from('profiles')
        .select('payout_balance_owed')
        .eq('id', booking.host_id)
        .maybeSingle();

    const owed = round2(Number((host && host.payout_balance_owed) || 0) + amount);

    await admin.from('profiles').update({ payout_balance_owed: owed }).eq('id', booking.host_id);

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
    const available = host && host.stripe_account_id
        ? await availableAt(host.stripe_account_id)
        : null;

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
