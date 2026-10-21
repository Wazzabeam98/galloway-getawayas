import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { icalBlockedListingIds } from '@/lib/availability';

export const dynamic = 'force-dynamic';

// Which of a set of listings are NOT free for a wanted stay [from, to).
//
// The home page is now edge-cached and renders every published listing on the
// server; a dated search is run in the browser (components/HomeShop). The only
// part of that search that can't run client-side is availability — the three
// sources below are server reads — so the client posts the candidate ids and
// the dates here and gets back the ids to drop. Identical to the filtering the
// home page used to do inline while it was force-dynamic, so a dated search
// returns exactly what it always did.
//
// Per-viewer and never cached: a signed-in guest reads busy nights/blocks under
// their own RLS, the same as the old server component did (the route handler
// client carries their cookies). The iCal read bypasses RLS inside
// icalBlockedListingIds and returns ids only — a host's feed never leaves it.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const ids: string[] = Array.isArray(body?.ids)
            ? body.ids.filter((x: any) => typeof x === 'string' && x)
            : [];
        const from = typeof body?.from === 'string' ? body.from : '';
        const to = typeof body?.to === 'string' ? body.to : '';

        // Only a real stay is worth a read. Anything else means "no dates", so
        // nothing is unavailable on date grounds.
        const validDates =
            /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from < to;
        if (!ids.length || !validDates) {
            return NextResponse.json(
                { unavailable: [] },
                { headers: { 'Cache-Control': 'private, no-store' } },
            );
        }

        const supabase = createRouteHandlerClient({ cookies });

        // A booking [check_in, check_out) clashes with the wanted stay [from, to)
        // exactly when it starts before the stay ends and ends after it starts.
        // Busy nights, not bookings — see 20260828231530_bookings_are_not_public.sql.
        const { data: clashing } = await supabase
            .from('listing_busy_nights')
            .select('listing_id')
            .in('listing_id', ids)
            .in('status', ['pending', 'confirmed'])
            .lt('check_in', to)
            .gt('check_out', from);

        const { data: blocked } = await supabase
            .from('calendar_overrides')
            .select('listing_id')
            .in('listing_id', ids)
            .eq('is_blocked', true)
            .gte('date', from)
            .lt('date', to);

        // Dates taken on Airbnb, Booking.com and anything else the host syncs,
        // cached by the three-hourly sync job. Ids in, ids out — the events stay
        // inside that call because some carry a guest name or reservation link.
        const icalBlocked = await icalBlockedListingIds(ids, from, to);

        const unavailable = Array.from(
            new Set<string>([
                ...(clashing || []).map((b: any) => b.listing_id),
                ...(blocked || []).map((b: any) => b.listing_id),
                ...Array.from(icalBlocked),
            ]),
        );

        return NextResponse.json(
            { unavailable },
            { headers: { 'Cache-Control': 'private, no-store' } },
        );
    } catch (err: any) {
        console.error('[listings/search-availability]', err && err.message);
        // A failed availability read must never make the whole search look
        // empty — the client keeps the listings it already matched on
        // where/guests/filters and simply doesn't narrow by date.
        return NextResponse.json(
            { unavailable: [] },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
        );
    }
}
