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
import { nightsBetween, dateFromKey, quoteBooking, type PricingListing } from '@/lib/pricing';
import { hotelsOpen } from '@/lib/hotels';
import { roomsAvailable } from '@/lib/hotelAvailability';
import { maxNightsFor, earliestCheckInKey, londonTodayKey } from '@/lib/stayRules';

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
        const pets = Math.max(0, Math.floor(Number(body && body.pets) || 0));
        const wantsBreakfast = !!(body && body.breakfast);

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
            .select('id, hotel_id, name, inventory_count, max_adults, max_children, max_occupancy, price_per_night, min_nights, max_nights, advance_notice, extra_guest_fee, extra_guest_after, extra_guest_period, pet_fee, weekly_discount, monthly_discount, last_minute_discount, breakfast_included, breakfast_price, active, hotels ( id, owner_id, name, status, cancellation_policy, cancellation_custom_days, commission_rate )')
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
        // The room's maximum stay and advance-notice walls, the same rules
        // lib/stayRules gives a cottage, enforced here as the authority.
        const maxN = maxNightsFor(roomType as any);
        if (maxN && nights > maxN) {
            return NextResponse.json({ ok: false, error: `This room has a maximum stay of ${maxN} night(s).` }, { status: 400 });
        }
        const todayKey = londonTodayKey();
        const earliest = earliestCheckInKey(roomType as any, todayKey);
        if (checkIn < earliest) {
            return NextResponse.json({ ok: false, error: 'That check-in is sooner than this room can be booked.' }, { status: 400 });
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

        // The breakfast extra, when the room offers one (not in the price, a
        // positive price set) and the guest asked for it: priced per person per
        // night, resolved against the room's own figure — never the browser's.
        const breakfastPrice = Number(roomType.breakfast_price);
        const offersBreakfast = !roomType.breakfast_included && Number.isFinite(breakfastPrice) && breakfastPrice > 0;
        const guestCount = adults + children;
        const extras = wantsBreakfast && offersBreakfast
            ? [{
                id: 'breakfast',
                label: `Breakfast (£${breakfastPrice.toFixed(2).replace(/\.00$/, '')} per person, per night)`,
                unit: 'night' as const,
                unitPrice: breakfastPrice,
                qty: guestCount,
                vat_treatment: 'standard' as const,
            }]
            : [];

        // Price the stay with the cottage pricing engine (lib/pricing.quoteBooking)
        // — a hotel room type is a PricingListing: its nightly rate with any
        // seasonal overrides, extra-guest and pet fees (never cleaning), its
        // length-of-stay/last-minute discounts, and the breakfast extra. Reusing
        // the tested money path means a hotel stay is priced, discounted, feed
        // and frozen exactly as a cottage stay. The browser never sets the total.
        const pricingRoom: PricingListing = {
            price_per_night: Number(roomType.price_per_night),
            cleaning_fee: 0, // a hotel room has no cleaning fee
            pet_fee: Number(roomType.pet_fee) || 0,
            extra_guest_fee: Number(roomType.extra_guest_fee) || 0,
            extra_guest_after: Number(roomType.extra_guest_after) || 1,
            extra_guest_period: roomType.extra_guest_period || 'night',
            new_listing_promo: false, // the 20% new-listing promo is a cottage onboarding perk
            last_minute_discount: !!roomType.last_minute_discount,
            weekly_discount: !!roomType.weekly_discount,
            monthly_discount: !!roomType.monthly_discount,
        };
        const quote = quoteBooking(
            pricingRoom, priceOverrides,
            dateFromKey(checkIn), dateFromKey(checkOut),
            adults, children, pets,
            { newListingEligible: false, asOf: new Date() },
            extras,
        );

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
                pets,
                total_price: quote.total,
                status: 'pending_payment',
                payment_status: 'unpaid',
                payment_plan: 'full',
                balance_amount: 0,
                // Frozen at checkout, like a cottage stay — the fees and discount
                // the engine worked out, so the receipt and payout read what was
                // charged, never the room as it stands later.
                commission_rate: commissionRate,
                cancellation_policy: hotel.cancellation_policy || 'Flexible',
                cancellation_custom_days: hotel.cancellation_policy === 'Custom' ? hotel.cancellation_custom_days : null,
                non_refundable: false,
                cleaning_fee: 0,
                pet_fee: quote.petFeeTotal,
                extra_guest_fee: quote.extraGuestTotal,
                nightly_breakdown: quote.nightly,
                extras_total: quote.extrasTotal,
                extras_breakdown: quote.extras,
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
