import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';

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
            .select('id, listing_id, host_id, guest_id, check_in, check_out, guests, status, payment_status')
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
            status: b.status,
            // Deliberately absent: total_price, amount_paid, balance_amount,
            // payment_status, and everything else about the money.
            sharedWithMe: true,
        });
    });

    trips.sort((a, b) => (a.check_in < b.check_in ? 1 : -1));

    // Card-safe arrival essentials, per trip — the things a guest wants without
    // opening the full Getting-there page: the address, the times, the point for
    // a map, what3words. Read here (service role) because what3words lives in the
    // grant-less listing_arrival table. The DOOR CODE and WIFI PASSWORD are
    // deliberately NOT here: those stay on the full page only, never on a card a
    // guest might leave open on a train.
    // Arrival essentials go only to trips that are CONFIRMED. The trips LIST
    // above still carries every booking whatever its status — a guest must see
    // their own pending and cancelled bookings — but the address/what3words
    // attach is private data, so it is gated on the same rule as the arrival
    // page and profile_private. A planted or unaccepted booking gets a card
    // with no arrival block. We also read addresses only for confirmed trips,
    // so an unentitled listing's address never even enters the server's memory.
    const listingIds = Array.from(new Set(
        trips.filter(bookingReleasesPrivateData).map((t) => t.listing_id).filter(Boolean)
    ));
    if (listingIds.length) {
        const [{ data: ls }, { data: la }] = await Promise.all([
            admin.from('listings')
                .select('id, street_address, postcode, location, latitude, longitude, check_in_time, check_in_end_time, check_out_time')
                .in('id', listingIds),
            admin.from('listing_arrival').select('listing_id, what3words').in('listing_id', listingIds),
        ]);
        const infoBy: Record<string, any> = {};
        (ls || []).forEach((l: any) => { infoBy[l.id] = l; });
        const w3wBy: Record<string, string> = {};
        (la || []).forEach((a: any) => { if (a.what3words) w3wBy[a.listing_id] = a.what3words; });

        trips.forEach((t) => {
            // Guard here too, not only on the fetch list: a guest can hold a
            // confirmed AND a pending booking on the SAME listing, so infoBy
            // would carry that listing's address — the pending trip must still
            // not receive it.
            if (!bookingReleasesPrivateData(t)) return;
            const l = infoBy[t.listing_id];
            if (!l) return;
            const addressLines = [l.street_address, [l.postcode, l.location].filter(Boolean).join(', ')].filter(Boolean);
            t.arrival = {
                addressLines,
                addressString: [l.street_address, l.postcode, l.location].filter(Boolean).join(', '),
                lat: l.latitude,
                lng: l.longitude,
                checkInTime: l.check_in_time,
                checkInEndTime: l.check_in_end_time,
                checkOutTime: l.check_out_time,
                what3words: w3wBy[t.listing_id] || null,
            };
        });
    }

    return NextResponse.json({ trips: trips });
}
