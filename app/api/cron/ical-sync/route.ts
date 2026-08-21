import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Tell the host after this many runs in a row have failed. One blip is usually
// the other platform being briefly unavailable and isn't worth an email.
const ALERT_AFTER = 3;

function parseICS(text: string): { start: string; end: string }[] {
    const events: { start: string; end: string }[] = [];
    const blocks = text.split('BEGIN:VEVENT').slice(1);

    for (const block of blocks) {
        const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
        const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
        if (!startMatch || !endMatch) continue;

        const toISO = (raw: string) =>
            raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);

        events.push({ start: toISO(startMatch[1]), end: toISO(endMatch[1]) });
    }

    return events;
}

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

    let ok = 0;
    let failed = 0;
    let alerted = 0;

    for (const feed of feeds || []) {
        try {
            const response = await fetch(feed.url, {
                headers: { 'User-Agent': 'GallowayGetawaysCalendarSync/1.0' },
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) throw new Error('The other site returned status ' + response.status);

            const text = await response.text();

            // A link to a web page or an image will fetch happily and parse to
            // nothing, which would look like an empty calendar and block no
            // dates at all. Better to treat it as broken.
            if (text.indexOf('BEGIN:VCALENDAR') === -1) {
                throw new Error('That link doesn\u2019t return a calendar');
            }

            const events = parseICS(text);

            await admin
                .from('listing_ical_feeds')
                .update({
                    events: events,
                    last_synced_at: now,
                    last_status: 'ok',
                    last_error: null,
                    failure_count: 0,
                    alerted_at: null,
                })
                .eq('id', feed.id);

            ok++;
        } catch (err: any) {
            const count = Number(feed.failure_count || 0) + 1;
            const message = (err && err.message) || 'Could not reach that calendar';

            // The cached events are deliberately left alone. A calendar we
            // can't reach today is not the same as a calendar with no
            // bookings, and treating it that way would free up dates that are
            // actually taken.
            await admin
                .from('listing_ical_feeds')
                .update({
                    last_synced_at: now,
                    last_status: 'failed',
                    last_error: message,
                    failure_count: count,
                })
                .eq('id', feed.id);

            failed++;

            if (count >= ALERT_AFTER && !feed.alerted_at) {
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
                                '<p style="margin:0 0 16px;font-size:16px;">We haven\u2019t been able to reach the <strong>'
                                    + escapeHtml(feed.label || 'imported')
                                    + '</strong> calendar on your listing <strong>'
                                    + escapeHtml(listing.title || 'your property')
                                    + '</strong> for the last few days.</p>'
                                    + '<p style="margin:0 0 16px;font-size:16px;">What we\u2019re seeing: '
                                    + escapeHtml(message)
                                    + '</p>'
                                    + '<p style="margin:0 0 16px;font-size:16px;">Bookings we already knew about are still blocking those dates, but anything new booked on that site won\u2019t reach us until this is fixed. Export links do sometimes get regenerated, so it\u2019s worth copying yours again.</p>'
                                    + button(SITE_URL + '/dashboard', 'Check your listing'),
                                'You\u2019re receiving this because you host on Galloway Getaways.'
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
    }

    return NextResponse.json({ ok: true, synced: ok, failed: failed, alerted: alerted });
}
