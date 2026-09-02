import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getImageUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// The orders on one of the caller's businesses, for the provider dashboard.
//
// The ones awaiting an answer come first — those are the ones with a held card
// and a ticking window. getUser-verified and owner-checked: a provider sees
// only their own business's orders.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        const { data: orders } = await admin
            .from('service_orders')
            .select('id, status, service_date, service_time, shape, guests, price, item_name, item_unit, unit_price, quantity, guest_name, guest_phone, guest_email, note, allergy, listing_id, expires_at, created_at')
            .eq('provider_id', providerId)
            .order('created_at', { ascending: false })
            .limit(50);

        // THE PROPERTY IS RELEASED ON CONFIRM, WITH THE CONTACT.
        //
        // A confirmed provider has to physically get there — a chef with a car
        // full of equipment, a baker with a cake — so they need the cottage, not
        // just a date and a name. Same release the host's accepted-enquiry gives
        // a plumber: the name, a photo, a link, and the EXACT address (the
        // listing's `location` is the full street + postcode, the same address a
        // booked guest gets to arrive; the public listing only ever shows an
        // approximate area). Fetched once for the confirmed orders on this page.
        const confirmed = (orders || []).filter((o) => o.status === 'confirmed');
        const listingIds = Array.from(new Set(confirmed.map((o) => o.listing_id).filter(Boolean)));
        const { data: listingRows } = listingIds.length
            ? await admin.from('listings').select('id, title, location, images').in('id', listingIds)
            : { data: [] as any[] };
        const listingById: Record<string, any> = {};
        for (const l of listingRows || []) listingById[l.id] = l;

        // CONTACT AND PROPERTY ARE RELEASED ON CONFIRM, NOT BEFORE.
        //
        // The same rule an accepted enquiry follows for the host: while a
        // request is only held, the provider decides on the date, the price and
        // the note — not on the guest's number or where they live. The moment
        // they confirm and the card is captured, they are doing the job, so they
        // get what they need to do it: name, phone, email, and the cottage with
        // its address. An unanswered or declined order carries none of it.
        const rows = (orders || []).map((o) => {
            const released = o.status === 'confirmed';
            const l = released && o.listing_id ? listingById[o.listing_id] : null;
            return {
                ...o,
                guest_phone: released ? o.guest_phone : null,
                guest_email: released ? o.guest_email : null,
                // The property, released on confirm. `address` is the exact
                // address (listing.location); `area` is not separated out here —
                // the provider is going there, so they get the real thing.
                listing: l ? {
                    id: l.id,
                    title: l.title,
                    address: l.location || null,
                    image: (Array.isArray(l.images) && l.images[0]) ? getImageUrl(l.images[0]) : null,
                } : null,
            };
        }).sort((a, b) => {
            // Awaiting-answer first, then the rest by recency.
            const aWaiting = a.status === 'authorised' ? 0 : 1;
            const bWaiting = b.status === 'authorised' ? 0 : 1;
            return aWaiting - bWaiting;
        });

        return NextResponse.json({ ok: true, orders: rows });
    } catch (err: any) {
        console.error('[services/orders GET]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load orders' }, { status: 500 });
    }
}
