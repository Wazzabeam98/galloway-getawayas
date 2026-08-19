import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundFraction } from '@/lib/cancellation';
import { logError } from '@/lib/logError';

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

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, check_in, status, payment_status, amount_paid, amount_refunded, stripe_payment_intent_id, balance_amount')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        if (booking.guest_id !== session.user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        if (booking.status === 'cancelled' || booking.status === 'declined') {
            return NextResponse.json(
                { ok: false, error: 'This booking has already been cancelled.' },
                { status: 400 }
            );
        }

        // A stay that has started can't be called off from here — that's a
        // conversation with the host, not a button.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkIn = new Date(booking.check_in);
        checkIn.setHours(0, 0, 0, 0);

        if (checkIn.getTime() <= today.getTime()) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'This stay has already started or is starting today, so it can no longer be cancelled online. Please message your host.',
                },
                { status: 400 }
            );
        }

        const { data: listing } = await admin
            .from('listings')
            .select('cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const paid = Number(booking.amount_paid || 0);
        const alreadyRefunded = Number(booking.amount_refunded || 0);
        const refundable = round2(paid - alreadyRefunded);
        const fraction = refundFraction(booking.check_in, listing && listing.cancellation_policy);
        const amount = round2(refundable * fraction);

        // The money goes back before the booking changes. If Stripe refuses,
        // the guest still has their stay rather than neither.
        if (amount > 0 && booking.stripe_payment_intent_id) {
            try {
                await stripeRequest(
                    'POST',
                    '/refunds',
                    {
                        payment_intent: booking.stripe_payment_intent_id,
                        amount: Math.round(amount * 100),
                        metadata: {
                            booking_id: booking.id,
                            reason: 'guest_cancelled',
                            initiated_by: 'guest',
                        },
                    },
                    'guest-cancel-' + booking.id
                );
            } catch (err: any) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'We couldn\u2019t process your refund, so the booking has been left as it is. Please try again or message your host.',
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
        }

        const totalRefunded = round2(alreadyRefunded + amount);

        await admin
            .from('bookings')
            .update({
                status: 'cancelled',
                amount_refunded: totalRefunded,
                payment_status:
                    totalRefunded <= 0
                        ? booking.payment_status
                        : totalRefunded >= round2(paid)
                            ? 'refunded'
                            : 'partially_refunded',
                // Nothing further is owed on a stay that isn't happening, so
                // the balance charge won't pick it up.
                balance_amount: 0,
            })
            .eq('id', booking.id);

        return NextResponse.json({ ok: true, refunded: amount });
    } catch (err: any) {
        console.error('[bookings/cancel]', err && err.message);
        await logError('[bookings/cancel] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/cancel' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not cancel' },
            { status: 500 }
        );
    }
}
