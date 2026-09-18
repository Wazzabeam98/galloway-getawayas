import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { parseBusyIntervals } from '@/lib/icalParse';
import { minutesOfDay } from '@/lib/serviceSlots';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// IMPORT a provider's personal calendar so an outside commitment blocks the
// matching hour here. Each external busy interval is MATERIALISED as an ordinary
// part-day block (a blocked slot_sessions row, tagged with the feed) so the
// existing no-overlap exclusion is the authority — availability and the book
// route already honour blocked rows, unchanged.
//
// SELF-HEALING. Each successful run replaces this feed's blocks wholesale: delete
// the feed's own rows, insert the current set. A moved event moves; a deleted one
// frees its hour next run. A FETCH FAILURE leaves the blocks alone (a calendar we
// can't reach is not an empty one) and, after three in a row, emails the provider.
//
// THE BOOKING WINS. The DB refuses a block that overlaps a booked or declared
// session (23P01); we skip it and record a CLASH on the feed — which event, which
// booking — for the provider's warning. A dentist appointment can never quietly
// cancel a guest.

const HORIZON_DAYS = 180;
const ALERT_AFTER = 3;

const clock = (min: number) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

interface Clash {
    date: string; start: string; end: string; summary: string;
    conflict: { kind: 'booking' | 'declared'; time: string; detail: string };
}

// What a refused block overlaps, IF it's a booking or a declared session (the
// things worth warning about). Overlap with the provider's OWN hand-made block is
// harmless — the hour is already held — so it returns null and no warning fires.
async function describeConflict(admin: any, providerId: string, date: string, startMin: number, endMin: number): Promise<Clash['conflict'] | null> {
    const { data: rows } = await admin
        .from('slot_sessions')
        .select('session_time, duration_minutes, turnaround_minutes, seats_taken, capacity, declared, title')
        .eq('provider_id', providerId)
        .eq('session_date', date);
    for (const r of rows || []) {
        const booked = Number(r.seats_taken) > 0;
        const declared = r.declared === true;
        if (!booked && !declared) continue;
        const t = minutesOfDay(String(r.session_time).slice(0, 5));
        const span = (Number(r.duration_minutes) || 0) + (declared ? Number(r.turnaround_minutes) || 0 : 0);
        if (t < endMin && t + span > startMin) {
            return declared
                ? { kind: 'declared', time: clock(t), detail: (r.title || 'a declared session') + (booked ? ' (' + r.seats_taken + ' booked)' : '') }
                : { kind: 'booking', time: clock(t), detail: r.seats_taken + ' guest' + (r.seats_taken === 1 ? '' : 's') + ' booked' };
        }
    }
    return null;
}

async function syncFeed(admin: any, feed: any, from: string, to: string): Promise<Clash[]> {
    const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'GallowayGetawaysCalendarSync/1.0' },
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('The other site returned status ' + response.status);
    const text = await response.text();
    if (text.indexOf('BEGIN:VCALENDAR') === -1) throw new Error('That link doesn’t return a calendar');

    const intervals = parseBusyIntervals(text, from, to);

    // Wholesale replace: drop this feed's prior blocks, then lay the current set.
    await admin.from('slot_sessions').delete().eq('source_feed_id', feed.id);

    const clashes: Clash[] = [];
    for (const iv of intervals) {
        const { error } = await admin.from('slot_sessions').insert({
            provider_id: feed.provider_id,
            session_date: iv.date,
            session_time: clock(iv.startMin),
            duration_minutes: iv.endMin - iv.startMin,
            turnaround_minutes: 0,
            seats_taken: 0,
            capacity: 1,
            blocked: true,
            private: false,
            source_feed_id: feed.id,
        });
        if (error) {
            // 23P01 overlap / 23505 same-start: the hour is already spoken for.
            const conflict = await describeConflict(admin, feed.provider_id, iv.date, iv.startMin, iv.endMin);
            if (conflict) {
                clashes.push({ date: iv.date, start: clock(iv.startMin), end: clock(iv.endMin), summary: iv.summary || 'Busy', conflict });
            }
            // else it merely overlapped a block already there — nothing to warn about.
        }
    }
    return clashes;
}

async function alertProvider(admin: any, feed: any, message: string) {
    const { data: provider } = await admin
        .from('service_providers')
        .select('business_name, owner_id')
        .eq('id', feed.provider_id)
        .maybeSingle();
    if (!provider || !provider.owner_id) return false;
    const { data: ownerUser } = await admin.auth.admin.getUserById(provider.owner_id);
    const email = (ownerUser && ownerUser.user && ownerUser.user.email) || '';
    if (!email) return false;

    await sendEmail(
        email,
        'One of your calendars has stopped syncing',
        emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">We haven’t been able to reach the <strong>'
                + escapeHtml(feed.label || 'imported')
                + '</strong> calendar you connected to <strong>'
                + escapeHtml(provider.business_name || 'your experiences')
                + '</strong> for the last few days.</p>'
                + '<p style="margin:0 0 16px;font-size:16px;">What we’re seeing: ' + escapeHtml(message) + '</p>'
                + '<p style="margin:0 0 16px;font-size:16px;">The hours we already blocked from it are still blocked, but anything new in that calendar won’t block a session here until this is fixed. Export links do get regenerated, so it’s worth copying yours again.</p>'
                + button(SITE_URL + '/services/dashboard', 'Open your calendar'),
            'You’re receiving this because you run experiences on Galloway Getaways.'
        )
    );
    return true;
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date().toISOString();
    const from = londonDayKey();
    const to = shiftDayKey(from, HORIZON_DAYS);

    const { data: feeds } = await admin
        .from('provider_ical_feeds')
        .select('id, provider_id, url, label, failure_count, alerted_at');

    let ok = 0, failed = 0, alerted = 0, clashCount = 0;

    for (const feed of feeds || []) {
        try {
            const clashes = await syncFeed(admin, feed, from, to);
            clashCount += clashes.length;
            await admin.from('provider_ical_feeds').update({
                clashes,
                last_synced_at: now,
                last_status: 'ok',
                last_error: null,
                failure_count: 0,
                alerted_at: null,
            }).eq('id', feed.id);
            ok++;
        } catch (err: any) {
            const count = Number(feed.failure_count || 0) + 1;
            const message = (err && err.message) || 'Could not reach that calendar';
            // Cached blocks are left in place on purpose — see the header.
            await admin.from('provider_ical_feeds').update({
                last_synced_at: now, last_status: 'failed', last_error: message, failure_count: count,
            }).eq('id', feed.id);
            failed++;
            if (count >= ALERT_AFTER && !feed.alerted_at) {
                if (await alertProvider(admin, feed, message)) {
                    await admin.from('provider_ical_feeds').update({ alerted_at: now }).eq('id', feed.id);
                    alerted++;
                }
            }
        }
    }

    return NextResponse.json({ ok: true, synced: ok, failed, alerted, clashes: clashCount });
}
