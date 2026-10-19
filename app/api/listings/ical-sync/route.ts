import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { syncOneFeed, mapWithConcurrency } from '@/lib/icalSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Sync now" from the host's Linked calendars screen. The 15-minute cron keeps
// feeds fresh on its own; this is for the host who just blocked dates on Airbnb
// and wants them reflected here without waiting for the next run — the same
// Refresh Airbnb offers on each connected calendar.
//
// It refreshes only this listing's feeds, through the one shared syncOneFeed, so
// a manual sync writes exactly what the cron writes. It does NOT send the
// repeated-failure alert email: the host is looking at the screen, which shows
// each feed's status, so an email would only duplicate what's in front of them.
export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — a forged unsigned cookie would otherwise
        // impersonate any user. Matches the other listing routes.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const listingId: string = body && body.listingId;

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        // The owner, or a co-host they trusted with the calendar. Reading feeds
        // and writing their events is a service-role action below, so RLS is not
        // in the path — this check is the only thing standing between a signed-in
        // stranger and another host's feeds, so it is not optional.
        const access = await checkListing(user.id, listingId, 'can_calendar');

        if (!access) {
            return NextResponse.json(
                { ok: false, error: 'You don’t have permission to do that.' },
                { status: 403 }
            );
        }

        const admin = adminClient();
        const now = new Date().toISOString();

        const { data: feeds } = await admin
            .from('listing_ical_feeds')
            .select('id, url, label, failure_count')
            .eq('listing_id', listingId);

        if (!feeds || feeds.length === 0) {
            return NextResponse.json({ ok: true, synced: 0, failed: 0 });
        }

        const outcomes = await mapWithConcurrency(feeds, 8, async (feed: any) => {
            return syncOneFeed(admin, feed, now);
        });

        let ok = 0;
        let failed = 0;
        for (const res of outcomes) {
            if (res.ok) ok++;
            else failed++;
        }

        return NextResponse.json({ ok: true, synced: ok, failed: failed });
    } catch (err: any) {
        console.error('[listings/ical-sync]', err && err.message);
        await logError('listings/ical-sync: a manual calendar sync failed', err, {
            path: 'api/listings/ical-sync',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not sync those calendars' },
            { status: 500 }
        );
    }
}
