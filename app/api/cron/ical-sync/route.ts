import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { syncOneFeed, mapWithConcurrency } from '@/lib/icalSync';
import { revalidateListings } from '@/lib/revalidatePublic';
import { recordCronRun } from '@/lib/cronHeartbeat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'ical-sync';

// Tell the host after this many runs in a row have failed. One blip is usually
// the other platform being briefly unavailable and isn't worth an email.
const ALERT_AFTER = 3;

// How many feeds to fetch at once. The fetch+parse+write of one feed now lives in
// lib/icalSync (syncOneFeed), so this route is only the schedule, the batching
// and the host failure-alert ladder.
const CONCURRENCY = 8;

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date().toISOString();

    const { data: feeds } = await admin
        .from('listing_ical_feeds')
        .select('id, listing_id, url, label, failure_count, alerted_at');

    // Each feed fetched concurrently (capped), so the run is the length of its
    // slowest feed rather than the sum — the only way a 15-minute cadence gets
    // through every listing's feeds inside the 60s cap. Writes go straight to the
    // row inside syncOneFeed; here we just keep the per-feed outcome to tally and
    // to decide the failure alert.
    const outcomes = await mapWithConcurrency(feeds || [], CONCURRENCY, async (feed: any) => {
        const res = await syncOneFeed(admin, feed, now);
        return { feed: feed, res: res };
    });

    // A synced feed can change which nights are blocked, and the listing page
    // bakes those in (guestCalendar reads listing_ical_feeds). Refresh the pages
    // of every listing whose feed synced so a date taken on Airbnb/Booking shows
    // as unavailable here within one request, not up to the 300s fallback
    // (lib/revalidatePublic; de-duped, best-effort).
    revalidateListings(
        outcomes.filter((o) => o.res.ok && o.feed.listing_id).map((o) => String(o.feed.listing_id)),
    );

    let ok = 0;
    let failed = 0;
    let alerted = 0;

    // Alerts are sent after the syncs, one at a time. They're rare (three failures
    // in a row for one feed) and each sends an email, so there's nothing to gain
    // from fanning them out.
    for (const outcome of outcomes) {
        const feed = outcome.feed;
        const res = outcome.res;

        if (res.ok) {
            ok++;
            continue;
        }

        failed++;

        if (res.failureCount >= ALERT_AFTER && !feed.alerted_at) {
            const { data: listing } = await admin
                .from('listings')
                .select('title, host_id')
                .eq('id', feed.listing_id)
                .maybeSingle();

            if (listing) {
                const { data: hostUser } = await admin.auth.admin.getUserById(listing.host_id);
                const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';

                if (hostEmail) {
                    await sendEmail(
                        hostEmail,
                        'One of your calendars has stopped syncing',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">We haven’t been able to reach the <strong>'
                                + escapeHtml(feed.label || 'imported')
                                + '</strong> calendar on your listing <strong>'
                                + escapeHtml(listing.title || 'your property')
                                + '</strong> for the last few days.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">What we’re seeing: '
                                + escapeHtml(res.message || 'Could not reach that calendar')
                                + '</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">Bookings we already knew about are still blocking those dates, but anything new booked on that site won’t reach us until this is fixed. Export links do sometimes get regenerated, so it’s worth copying yours again.</p>'
                                + button(SITE_URL + '/dashboard', 'Check your listing'),
                            'You’re receiving this because you host on Galloway Getaways.'
                        )
                    );

                    await admin
                        .from('listing_ical_feeds')
                        .update({ alerted_at: now })
                        .eq('id', feed.id);

                    alerted++;
                }
            }
        }
    }

    await recordCronRun(JOB, true, 'synced=' + ok + ' failed=' + failed + ' alerted=' + alerted);
    return NextResponse.json({ ok: true, synced: ok, failed: failed, alerted: alerted });
}
