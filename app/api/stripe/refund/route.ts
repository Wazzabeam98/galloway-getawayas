import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundFraction } from '@/lib/cancellation';
import { clawBackPayout } from '@/lib/clawback';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

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
            .select('id, listing_id, guest_id, host_id, check_in, status, payment_status, amount_paid, amount_refunded, stripe_payment_intent_id, payout_transfer_id, payout_amount')
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

        await admin
            .from('bookings')
            .update({
                amount_refunded: totalRefunded,
                payment_status: fullyRefunded ? 'refunded' : 'partially_refunded',
            })
            .eq('id', booking.id);

        await admin.from('payments').insert({
            booking_id: booking.id,
            kind: 'refund',
            amount: amount,
            status: 'succeeded',
            stripe_payment_intent_id: booking.stripe_payment_intent_id,
        });

        // Recover the host's share if they have already been paid.
        if (booking.payout_transfer_id) {
            await clawBackPayout(admin, booking, amount);
        }

        return NextResponse.json({ ok: true, refunded: amount, refundId: refund && refund.id });
    } catch (err: any) {
        console.error('[stripe/refund]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Refund failed' },
            { status: 500 }
        );
    }
}
