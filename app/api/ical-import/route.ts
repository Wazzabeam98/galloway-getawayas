import { platformFromUrl } from '@/lib/platforms';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Returns the dates other platforms have already taken, for one listing.
//
// The calendars themselves are fetched by the scheduled job, not here — a
// guest shouldn't wait on three external websites before they can see which
// dates are free, and an external site being slow shouldn't slow us down.
//
// It takes a listing id rather than a URL on purpose: export links are private
// to the host, and an Airbnb one lets anyone read that host's bookings.
export async function GET(req: NextRequest) {
    const listingId = req.nextUrl.searchParams.get('listing');

    if (!listingId) {
        return NextResponse.json({ error: 'Missing listing.' }, { status: 400 });
    }

    const admin = adminClient();

    const { data: feeds } = await admin
        .from('listing_ical_feeds')
        .select('id, url, label, events')
        .eq('listing_id', listingId);

    // Each event carries which feed it came from, so the host's calendar can
    // say whether a date went on Airbnb or Booking.com rather than just
    // showing it as unavailable.
    const all: any[] = [];

    (feeds || []).forEach((feed: any) => {
        const platform = platformFromUrl(feed.url, feed.label);

        (feed.events || []).forEach((e: any) => {
            if (!e || !e.start || !e.end) return;

            all.push({
                start: e.start,
                end: e.end,
                feedId: feed.id,
                platform: platform.key,
                platformName: platform.name,
            });
        });
    });

    return NextResponse.json({ events: all });
}
