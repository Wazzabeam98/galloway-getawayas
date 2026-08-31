import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundDue } from '@/lib/cancellation';
import { clawBackPayout } from '@/lib/clawback';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie and never checks its signature, so the id it returns is
        // whatever the caller wrote there — a forged cookie carrying anyone's
        // id is accepted. This route moves money, so the identity it acts on
        // has to be verified against the auth server, which getUser() does.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
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
            .select('id, listing_id, guest_id, host_id, check_in, status, payment_status, total_price, amount_paid, amount_refunded, cleaning_fee, stripe_payment_intent_id, payout_transfer_id, payout_amount')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        const isHost = booking.host_id === user.id;
        const isGuest = booking.guest_id === user.id;

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
        const hostCancelling = !(isGuest && !isHost);

        let policy: string | null = null;
        if (!hostCancelling) {
            const { data: listing } = await admin
                .from('listings')
                .select('cancellation_policy')
                .eq('id', booking.listing_id)
                .maybeSingle();

            policy = (listing && listing.cancellation_policy) || null;
        }

        // One rule, in lib/cancellation.ts, shared with /api/bookings/cancel,
        // the balance job and the two screens that show a guest or a host what
        // a cancellation would return. It was written out separately in each
        // of those, which is how a predicted figure and a refunded one drift
        // apart.
        const amount = refundDue({
            amountPaid: paid,
            alreadyRefunded: alreadyRefunded,
            cleaningFee: booking.cleaning_fee,
            checkIn: booking.check_in,
            policy: policy,
            hostCancelling: hostCancelling,
        });

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
                // One statement, inside the database. Read-add-write here meant
                // a clawback landing at the same moment overwrote this penalty,
                // or was overwritten by it.
                const { error: penaltyError } = await admin.rpc('adjust_payout_balance', {
                    p_host: booking.host_id,
                    p_delta: penalty,
                });

                if (penaltyError) {
                    await logError('refund: a cancellation penalty was not added to what the host owes', penaltyError, {
                        path: 'api/stripe/refund',
                        userId: booking.host_id,
                    });
                }

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

            // Who did this, in our own records rather than only in the
            // metadata on the Stripe refund. The 5% fee below turns on
            // exactly this distinction, so the first time a host disputes one
            // the answer has to be somewhere we can read it.
            patch.cancelled_at = new Date().toISOString();
            patch.cancelled_by_user = user.id;
            patch.cancelled_by_role = isHost ? 'host' : 'guest';
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
                userId: user.id,
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
