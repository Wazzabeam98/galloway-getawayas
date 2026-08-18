import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { freeCancelDateOrNull } from '@/lib/cancellation';
import { quoteBooking, totalsMatch, dateFromKey, dateKey } from '@/lib/pricing';

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
            .select('id, listing_id, guest_id, host_id, check_in, check_out, total_price, status, payment_status, adults, children, pets')
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
            .select('title, cancellation_policy, price_per_night, weekend_price, cleaning_fee, pet_fee, extra_guest_fee, max_guests')
            .eq('id', booking.listing_id)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'Listing not found' }, { status: 404 });
        }

        const checkIn = dateFromKey(booking.check_in);
        const checkOut = dateFromKey(booking.check_out);

        // ------------------------------------------------------------------
        // Nothing the browser sent about money is trusted. The price is worked
        // out again here, from the listing and the dates, and the payment is
        // only ever for this figure.
        // ------------------------------------------------------------------
        const { data: overrideRows } = await admin
            .from('calendar_overrides')
            .select('date, is_blocked, price_override')
            .eq('listing_id', booking.listing_id);

        const overrides: Record<string, number> = {};
        const blockedDates: Record<string, boolean> = {};
        (overrideRows || []).forEach(function (row: any) {
            const key = String(row.date).split('T')[0];
            if (row.price_override) overrides[key] = Number(row.price_override);
            if (row.is_blocked) blockedDates[key] = true;
        });

        const quote = quoteBooking(
            listing,
            overrides,
            checkIn,
            checkOut,
            Number(booking.adults || 0),
            Number(booking.children || 0),
            Number(booking.pets || 0)
        );

        if (quote.nights <= 0) {
            return NextResponse.json(
                { ok: false, error: 'Those dates don\u2019t make a valid stay.' },
                { status: 400 }
            );
        }

        const guestCount = Number(booking.adults || 0) + Number(booking.children || 0);
        if (listing.max_guests && guestCount > Number(listing.max_guests)) {
            return NextResponse.json(
                { ok: false, error: 'That is more guests than this place allows.' },
                { status: 400 }
            );
        }

        // The price shown in the browser is what the guest agreed to. If it no
        // longer matches, the booking stops rather than quietly charging a
        // different amount.
        if (!totalsMatch(quote.total, Number(booking.total_price))) {
            await admin
                .from('bookings')
                .update({ total_price: quote.total })
                .eq('id', booking.id);

            return NextResponse.json(
                {
                    ok: false,
                    error: 'The price for these dates has changed to \u00A3'
                        + quote.total.toFixed(2)
                        + '. Please refresh the page and book again.',
                },
                { status: 409 }
            );
        }

        // ------------------------------------------------------------------
        // Availability, settled here rather than in the browser — two guests
        // can be looking at the same free dates at the same time.
        // ------------------------------------------------------------------
        const cursor = new Date(checkIn.getTime());
        for (let i = 0; i < quote.nights; i++) {
            if (blockedDates[dateKey(cursor)]) {
                return NextResponse.json(
                    { ok: false, error: 'Those dates are no longer available.' },
                    { status: 409 }
                );
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        const { data: clashes } = await admin
            .from('bookings')
            .select('id')
            .eq('listing_id', booking.listing_id)
            .neq('id', booking.id)
            .in('status', ['pending', 'confirmed'])
            .lt('check_in', booking.check_out)
            .gt('check_out', booking.check_in);

        if (clashes && clashes.length > 0) {
            return NextResponse.json(
                { ok: false, error: 'Sorry \u2014 those dates have just been booked by someone else.' },
                { status: 409 }
            );
        }

        const total = quote.total;

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
