import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { guestCalendar } from '@/lib/availability';

export const dynamic = 'force-dynamic';

// One listing's taken nights and nightly price overrides, in ONE request, for
// the calendars that live on pages with no server parent to load them (the
// change-dates picker inside messages). Same data and same helper the listing
// page reads on the server before paint (lib/availability guestCalendar) — so
// the two can never disagree about which nights are free.
//
// It replaces three to five round trips in a row (busy nights, overrides,
// /api/ical-import and its own lookups), which is what made those calendars
// sit wide open for two seconds. Callers show a loading state until it answers,
// never an empty calendar.
//
// Who may ask: the same rule as /api/ical-import — a listing anyone can see
// (published or hidden), or one the caller can manage. Night keys and prices
// only: no names, no platforms, no feed URLs.
const PUBLICLY_VISIBLE = ['published', 'hidden'];

export async function GET(req: NextRequest) {
    const listingId = req.nextUrl.searchParams.get('listing');
    if (!listingId) return NextResponse.json({ error: 'Missing listing.' }, { status: 400 });

    const { data: listing } = await adminClient()
        .from('listings')
        .select('id, status')
        .eq('id', listingId)
        .maybeSingle();
    if (!listing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    if (PUBLICLY_VISIBLE.indexOf(listing.status) === -1) {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        const access = user ? await checkListing(user.id, listingId, 'can_calendar') : null;
        if (access === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    return NextResponse.json(await guestCalendar(listingId));
}
