import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { freeCancelDateOrNull } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

const DEPOSIT_FRACTION = 0.25;
const BALANCE_DAYS_BEFORE_CHECKIN = 30;

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

function pence(amount: number): number {
    return Math.round(amount * 100);
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
        const plan: string = (body && body.plan) === 'deposit' ? 'deposit' : 'full';

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, total_price, status, payment_status')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }
        if (booking.guest_id !== session.user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }
        if (booking.payment_status !== 'unpaid') {
            return NextResponse.json({ ok: false, error: 'This booking has already been paid' }, { status: 400 });
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title, cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const total = Number(booking.total_price);

        // A deposit only makes sense while there's time to collect the
        // balance. Inside the balance window it's the full amount.
        const balanceDue = new Date(booking.check_in);
        balanceDue.setDate(balanceDue.getDate() - BALANCE_DAYS_BEFORE_CHECKIN);
        const depositAllowed = balanceDue.getTime() > Date.now();

        const useDeposit = plan === 'deposit' && depositAllowed;
        const dueNow = useDeposit ? Math.round(total * DEPOSIT_FRACTION * 100) / 100 : total;
        const balance = Math.round((total - dueNow) * 100) / 100;

        // null when the free-cancellation window has already closed for
        // these dates, so nothing stores a date in the past.
        const freeUntil = freeCancelDateOrNull(booking.check_in, listing && listing.cancellation_policy);

        // A deposit is only workable if the balance can be taken automatically
        // 30 days before check-in, and only a card can be charged that way.
        // Klarna and the wallets are one-off agreements for the amount shown,
        // so they are offered on the pay-in-full path only.
        const methods = useDeposit
            ? ['card']
            : ['card', 'klarna', 'link'];

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: session.user.email,
            client_reference_id: booking.id,
            payment_method_types: methods,
            // Forced on the deposit path so there is always a customer to
            // charge the balance against later.
            customer_creation: useDeposit ? 'always' : 'if_required',
            success_url: SITE_URL + '/trips?paid=' + booking.id,
            cancel_url: SITE_URL + '/homes/' + booking.listing_id + '?cancelled=1',
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pence(dueNow),
                        product_data: {
                            name: (listing && listing.title) || 'Your stay',
                            description: useDeposit
                                ? 'Part payment now \u2014 the rest is charged 30 days before check-in'
                                : 'Full payment for your stay',
                        },
                    },
                },
            ],
            payment_intent_data: {
                // Saving the card is what lets the balance be taken later
                // without the guest having to do anything. Nothing further is
                // ever charged on a paid-in-full booking, so it is not saved
                // there.
                setup_future_usage: useDeposit ? 'off_session' : undefined,
                description: 'Galloway Getaways booking ' + booking.id,
                metadata: {
                    booking_id: booking.id,
                    kind: useDeposit ? 'deposit' : 'full',
                },
            },
            metadata: {
                booking_id: booking.id,
                kind: useDeposit ? 'deposit' : 'full',
            },
        });

        await admin
            .from('bookings')
            .update({
                payment_plan: useDeposit ? 'deposit' : 'full',
                deposit_amount: useDeposit ? dueNow : null,
                balance_amount: useDeposit ? balance : null,
                balance_due_date: useDeposit ? balanceDue.toISOString().split('T')[0] : null,
                free_cancel_until: freeUntil ? freeUntil.toISOString().split('T')[0] : null,
                status: 'pending_payment',
            })
            .eq('id', booking.id);

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        console.error('[stripe/checkout]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not start checkout' },
            { status: 500 }
        );
    }
}
