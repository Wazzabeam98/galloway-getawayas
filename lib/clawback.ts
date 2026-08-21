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

// Called when money goes back to a guest on a stay the host has already been
// paid for — a chargeback, a late goodwill refund, a host cancelling after
// check-in.
//
// Stripe can pull a transfer back, but only out of the host's Stripe balance,
// and by then it may have moved on to their bank. A reversal that Stripe
// refuses for want of funds is expected rather than exceptional: the shortfall
// is recorded against the host and taken off their next payout instead.
//
// `reference` must be something unique to this particular clawback — the
// Stripe refund id is ideal. It goes into the idempotency key, so two refunds
// on one booking each reverse their own share. Keyed on the booking alone, the
// second reversal was either silently replayed (recovering nothing while
// recording success) or rejected by Stripe for reusing a key with different
// parameters, which the old catch-all then billed to the host as a debt.
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

    try {
        await stripeRequest(
            'POST',
            '/transfers/' + booking.payout_transfer_id + '/reversals',
            { amount: Math.round(toRecover * 100) },
            'clawback-' + booking.id + '-' + (reference || Math.round(toRecover * 100))
        );

        await admin.from('payouts').insert({
            booking_id: booking.id,
            host_id: booking.host_id,
            amount: -toRecover,
            kind: 'reversal',
            status: 'succeeded',
            stripe_transfer_id: booking.payout_transfer_id,
        });

        return { reversed: toRecover, owed: 0, failed: 0 };
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

        // Their balance couldn't cover it. Carry it forward.
        const { data: host } = await admin
            .from('profiles')
            .select('payout_balance_owed')
            .eq('id', booking.host_id)
            .maybeSingle();

        const owed = round2(Number((host && host.payout_balance_owed) || 0) + toRecover);

        await admin
            .from('profiles')
            .update({ payout_balance_owed: owed })
            .eq('id', booking.host_id);

        await admin.from('payouts').insert({
            booking_id: booking.id,
            host_id: booking.host_id,
            amount: -toRecover,
            kind: 'reversal',
            status: 'owed',
            note: 'Could not be reversed at Stripe, carried to their next payout',
        });

        return { reversed: 0, owed: toRecover, failed: 0 };
    }
}
