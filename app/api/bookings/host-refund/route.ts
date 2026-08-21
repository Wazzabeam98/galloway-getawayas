import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { clawBackPayout } from '@/lib/clawback';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
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

// A host giving money back without calling the stay off — something went
// wrong, the guest is still coming, and the host decides what that's worth.
// The platform doesn't judge the amount; it just moves the money and takes it
// off what the host is eventually paid.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const bookingId: string = body && body.bookingId;
        const requested = Number(body && body.amount);

        if (!bookingId || !requested || isNaN(requested) || requested <= 0) {
            return NextResponse.json(
                { ok: false, error: 'Enter an amount to refund.' },
                { status: 400 }
            );
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

        if (booking.host_id !== session.user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        const paid = round2(Number(booking.amount_paid || 0));
        const alreadyRefunded = round2(Number(booking.amount_refunded || 0));
        const refundable = round2(paid - alreadyRefunded);

        if (refundable <= 0) {
            return NextResponse.json(
                { ok: false, error: 'There is nothing left to refund on this booking.' },
                { status: 400 }
            );
        }

        const amount = round2(requested);

        if (amount > refundable) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'That is more than the £' + refundable.toFixed(2) + ' the guest has paid.',
                },
                { status: 400 }
            );
        }

        if (!booking.stripe_payment_intent_id) {
            return NextResponse.json(
                { ok: false, error: 'No payment was found for this booking.' },
                { status: 400 }
            );
        }

        const refund = await stripeRequest(
            'POST',
            '/refunds',
            {
                payment_intent: booking.stripe_payment_intent_id,
                amount: Math.round(amount * 100),
                metadata: {
                    booking_id: booking.id,
                    reason: 'host_goodwill',
                    initiated_by: 'host',
                },
            },
            // Distinct per amount, so a host can refund twice if they choose to
            // but a double-click can't.
            'host-refund-' + booking.id + '-' + Math.round(amount * 100)
        );

        await admin.from('payments').insert({
            booking_id: booking.id,
            kind: 'refund',
            amount: amount,
            status: 'succeeded',
            stripe_payment_intent_id: booking.stripe_payment_intent_id,
        });

        const totalRefunded = round2(alreadyRefunded + amount);

        // The stay is still happening, so the status is left alone. Only the
        // money changes.
        await admin
            .from('bookings')
            .update({
                amount_refunded: totalRefunded,
                payment_status: totalRefunded >= paid ? 'refunded' : 'partially_refunded',
            })
            .eq('id', booking.id);

        // If they've already been paid for this stay, recover it.
        if (booking.payout_transfer_id) {
            await clawBackPayout(admin, booking, amount, refund && refund.id);
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const { data: guestUser } = await admin.auth.admin.getUserById(booking.guest_id);
        const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';

        if (guestEmail) {
            await sendEmail(
                guestEmail,
                'Your host has refunded you \u00A3' + amount.toFixed(2),
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Your host has sent back <strong>\u00A3'
                        + amount.toFixed(2)
                        + '</strong> on your stay at <strong>'
                        + escapeHtml((listing && listing.title) || 'their place')
                        + '</strong>.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">It goes back to the card you paid with, usually within five to ten days. Your booking is unchanged and your stay is going ahead as planned.</p>'
                        + button(SITE_URL + '/trips', 'View your trip'),
                    'You\u2019re receiving this because you have a booking with Galloway Getaways.'
                )
            );
        }

        return NextResponse.json({ ok: true, refunded: amount, remaining: round2(refundable - amount) });
    } catch (err: any) {
        console.error('[bookings/host-refund]', err && err.message);
        await logError('[bookings/host-refund] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/host-refund' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not process the refund' },
            { status: 500 }
        );
    }
}
