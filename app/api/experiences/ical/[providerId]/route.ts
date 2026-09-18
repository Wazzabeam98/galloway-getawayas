import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// THE EXPERIENCE EXPORT FEED — a provider's own calendar, out.
//
// The sibling of the cottage feed (/api/ical/[id]) but for a slot provider, and
// timed rather than whole-day: a session is hours in a day, so the events carry
// real start/end times in Europe/London. What goes out, so their own calendar
// shows their day and they don't book a dentist over a guest:
//   - BOOKED sessions (seats_taken > 0) — "Booked · N guests" / "Private hire"
//   - DECLARED sessions — their named event, whatever's booked into it
//   - their own PART-DAY BLOCKS (blocked, no source feed) — "Blocked"
// Imported blocks (source_feed_id set) are NOT re-exported — they came from the
// provider's other calendar; sending them back would loop.
//
// Read with the service key: slot_sessions is behind RLS, and the token is the
// secret that stands in for the provider's identity here.
const HORIZON_DAYS = 180;

// "17:00:00" (or "17:00") → "170000"; "2026-09-21" → "20260921".
function icalTime(t: string): string {
    const [h, m] = String(t).split(':');
    return String(h || '00').padStart(2, '0') + String(m || '00').padStart(2, '0') + '00';
}
function icalDate(d: string): string {
    return String(d).slice(0, 10).replace(/-/g, '');
}
function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
    const [hh, mm] = String(time).split(':').map((x) => parseInt(x, 10) || 0);
    const base = new Date(Date.UTC(2000, 0, 1, hh, mm));
    base.setUTCMinutes(base.getUTCMinutes() + Math.max(0, minutes || 0));
    const dayShift = Math.floor((hh * 60 + mm + Math.max(0, minutes || 0)) / 1440);
    const outDate = dayShift > 0 ? shiftDayKey(date.slice(0, 10), dayShift) : date.slice(0, 10);
    return { date: outDate, time: String(base.getUTCHours()).padStart(2, '0') + ':' + String(base.getUTCMinutes()).padStart(2, '0') };
}

function escapeText(s: string): string {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, ' ');
}

const VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/London',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
];

export async function GET(req: NextRequest, { params }: { params: { providerId: string } }) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const token = req.nextUrl.searchParams.get('token');

    const { data: provider } = await supabase
        .from('service_providers')
        .select('id, business_name, ical_token')
        .eq('id', params.providerId)
        .maybeSingle();

    if (!provider || !provider.ical_token || token !== provider.ical_token) {
        return new NextResponse('Not found', { status: 404 });
    }

    const from = londonDayKey();
    const to = shiftDayKey(from, HORIZON_DAYS);

    const { data: rows } = await supabase
        .from('slot_sessions')
        .select('id, session_date, session_time, duration_minutes, seats_taken, capacity, private, blocked, declared, title, source_feed_id')
        .eq('provider_id', params.providerId)
        .gte('session_date', from)
        .lt('session_date', to)
        .order('session_date', { ascending: true })
        .order('session_time', { ascending: true });

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Galloway Getaways//Experience Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:' + escapeText((provider.business_name || 'Galloway Getaways') + ' — sessions'),
        ...VTIMEZONE,
    ];

    for (const r of rows || []) {
        const booked = Number(r.seats_taken) > 0;
        const isBlock = r.blocked === true && !r.source_feed_id;
        const isDeclared = r.declared === true;
        // Empty placeholder rows, and imported blocks, have nothing to show the
        // provider that they didn't already put there themselves.
        if (!booked && !isBlock && !isDeclared) continue;

        const startTime = String(r.session_time).slice(0, 5);
        const dur = Number(r.duration_minutes) || 60;
        const end = addMinutes(r.session_date, startTime, dur);

        let summary: string;
        if (isBlock) summary = 'Blocked';
        else if (isDeclared) summary = (r.title || 'Session') + (booked ? ' · ' + r.seats_taken + ' booked' : '');
        else summary = r.private ? 'Private hire' : 'Booked · ' + r.seats_taken + ' guest' + (r.seats_taken === 1 ? '' : 's');

        lines.push(
            'BEGIN:VEVENT',
            'UID:exp-' + r.id + '@gallowaygetaways.co.uk',
            'DTSTART;TZID=Europe/London:' + icalDate(r.session_date) + 'T' + icalTime(startTime),
            'DTEND;TZID=Europe/London:' + icalDate(end.date) + 'T' + icalTime(end.time),
            'SUMMARY:' + escapeText(summary),
            'END:VEVENT'
        );
    }

    lines.push('END:VCALENDAR');

    return new NextResponse(lines.join('\r\n'), {
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="galloway-sessions.ics"',
            'Cache-Control': 'no-store',
        },
    });
}
