import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { stripeRequest } from '@/lib/stripe';
import { returnUrl } from '@/lib/email';
import { requireGuestTerms } from '@/lib/agreementRecords';
import { anonGuestTermsMetadata } from '@/lib/agreements';
import { DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';
import { nightsBetween, dateFromKey } from '@/lib/pricing';
import { hotelsOpen } from '@/lib/hotels';
import { quoteHotelStay } from '@/lib/hotelPricing';
import { roomsAvailable } from '@/lib/hotelAvailability';

export const dynamic = 'force-dynamic';

// Booking one hotel room type — the hotel twin of /api/stripe/checkout.
//
// A hotel stay becomes a NORMAL bookings row so the whole money path downstream
// is reused unchanged: this route recomputes the price server-side (a browser
// total is never trusted), counts the rooms free for the dates, takes the guest
// terms, creates the bookings row (room_type_id set, listing_id NULL, paid in
// full in phase one), and opens a Stripe Checkout Session with
// metadata.booking_id + kind 'full'. The existing webhook then settles it
// through lib/settlePaidBooking exactly as a cottage stay — the only hotel-aware
// line there is the instant-book/title branch for a listing-less booking.
//
// Held behind hotelsOpen(): a direct POST is refused the same as a hidden panel.

function pence(amount: number): number {
    return Math.round(amount * 100);
}

export async function POST(request: Request) {
    try {
        if (!hotelsOpen()) {
            return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });
        }

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json();
        const roomTypeId: string = body && body.roomTypeId;
        const checkIn: string = body && body.checkIn;
        const checkOut: string = body && body.checkOut;
        const adults = Math.max(1, Math.floor(Number(body && body.adults) || 1));
        const children = Math.max(0, Math.floor(Number(body && body.children) || 0));

        if (!roomTypeId || !checkIn || !checkOut) {
            return NextResponse.json({ ok: false, error: 'Pick a room, and your dates.' }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
            return NextResponse.json({ ok: false, error: 'Those dates are not valid.' }, { status: 400 });
        }
        const nights = nightsBetween(dateFromKey(checkIn), dateFromKey(checkOut));
        if (nights < 1) {
            return NextResponse.json({ ok: false, error: 'Check-out must be after check-in.' }, { status: 400 });
        }

        const admin = adminClient();

        // The room type, its hotel, and the host who is paid. Read by the service
        // role — a co-host is not the host_id, so RLS would hide rows.
        const { data: roomType } = await admin
            .from('hotel_room_types')
            .select('id, hotel_id, name, inventory_count, max_adults, max_children, max_occupancy, price_per_night, min_nights, active, hotels ( id, owner_id, name, status, cancellation_policy, cancellation_custom_days, commission_rate )')
            .eq('id', roomTypeId)
            .maybeSingle();

        const hotel = roomType && (roomType as any).hotels;
        if (!roomType || !hotel) {
            return NextResponse.json({ ok: false, error: 'No such room.' }, { status: 404 });
        }
        if (hotel.status !== 'published' || roomType.active !== true) {
            return NextResponse.json({ ok: false, error: 'That room is not open for booking.' }, { status: 400 });
        }

        // Occupancy and the room's own minimum stay, the same rules the room-type
        // editor set and the booking panel shows — enforced here as the authority.
        if (adults > roomType.max_adults || children > roomType.max_children || adults + children > roomType.max_occupancy) {
            return NextResponse.json({ ok: false, error: 'That is more guests than this room sleeps.' }, { status: 400 });
        }
        if (nights < (roomType.min_nights || 1)) {
            return NextResponse.json({ ok: false, error: `This room has a minimum stay of ${roomType.min_nights} night(s).` }, { status: 400 });
        }

        // The room-type calendar: any night the owner CLOSED blocks the booking,
        // and seasonal price overrides are applied to the quote below.
        const { data: overrideRows } = await admin
            .from('hotel_room_overrides')
            .select('date, is_blocked, price_override')
            .eq('room_type_id', roomType.id)
            .gte('date', checkIn)
            .lt('date', checkOut);
        const priceOverrides: Record<string, number> = {};
        let anyBlocked = false;
        (overrideRows || []).forEach((r: any) => {
            const key = String(r.date).slice(0, 10);
            if (r.is_blocked) anyBlocked = true;
            if (r.price_override != null) priceOverrides[key] = Number(r.price_override);
        });
        if (anyBlocked) {
            return NextResponse.json({ ok: false, error: 'Sorry — that room is closed for one of those nights.' }, { status: 409 });
        }

        // Are there rooms of this type free across every night? (Counting, not
        // the cottage uniqueness constraint — lib/hotelAvailability.)
        const avail = await roomsAvailable(admin, { id: roomType.id, inventory_count: roomType.inventory_count }, checkIn, checkOut, 1);
        if (!avail.available) {
            return NextResponse.json({ ok: false, error: 'Sorry — that room is no longer free for those dates.' }, { status: 409 });
        }

        // The guest terms wall, on the server (lib/agreementRecords) — the same
        // one the cottage checkout uses. The current version is already on record,
        // or the tick sent with this request is recorded now, before any Stripe
        // session exists.
        const terms = await requireGuestTerms(
            admin,
            user.id,
            body && typeof body.guestTermsVersion === 'string' ? body.guestTermsVersion : null,
            'hotel_checkout',
        );
        if (!terms.ok) return NextResponse.json(terms.body, { status: terms.status });
        const guestTermsMeta = anonGuestTermsMetadata(terms.stamp!);

        // Recompute the price from the room type, with any seasonal overrides.
        // The browser never sets the total.
        const quote = quoteHotelStay({ price_per_night: Number(roomType.price_per_night) }, checkIn, checkOut, 1, priceOverrides);

        // Commission is frozen onto the booking now (hotel's rate, else the 10%
        // default), exactly as a cottage freezes rateFor(listing). The payout
        // cron reads this stamp, never the hotel as it stands later.
        const commissionRate = hotel.commission_rate !== null && hotel.commission_rate !== undefined
            ? Number(hotel.commission_rate)
            : DEFAULT_COMMISSION_PERCENT;

        const { data: booking, error: insertError } = await admin
            .from('bookings')
            .insert({
                listing_id: null,
                room_type_id: roomType.id,
                rooms_booked: 1,
                guest_id: user.id,
                host_id: hotel.owner_id,
                check_in: checkIn,
                check_out: checkOut,
                guests: adults + children,
                adults,
                children,
                pets: 0,
                total_price: quote.total,
                status: 'pending_payment',
                payment_status: 'unpaid',
                payment_plan: 'full',
                balance_amount: 0,
                // Frozen at checkout, like a cottage stay.
                commission_rate: commissionRate,
                cancellation_policy: hotel.cancellation_policy || 'Flexible',
                cancellation_custom_days: hotel.cancellation_policy === 'Custom' ? hotel.cancellation_custom_days : null,
                non_refundable: false,
                cleaning_fee: 0,
                pet_fee: 0,
                extra_guest_fee: 0,
                nightly_breakdown: quote.nightly,
                extras_total: 0,
                extras_breakdown: [],
            })
            .select('id')
            .single();

        if (insertError || !booking) {
            return NextResponse.json({ ok: false, error: (insertError && insertError.message) || 'Could not start the booking' }, { status: 500 });
        }

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: user.email,
            client_reference_id: booking.id,
            payment_method_types: ['card', 'klarna', 'link'],
            adaptive_pricing: { enabled: false },
            success_url: returnUrl() + '/booking-confirmed/' + booking.id + '?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: returnUrl() + '/hotels/' + hotel.id + '?cancelled=1',
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pence(quote.total),
                        product_data: {
                            name: (hotel.name || 'Your stay') + (roomType.name ? ' — ' + roomType.name : ''),
                            description: 'Full payment for your stay',
                        },
                    },
                },
            ],
            payment_intent_data: {
                description: 'Galloway Getaways hotel booking ' + booking.id,
                metadata: { booking_id: booking.id, kind: 'full' },
            },
            metadata: { booking_id: booking.id, kind: 'full', ...guestTermsMeta },
        });

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        console.error('[hotels/checkout]', err && err.message);
        await logError('[hotels/checkout] ' + ((err && err.message) || 'failed'), err, { path: 'hotels/checkout' });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not start checkout' }, { status: 500 });
    }
}
