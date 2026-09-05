import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { directionsUrl, appleDirectionsUrl } from '@/lib/directions';

export const dynamic = 'force-dynamic';

// Trips this person booked, plus trips they've been added to by someone else.
//
// The money fields are stripped from a shared trip before it leaves the
// server. Hiding them in the page would be a curtain, not a wall.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ trips: [] });
    }

    const uid = user.id;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: own } = await admin
        .from('bookings')
        .select('*')
        .eq('guest_id', uid)
        .order('check_in', { ascending: false });

    const { data: sharedRows } = await admin
        .from('booking_guests')
        .select('booking_id')
        .eq('user_id', uid)
        .eq('status', 'active');

    const sharedIds = (sharedRows || []).map((r: any) => r.booking_id);

    const { data: shared } = sharedIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, host_id, guest_id, check_in, check_out, guests, adults, children, pets, status, payment_status')
            .in('id', sharedIds)
            .order('check_in', { ascending: false })
        : { data: [] };

    const trips: any[] = [];

    (own || []).forEach((b: any) => {
        trips.push({ ...b, sharedWithMe: false });
    });

    (shared || []).forEach((b: any) => {
        if (trips.some((t) => t.id === b.id)) return;

        trips.push({
            id: b.id,
            listing_id: b.listing_id,
            host_id: b.host_id,
            check_in: b.check_in,
            check_out: b.check_out,
            guests: b.guests,
            // The party split is composition, not money — safe to carry so a
            // shared trip shows "3 adults · 1 child" like the booker's own view.
            adults: b.adults,
            children: b.children,
            pets: b.pets,
            status: b.status,
            // status AND payment_status are the entitlement signal the arrival
            // gate reads (bookingReleasesPrivateData = confirmed + paid). They say
            // WHETHER the stay is a real, paid stay — not what was paid — so a
            // companion needs them to see the address, directions and the way in,
            // exactly as the invite promises. Without payment_status the gate was
            // silently false for every companion and their card showed no arrival
            // and no link to it.
            payment_status: b.payment_status,
            // Deliberately absent: total_price, amount_paid, balance_amount, and
            // everything else that says HOW MUCH — a companion never sees the money.
            sharedWithMe: true,
        });
    });

    trips.sort((a, b) => (a.check_in < b.check_in ? 1 : -1));

    // Card-safe arrival detail, per trip — everything the Getting-there page used
    // to hold EXCEPT the two secrets: the address and a map point, the times,
    // what3words, the host's "last bit" directions, parking, how you get in (the
    // method, not the code), and the host's phone for the contact block. Read here
    // (service role) because the approach fields live in the grant-less
    // listing_arrival table.
    //
    // The DOOR CODE and the WIFI PASSWORD never leave the server here. We send
    // only two booleans — hasCode, hasWifi — so the card can SAY there is a way in
    // to reveal and link through, while the secrets themselves stay on the
    // Getting-there page, revealed only in its own window. hasCode is read from
    // listing_access_codes selecting listing_id ALONE, never `code`; hasWifi is
    // derived from the wifi NAME, so the password is never even pulled.
    //
    // All of this is ENTITLEMENT-GATED (PR #99): the trips LIST carries every
    // booking whatever its status — a guest must see their own pending and
    // cancelled bookings — but the arrival detail is private data, so it attaches
    // only to trips that are CONFIRMED, on the same bookingReleasesPrivateData
    // rule as the arrival page and profile_private. We read listings and host
    // phones only for entitled trips, so an unentitled stay's address or host
    // number never even enters the server's memory. The per-trip guard below is a
    // second layer, for a guest holding a confirmed AND a pending stay on one
    // listing.
    const entitled = trips.filter(bookingReleasesPrivateData);
    const listingIds = Array.from(new Set(entitled.map((t) => t.listing_id).filter(Boolean)));
    const hostIds = Array.from(new Set(entitled.map((t) => t.host_id).filter(Boolean)));
    if (listingIds.length) {
        const [{ data: ls }, { data: la }, { data: codes }, { data: hosts }] = await Promise.all([
            admin.from('listings')
                .select('id, street_address, postcode, location, latitude, longitude, check_in_time, check_in_end_time, check_out_time, check_in_method')
                .in('id', listingIds),
            // wifi_name (not the password) tells us whether there is wifi to show;
            // arrival_directions and parking_info are the host's own words and are
            // not secret — they belong on the card now.
            admin.from('listing_arrival').select('listing_id, what3words, arrival_directions, parking_info, wifi_name').in('listing_id', listingIds),
            // Existence only — selecting the code would pull the secret into this
            // request, which is exactly what this route promises never to do.
            admin.from('listing_access_codes').select('listing_id').in('listing_id', listingIds),
            hostIds.length
                ? admin.from('profiles').select('id, phone, full_name, avatar_url, host_bio').in('id', hostIds)
                : Promise.resolve({ data: [] as any[] }),
        ]);
        const infoBy: Record<string, any> = {};
        (ls || []).forEach((l: any) => { infoBy[l.id] = l; });
        const arrBy: Record<string, any> = {};
        (la || []).forEach((a: any) => { arrBy[a.listing_id] = a; });
        const hasCodeFor = new Set((codes || []).map((c: any) => c.listing_id));
        const phoneBy: Record<string, string | null> = {};
        // Host profile for the human host block: name, photo and their own
        // "about" line. Not sensitive (it's shown on the public listing too), but
        // read here under the service role alongside the phone so a single fetch
        // carries the whole block, and only for entitled trips.
        const hostBy: Record<string, any> = {};
        (hosts || []).forEach((h: any) => {
            phoneBy[h.id] = h.phone || null;
            hostBy[h.id] = { avatar: h.avatar_url || null, bio: (h.host_bio || '').trim() || null };
        });

        trips.forEach((t) => {
            // Guard here too, not only on the fetch list: a guest can hold a
            // confirmed AND a pending booking on the SAME listing, so infoBy
            // would carry that listing's address — the pending trip must still
            // not receive it.
            if (!bookingReleasesPrivateData(t)) return;
            const l = infoBy[t.listing_id];
            if (!l) return;
            const av = arrBy[t.listing_id] || {};
            const addressLines = [l.street_address, [l.postcode, l.location].filter(Boolean).join(', ')].filter(Boolean);
            t.arrival = {
                addressLines,
                addressString: [l.street_address, l.postcode, l.location].filter(Boolean).join(', '),
                lat: l.latitude,
                lng: l.longitude,
                checkInTime: l.check_in_time,
                checkInEndTime: l.check_in_end_time,
                checkOutTime: l.check_out_time,
                what3words: av.what3words || null,
                arrivalDirections: av.arrival_directions || null,
                parking: av.parking_info || null,
                checkInMethod: l.check_in_method || null,
                // Built server-side by the shared rule: a pin, or a street
                // address — never the town alone. null means no safe directions,
                // so the card shows no Get-directions button.
                directionsUrl: directionsUrl({
                    latitude: l.latitude, longitude: l.longitude,
                    streetAddress: l.street_address, postcode: l.postcode, location: l.location,
                }),
                // Apple Maps, same guard — the picker offers both maps apps.
                appleDirectionsUrl: appleDirectionsUrl({
                    latitude: l.latitude, longitude: l.longitude,
                    streetAddress: l.street_address, postcode: l.postcode, location: l.location,
                }),
                // Booleans only — the values never reach the card.
                hasCode: hasCodeFor.has(t.listing_id),
                hasWifi: !!av.wifi_name,
                hostPhone: phoneBy[t.host_id] || null,
                // The human host block — photo and their own words. The NAME is
                // resolved on the client under the display-name privacy rules.
                hostAvatar: hostBy[t.host_id]?.avatar || null,
                hostBio: hostBy[t.host_id]?.bio || null,
            };
        });
    }

    return NextResponse.json({ trips: trips });
}
