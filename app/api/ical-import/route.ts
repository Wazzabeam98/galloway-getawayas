import { platformFromUrl } from '@/lib/platforms';
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';

export const dynamic = 'force-dynamic';

// Which dates other platforms have already taken, for one listing.
//
// The calendars themselves are fetched by the scheduled job, not here — a
// guest shouldn't wait on three external websites before they can see which
// dates are free, and an external site being slow shouldn't slow us down.
//
// It takes a listing id rather than a URL on purpose: export links are private
// to the host, and an Airbnb one lets anyone read that host's bookings.
//
// WHY THIS IS NOT BEHIND A TOKEN, UNLIKE ITS SIBLING
//
// /api/ical/[id] EXPORTS our bookings to other platforms and is rightly a
// secret link. This one is the opposite direction and it feeds the booking
// widget on every public listing page: a guest has to be able to see that the
// 12th is taken before they try to book it. Gating it would not close a leak,
// it would stop anyone booking.
//
// So the fix for "anyone with a listing id can read its occupancy" is not a
// token. It is to answer only for listings a stranger is allowed to see at
// all, and to say less to a stranger than to the host.
//
// WHAT A STRANGER USED TO GET, AND NO LONGER DOES
//
//   any listing        including drafts and listings awaiting review. Their
//                      occupancy was readable by anyone who could guess or
//                      scrape an id, for a property not yet public.
//   which platform     "the 12th went on Airbnb" is a fact about the host's
//                      business. A guest needs to know the date is gone, not
//                      where it went.
//   the feed id        an internal id, of no use to a guest and of some use
//                      to anyone poking at the rest of the API.
//
// The host's own calendar still gets all of it — it colours each day by
// platform — and that is what `detail` below is for.
const PUBLICLY_VISIBLE = ['published', 'hidden'];

export async function GET(req: NextRequest) {
    const listingId = req.nextUrl.searchParams.get('listing');

    if (!listingId) {
        return NextResponse.json({ error: 'Missing listing.' }, { status: 400 });
    }

    const admin = adminClient();

    const { data: listing } = await admin
        .from('listings')
        .select('id, status')
        .eq('id', listingId)
        .maybeSingle();

    if (!listing) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    // Who is asking. getUser(), not getSession() — getSession only decodes the
    // cookie and never checks its signature, so `detail` would be handed to
    // anyone who wrote their own.
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    // A co-host counts. checkListing is the same rule the rest of the
    // dashboard uses, so this cannot drift from what the calendar page lets
    // somebody open.
    const access = user ? await checkListing(user.id, listingId, 'can_calendar') : null;
    const detail = access !== null;

    // Not public, and not theirs. A draft's occupancy is nobody else's
    // business, and 404 rather than 403 so this cannot be used to find out
    // which ids exist.
    if (!detail && PUBLICLY_VISIBLE.indexOf(listing.status) === -1) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const { data: feeds } = await admin
        .from('listing_ical_feeds')
        .select('id, url, label, events')
        .eq('listing_id', listingId);

    const all: any[] = [];

    (feeds || []).forEach((feed: any) => {
        // Only computed when it will be sent. platformFromUrl reads the feed
        // URL, which is the host's private export link from the other site.
        const platform = detail ? platformFromUrl(feed.url, feed.label) : null;

        (feed.events || []).forEach((e: any) => {
            if (!e || !e.start || !e.end) return;

            // A guest gets two dates. That is everything the booking widget
            // uses — it only ever calls addRange(start, end).
            const base = { start: e.start, end: e.end };

            all.push(
                detail
                    ? {
                          ...base,
                          feedId: feed.id,
                          platform: platform!.key,
                          platformName: platform!.name,
                      }
                    : base
            );
        });
    });

    return NextResponse.json({ events: all });
}
