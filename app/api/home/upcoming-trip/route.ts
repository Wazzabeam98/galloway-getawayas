import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { formatUk } from '@/lib/cancellation';
import { cancellationPosition } from '@/lib/cancellationView';
import { londonDayKey, daysBetweenKeys } from '@/lib/dayKey';
import { liveForGuestCard, stayCountdown } from '@/lib/bookingWindows';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { adminClient } from '@/lib/supabaseAdmin';
import { loadBookingSeats } from '@/lib/groupSeats';
import { directionsUrl as buildDirectionsUrl, appleDirectionsUrl } from '@/lib/directions';
import { compareTripsByStart } from '@/lib/bookingOrder';
import { publicArea } from '@/lib/places';
import { partyLabel } from '@/lib/bookingDisplay';

export const dynamic = 'force-dynamic';

// The signed-in guest's featured upcoming stay, for the home page's "Your
// upcoming trip" card (components/UpcomingTripClient). The home page is now
// edge-cached, so this card is fetched on the client after load rather than
// rendered into the (shared) HTML. All the entitlement and arrival-secret logic
// stays here on the server — a pending request is NOT entitled to the address
// or what3words (bookingReleasesPrivateData), exactly as the old server
// component and /api/trips enforce — so no private location data can leak into
// a card the browser builds. Per-viewer, never cached.
//
// This mirrors components/UpcomingTrip.tsx one-for-one; the client is purely
// presentational.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): getSession trusts an unsigned cookie, so
        // a forged one would impersonate any user. getUser verifies the token.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ trip: null }, NOSTORE);

        const now = new Date();

        const { data: bookings } = await supabase
            .from('bookings')
            .select('id, listing_id, check_in, check_out, status, payment_status, guests, adults, children, pets, amount_paid, amount_refunded, cleaning_fee, cancellation_policy, cancellation_custom_days, non_refundable')
            .eq('guest_id', user.id)
            .in('status', ['confirmed', 'pending'])
            .order('check_in', { ascending: true })
            .order('check_out', { ascending: true })
            .order('id', { ascending: true })
            .limit(10);

        // Feature the nearest live stay. The shared comparator settles the order
        // BEFORE the find, so a same-day tie always yields the same trip.
        const booking = (bookings || [])
            .slice()
            .sort(compareTripsByStart)
            .find((b) => liveForGuestCard(b, now));
        if (!booking) return NextResponse.json({ trip: null }, NOSTORE);

        const { data: listing } = await supabase
            .from('listings')
            .select('id, title, location, images, check_in_time, check_in_end_time, check_out_time, cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();
        if (!listing) return NextResponse.json({ trip: null }, NOSTORE);

        // The guest's own confirmed experiences for this stay, so the in-place
        // cancel confirm can name what a stay-cancel takes with it.
        const { data: myOrders } = await supabase
            .from('service_orders')
            .select('item_name, service_date')
            .eq('booking_id', booking.id)
            .eq('guest_id', user.id)
            .eq('status', 'confirmed');
        const cancelOrders = (myOrders || []).map((o: any) => ({ item_name: o.item_name, service_date: o.service_date }));

        // Arrival essentials — address behind Get directions and the what3words —
        // but ONLY for a CONFIRMED stay. A pending request is not entitled to
        // private location data. Read under the service role because what3words
        // lives in the grant-less listing_arrival table.
        let directions: { google: string | null; apple: string | null } | null = null;
        let what3words: string | null = null;
        let addressToCopy: string | null = null;
        if (bookingReleasesPrivateData(booking)) {
            const admin = adminClient();
            const [{ data: place }, { data: arr }] = await Promise.all([
                admin.from('listings').select('street_address, postcode, location, latitude, longitude').eq('id', booking.listing_id).maybeSingle(),
                admin.from('listing_arrival').select('what3words').eq('listing_id', booking.listing_id).maybeSingle(),
            ]);
            const p: any = place || {};
            what3words = (arr as any)?.what3words || null;
            // The FULL street address and postcode for Copy address — never the
            // town on its own.
            addressToCopy = [p.street_address, p.postcode]
                .map((s: any) => String(s || '').trim())
                .filter(Boolean)
                .join(', ') || null;
            const parts = {
                latitude: p.latitude, longitude: p.longitude,
                streetAddress: p.street_address, postcode: p.postcode, location: p.location,
            };
            directions = { google: buildDirectionsUrl(parts), apple: appleDirectionsUrl(parts) };
        }

        const nights = Math.round(
            (new Date(String(booking.check_out).slice(0, 10)).getTime()
                - new Date(String(booking.check_in).slice(0, 10)).getTime()) / 86400000,
        );

        const { phase, daysUntilCheckIn } = stayCountdown(booking, now);
        const headline =
            phase === 'during' && String(booking.check_out).slice(0, 10) === londonDayKey(now) ? 'You check out today'
            : phase === 'during' ? 'You’re here'
                : phase === 'today' ? 'You arrive today'
                    : phase === 'tomorrow' ? 'You arrive tomorrow'
                        : 'You arrive in ' + daysUntilCheckIn + ' days';

        const cancel = cancellationPosition({
            checkIn: booking.check_in,
            policy: (booking as any).cancellation_policy,
            customDays: (booking as any).cancellation_custom_days,
            nonRefundable: (booking as any).non_refundable === true,
            amountPaid: booking.amount_paid,
            alreadyRefunded: booking.amount_refunded,
            cleaningFee: (booking as any).cleaning_fee,
            on: now,
        });
        const freeUntilKey = cancel.kind === 'free' ? cancel.freeUntilKey : null;
        const freeDaysLeft = freeUntilKey ? daysBetweenKeys(londonDayKey(now), freeUntilKey) : 0;

        // The party's seats, read server-side (the browser can't select
        // booking_guests — see lib/groupSeats) and handed to TripGroup.
        const showGroup = booking.status !== 'cancelled' && booking.status !== 'declined';
        const { seats, profiles } = showGroup
            ? await loadBookingSeats(adminClient(), booking.id)
            : { seats: [], profiles: {} };

        return NextResponse.json(
            {
                trip: {
                    bookingId: booking.id,
                    listingId: booking.listing_id,
                    status: booking.status,
                    headline,
                    title: listing.title,
                    areaLabel: listing.location ? publicArea(listing.location) : null,
                    images: listing.images,
                    checkIn: booking.check_in,
                    checkOut: booking.check_out,
                    checkInUk: formatUk(new Date(booking.check_in)),
                    checkOutUk: formatUk(new Date(booking.check_out)),
                    checkInTime: listing.check_in_time,
                    checkOutTime: listing.check_out_time,
                    nights,
                    partyLabel: partyLabel(booking) || '',
                    guests: booking.guests,
                    directions,
                    what3words,
                    addressToCopy,
                    showGroup,
                    seats,
                    profiles,
                    cancel: freeUntilKey ? {
                        checkIn: booking.check_in,
                        policy: (booking as any).cancellation_policy,
                        customDays: (booking as any).cancellation_custom_days,
                        nonRefundable: (booking as any).non_refundable === true,
                        amountPaid: booking.amount_paid,
                        amountRefunded: booking.amount_refunded,
                        cleaningFee: (booking as any).cleaning_fee,
                        orders: cancelOrders,
                        freeUntilKey,
                        freeDaysLeft,
                    } : null,
                },
            },
            NOSTORE,
        );
    } catch (err: any) {
        console.error('[home/upcoming-trip]', err && err.message);
        return NextResponse.json({ trip: null }, NOSTORE);
    }
}

const NOSTORE = { headers: { 'Cache-Control': 'private, no-store' } } as const;
