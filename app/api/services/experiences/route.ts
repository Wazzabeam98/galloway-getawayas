import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isLiveToGuests, mccForProvider, guestExperiencesOpen } from '@/lib/serviceOrders';
import { pointForListing, coversPoint, guestCategory } from '@/lib/serviceProviders';

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

        // Live guest providers. "Live" now means approved + payouts on + AT
        // LEAST ONE PRICED ITEM on the menu — a provider with an empty menu has
        // nothing for a guest to buy, the same way one with no price used to.
        const { data: rows } = await admin
            .from('service_providers')
            .select('id, business_name, provider_name, based_line, headshot, trade, custom_label, stripe_mcc, description, photos, status, stripe_payouts_enabled')
            .eq('audience', 'guest')
            .eq('status', 'approved')
            .eq('stripe_payouts_enabled', true);

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

        // The menu — active, priced items, in the order the provider set.
        const { data: itemRows } = providerIds.length
            ? await admin
                .from('service_provider_items')
                .select('id, provider_id, name, description, price, sort_order, created_at')
                .in('provider_id', providerIds)
                .eq('active', true)
                .gt('price', 0)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true })
            : { data: [] as any[] };

        const itemsByProvider: Record<string, any[]> = {};
        for (const it of itemRows || []) {
            (itemsByProvider[it.provider_id] = itemsByProvider[it.provider_id] || []).push({
                id: it.id, name: it.name, description: it.description, price: Number(it.price),
            });
        }

        const providers = (rows || [])
            // Provider-aware, not mccForTrade: a guest provider carries the code
            // the owner assigned at review (there are no fixed trade codes), and
            // must be kept on the strength of that assigned code.
            .filter((p) => isLiveToGuests(p) && mccForProvider(p))
            .filter((p) => (itemsByProvider[p.id] || []).length > 0)
            .filter((p) => coversPoint(areasByProvider[p.id] || [], point.lat, point.lng))
            .map((p) => ({
                id: p.id,
                business_name: p.business_name,
                // The person behind the price, and the words that say who they
                // are — a guest is choosing someone to come into their cottage.
                provider_name: p.provider_name,
                based_line: p.based_line,
                headshot: p.headshot,
                // The word the guest reads: the trade's own for a fixed trade,
                // the owner-assigned word for an "other" — never "Something else".
                category: guestCategory(p),
                description: p.description,
                photos: p.photos,
                // The menu. One item for a chef, many for a baker. The card leads
                // with the provider and a "from" price, and lists the rest.
                items: itemsByProvider[p.id] || [],
            }));

        // What the guest has already asked for on THIS stay, so the trip page
        // can show it back to them — until now a request vanished into an email
        // they never got. Their own orders only (guest_id), and only the ones
        // still live or recently settled are worth showing; the cancel button
        // acts on the authorised and confirmed ones.
        let orders: any[] = [];
        if (bookingId) {
            const { data: mine } = await admin
                .from('service_orders')
                .select('id, status, service_date, price, item_name, provider_business_name')
                .eq('booking_id', bookingId)
                .eq('guest_id', user.id)
                .order('created_at', { ascending: false });
            orders = (mine || []).map((o) => ({
                id: o.id,
                status: o.status,
                service_date: o.service_date,
                price: Number(o.price),
                item_name: o.item_name,
                provider_business_name: o.provider_business_name,
            }));
        }

        return NextResponse.json({ ok: true, open: true, stay, providers, orders });
    } catch (err: any) {
        console.error('[services/experiences]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load experiences' }, { status: 500 });
    }
}

function staySpan(booking: any): { check_in: string; check_out: string } {
    return { check_in: booking.check_in, check_out: booking.check_out };
}
