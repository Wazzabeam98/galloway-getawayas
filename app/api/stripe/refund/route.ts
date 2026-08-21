import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundFraction } from '@/lib/cancellation';
import { clawBackPayout } from '@/lib/clawback';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const bookingId: string = body && body.bookingId;
        const reason: string = (body && body.reason) || 'cancelled';

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, status, payment_status, total_price, amount_paid, amount_refunded, stripe_payment_intent_id, payout_transfer_id, payout_amount')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        const isHost = booking.host_id === session.user.id;
        const isGuest = booking.guest_id === session.user.id;

        if (!isHost && !isGuest) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        const paid = Number(booking.amount_paid || 0);
        const alreadyRefunded = Number(booking.amount_refunded || 0);
        const refundable = round2(paid - alreadyRefunded);

        // Nothing was ever taken, or it has all been given back already.
        // Not an error — the booking status change on its own is correct.
        if (!booking.stripe_payment_intent_id || refundable <= 0) {
            return NextResponse.json({ ok: true, refunded: 0, nothingToRefund: true });
        }

        // A host who declines or cancels never keeps the guest's money, whatever
        // the listing's cancellation tier says. A guest cancelling is the case
        // the tier exists for, so the policy decides how much comes back.
        let fraction = 1;
        if (isGuest && !isHost) {
            const { data: listing } = await admin
                .from('listings')
                .select('cancellation_policy')
                .eq('id', booking.listing_id)
                .maybeSingle();

            fraction = refundFraction(booking.check_in, listing && listing.cancellation_policy);
        }

        const amount = round2(refundable * fraction);

        // Inside the non-refundable part of the policy there is nothing to
        // send back, so no call is made to Stripe at all.
        if (amount <= 0) {
            return NextResponse.json({ ok: true, refunded: 0, nonRefundable: true });
        }

        const refund = await stripeRequest('POST', '/refunds', {
            payment_intent: booking.stripe_payment_intent_id,
            amount: Math.round(amount * 100),
            metadata: {
                booking_id: booking.id,
                reason: reason,
                initiated_by: isHost ? 'host' : 'guest',
            },
        });

        const totalRefunded = round2(alreadyRefunded + amount);
        const fullyRefunded = totalRefunded >= round2(paid);

        // Cancelling a stay a guest has already had confirmed is the most
        // damaging thing a host can do — they may have travel booked. A
        // declined request costs nothing, but a cancellation carries a fee,
        // taken off the host's next payout rather than invoiced.
        if (isHost && reason === 'cancelled' && booking.status === 'confirmed') {
            const penalty = round2(Number(booking.total_price || 0) * 0.05);

            if (penalty > 0) {
                const { data: hostProfile } = await admin
                    .from('profiles')
                    .select('payout_balance_owed')
                    .eq('id', booking.host_id)
                    .maybeSingle();

                await admin
                    .from('profiles')
                    .update({
                        payout_balance_owed: round2(
                            Number((hostProfile && hostProfile.payout_balance_owed) || 0) + penalty
                        ),
                    })
                    .eq('id', booking.host_id);

                await admin.from('payouts').insert({
                    booking_id: booking.id,
                    host_id: booking.host_id,
                    amount: -penalty,
                    kind: 'penalty',
                    status: 'owed',
                    note: 'Host cancelled a confirmed booking',
                });
            }
        }

        // The stay is called off here, in the same place the money moved, and
        // only once it has. This used to be left to the browser to do after the
        // route returned: a closed tab or a dropped connection left the guest
        // refunded while the booking still read as confirmed and the dates
        // stayed blocked. Nothing outside this route may set it now.
        const closingStatus =
            reason === 'declined' ? 'declined' : reason === 'cancelled' ? 'cancelled' : null;

        const patch: Record<string, any> = {
            amount_refunded: totalRefunded,
            payment_status: fullyRefunded ? 'refunded' : 'partially_refunded',
        };

        if (closingStatus) {
            patch.status = closingStatus;
            // Nothing further is owed on a stay that isn't happening, so the
            // balance charge can't pick it up.
            patch.balance_amount = 0;
        }

        const { error: updateError } = await admin
            .from('bookings')
            .update(patch)
            .eq('id', booking.id);

        // The guest's money has already gone back at this point, so a failure
        // here is the dangerous one — it is the case that used to be silent.
        if (updateError) {
            await logError('[stripe/refund] refunded but could not update the booking', updateError, {
                path: 'stripe/refund',
                userId: session.user.id,
            });
            return NextResponse.json(
                {
                    ok: false,
                    error: 'The refund went through but the booking could not be updated. '
                        + 'Please check it before trying again.',
                    refunded: amount,
                },
                { status: 500 }
            );
        }

        await admin.from('payments').insert({
            booking_id: booking.id,
            kind: 'refund',
            amount: amount,
            status: 'succeeded',
            stripe_payment_intent_id: booking.stripe_payment_intent_id,
        });

        // Recover the host's share if they have already been paid.
        if (booking.payout_transfer_id) {
            await clawBackPayout(admin, booking, amount, refund && refund.id);
        }

        return NextResponse.json({ ok: true, refunded: amount, refundId: refund && refund.id });
    } catch (err: any) {
        console.error('[stripe/refund]', err && err.message);
        await logError('[stripe/refund] ' + ((err && err.message) || 'failed'), err, { path: 'stripe/refund' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Refund failed' },
            { status: 500 }
        );
    }
}
