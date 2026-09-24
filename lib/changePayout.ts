// Paying the host their share of a booking change, when they have ALREADY been
// paid out for the stay.
//
// The payout cron pays a stay the day after check-in. If a change lands after
// that, the cron has already run and won't revisit the booking, so the extra has
// to be settled here:
//   * an INCREASE the guest just paid → send the host their share of the extra
//     (net of commission) as a top-up transfer, drawn from the guest's new
//     charge, and grow payout_amount so a later clawback knows the full total;
//   * a DECREASE is handled by the caller with the existing clawback engine.
// If the host is NOT yet paid out (`payout_transfer_id` is null), this does
// nothing and the payout cron pays the new, higher total in the normal way.

import { stripeRequest } from '@/lib/stripe';
import { netOfFee, DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';
import { logError } from '@/lib/logError';

function round2(v: number): number {
    return Math.round(Number(v || 0) * 100) / 100;
}

export async function topUpHostForIncrease(
    admin: any,
    bookingId: string,
    delta: number,
    changeId: string,
    chargePaymentIntentId: string | null,
): Promise<{ transferred: number }> {
    if (!(round2(delta) > 0)) return { transferred: 0 };

    const { data: booking } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, commission_rate, payout_transfer_id, payout_amount')
        .eq('id', bookingId)
        .maybeSingle();
    // Not paid out yet → leave it to the payout cron (it pays the new total).
    if (!booking || !booking.payout_transfer_id) return { transferred: 0 };

    const { data: listing } = await admin
        .from('listings').select('commission_rate').eq('id', booking.listing_id).maybeSingle();
    const rate = booking.commission_rate === null || booking.commission_rate === undefined
        ? (listing && listing.commission_rate !== null && listing.commission_rate !== undefined
            ? Number(listing.commission_rate) : DEFAULT_COMMISSION_PERCENT)
        : Number(booking.commission_rate);
    const hostShare = netOfFee(round2(delta), rate);
    if (hostShare <= 0) return { transferred: 0 };

    const { data: host } = await admin
        .from('profiles').select('stripe_account_id').eq('id', booking.host_id).maybeSingle();
    if (!host || !host.stripe_account_id) {
        await logError('[changePayout] host has no connected account — the extra could not be paid out, reconcile at Stripe', { booking: bookingId, change: changeId }, { path: 'lib/changePayout' });
        return { transferred: 0 };
    }

    // Draw the transfer from the guest's new charge so it doesn't come out of
    // unsettled platform balance (same reasoning as the payout cron).
    let source: string | null = null;
    if (chargePaymentIntentId) {
        try {
            const pi = await stripeRequest('GET', '/payment_intents/' + chargePaymentIntentId);
            source = (pi && pi.latest_charge) || null;
        } catch { /* fall back to an untied transfer */ }
    }

    try {
        const transfer = await stripeRequest('POST', '/transfers', {
            amount: Math.round(hostShare * 100),
            currency: 'gbp',
            destination: host.stripe_account_id,
            transfer_group: 'booking_' + bookingId,
            source_transaction: source || undefined,
            metadata: { booking_id: bookingId, host_id: booking.host_id, change_id: changeId, reason: 'change_topup', commission_percent: String(rate) },
        }, 'change-topup-' + changeId);

        await admin.from('payouts').insert({
            booking_id: bookingId, host_id: booking.host_id, amount: hostShare,
            kind: 'transfer', status: 'succeeded', stripe_transfer_id: transfer && transfer.id,
            note: 'Extra paid for a reservation change',
        });
        // Grow the total paid so a later clawback recovers against the right figure.
        await admin.from('bookings')
            .update({ payout_amount: round2(Number(booking.payout_amount || 0) + hostShare) })
            .eq('id', bookingId);
        return { transferred: hostShare };
    } catch (err) {
        await logError('[changePayout] top-up transfer failed after the guest paid — reconcile at Stripe', err, { path: 'lib/changePayout' });
        return { transferred: 0 };
    }
}
