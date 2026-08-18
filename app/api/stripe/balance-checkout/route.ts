import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
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
            .select('id, listing_id, guest_id, balance_amount, payment_status, status')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }
        if (booking.guest_id !== session.user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }
        if (booking.payment_status !== 'deposit_paid') {
            return NextResponse.json(
                { ok: false, error: 'There is nothing left to pay on this booking.' },
                { status: 400 }
            );
        }
        if (booking.status === 'cancelled' || booking.status === 'declined') {
            return NextResponse.json(
                { ok: false, error: 'This booking has been cancelled.' },
                { status: 400 }
            );
        }

        const amount = Math.round(Number(booking.balance_amount || 0) * 100);
        if (amount <= 0) {
            return NextResponse.json(
                { ok: false, error: 'There is nothing left to pay on this booking.' },
                { status: 400 }
            );
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title')
            .eq('id', booking.listing_id)
            .maybeSingle();

        // A fresh card is the whole point here — the saved one is what failed.
        // Nothing is charged again after this, so nothing needs saving.
        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: session.user.email,
            client_reference_id: booking.id,
            payment_method_types: ['card', 'klarna', 'link'],
            success_url: SITE_URL + '/trips?paid=' + booking.id,
            cancel_url: SITE_URL + '/trips?cancelled=' + booking.id,
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: amount,
                        product_data: {
                            name: (listing && listing.title) || 'Your stay',
                            description: 'Remaining balance for your stay',
                        },
                    },
                },
            ],
            payment_intent_data: {
                description: 'Galloway Getaways balance ' + booking.id,
                metadata: {
                    booking_id: booking.id,
                    kind: 'balance',
                },
            },
            metadata: {
                booking_id: booking.id,
                kind: 'balance',
            },
        });

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        console.error('[stripe/balance-checkout]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not open the payment page' },
            { status: 500 }
        );
    }
}
