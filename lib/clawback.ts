import { stripeRequest } from '@/lib/stripe';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

// Called when money goes back to a guest on a stay the host has already been
// paid for — a chargeback, a late goodwill refund, a host cancelling after
// check-in.
//
// Stripe can pull a transfer back, but only out of the host's Stripe balance,
// and by then it has usually moved on to their bank. So a failed reversal is
// expected rather than exceptional: the shortfall is recorded against the host
// and taken off their next payout instead.
export async function clawBackPayout(
    admin: any,
    booking: any,
    amount: number
): Promise<{ reversed: number; owed: number }> {
    const target = round2(amount);
    if (target <= 0 || !booking.payout_transfer_id) {
        return { reversed: 0, owed: 0 };
    }

    const alreadyPaid = round2(Number(booking.payout_amount || 0));
    const toRecover = Math.min(target, alreadyPaid);

    if (toRecover <= 0) return { reversed: 0, owed: 0 };

    try {
        await stripeRequest(
            'POST',
            '/transfers/' + booking.payout_transfer_id + '/reversals',
            { amount: Math.round(toRecover * 100) },
            'clawback-' + booking.id
        );

        await admin.from('payouts').insert({
            booking_id: booking.id,
            host_id: booking.host_id,
            amount: -toRecover,
            kind: 'reversal',
            status: 'succeeded',
            stripe_transfer_id: booking.payout_transfer_id,
        });

        return { reversed: toRecover, owed: 0 };
    } catch (err: any) {
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

        return { reversed: 0, owed: toRecover };
    }
}
