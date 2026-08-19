import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

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
        .select('events')
        .eq('listing_id', listingId);

    const all: { start: string; end: string }[] = [];

    (feeds || []).forEach((feed: any) => {
        (feed.events || []).forEach((e: any) => {
            if (e && e.start && e.end) all.push({ start: e.start, end: e.end });
        });
    });

    return NextResponse.json({ events: all });
}
