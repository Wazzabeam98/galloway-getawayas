import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isLiveToGuests, mccForTrade, guestExperiencesOpen } from '@/lib/serviceOrders';
import { pointForListing, coversPoint } from '@/lib/serviceProviders';

export const dynamic = 'force-dynamic';

// The experiences a guest may book for one of their own stays.
//
// Live only — approved AND payout-ready (isLiveToGuests). A guest is never
// shown a provider we cannot take money for, because the offer would fail at
// the checkout. And near their cottage only: coversPoint against the provider's
// own service areas, the same geography the host shop uses.
//
// getUser(), and the booking must be the caller's own — the stay is where the
// place and the eligible providers come from, so it is not something to accept
// from the browser.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        // Closed until launch. The surface reads `open` to show its "coming
        // soon" state; nothing bookable is returned while it is false, so the
        // trip page and the host panel cannot list a provider before the owner
        // opens it — even for a caller who owns a live chef.
        if (!guestExperiencesOpen()) {
            return NextResponse.json({ ok: true, open: false, stay: null, providers: [] });
        }

        // Two ways in, and both are owner-checked. A GUEST asks by their own
        // booking (the trip page); a HOST asks by their own listing (the
        // dashboard, to see what guests can book at their cottage). Same gate,
        // same coversPoint, so the two can never show different answers.
        const params = new URL(request.url).searchParams;
        const bookingId = params.get('booking') || '';
        const listingParam = params.get('listing') || '';

        if (!bookingId && !listingParam) {
            return NextResponse.json({ ok: false, error: 'Missing booking or listing' }, { status: 400 });
        }

        const admin = adminClient();

        let listingId = listingParam;
        let stay: { check_in: string; check_out: string } | null = null;

        if (bookingId) {
            const { data: booking } = await admin
                .from('bookings')
                .select('id, guest_id, listing_id, check_in, check_out')
                .eq('id', bookingId)
                .maybeSingle();
            if (!booking || booking.guest_id !== user.id) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            listingId = booking.listing_id;
            stay = staySpan(booking);
        }

        const { data: listing } = await admin
            .from('listings')
            .select('id, host_id, location, latitude, longitude')
            .eq('id', listingId)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // The host route has to prove ownership — a host may only see the
        // experiences around their OWN cottage, not any listing id they type.
        if (listingParam && !bookingId && listing.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
        }

        const point = pointForListing(listing);
        if (!point) {
            // No location to match against — better nothing than a wrong list.
            return NextResponse.json({ ok: true, open: true, stay, providers: [] });
        }

        // Live guest providers with a price. The gate is enforced in the query
        // and again in isLiveToGuests, so a provider missing either half never
        // reaches a guest.
        const { data: rows } = await admin
            .from('service_providers')
            .select('id, business_name, trade, description, photos, experience_price, status, stripe_payouts_enabled')
            .eq('audience', 'guest')
            .eq('status', 'approved')
            .eq('stripe_payouts_enabled', true)
            .gt('experience_price', 0);

        const providerIds = (rows || []).map((r) => r.id);
        const { data: areas } = providerIds.length
            ? await admin
                .from('service_areas')
                .select('provider_id, centre_lat, centre_lng, radius_miles')
                .in('provider_id', providerIds)
            : { data: [] as any[] };

        const areasByProvider: Record<string, any[]> = {};
        for (const a of areas || []) {
            (areasByProvider[a.provider_id] = areasByProvider[a.provider_id] || []).push(a);
        }

        const providers = (rows || [])
            .filter((p) => isLiveToGuests(p) && mccForTrade(p.trade))
            .filter((p) => coversPoint(areasByProvider[p.id] || [], point.lat, point.lng))
            .map((p) => ({
                id: p.id,
                business_name: p.business_name,
                trade: p.trade,
                description: p.description,
                photos: p.photos,
                price: Number(p.experience_price),
            }));

        return NextResponse.json({ ok: true, open: true, stay, providers });
    } catch (err: any) {
        console.error('[services/experiences]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load experiences' }, { status: 500 });
    }
}

function staySpan(booking: any): { check_in: string; check_out: string } {
    return { check_in: booking.check_in, check_out: booking.check_out };
}
