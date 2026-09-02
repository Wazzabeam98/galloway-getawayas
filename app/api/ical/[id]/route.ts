import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { blockedRuns } from '@/lib/icalRuns';

export const dynamic = 'force-dynamic';

function icalDate(dateStr: string): string {
    // "2026-06-15" becomes "20260615", the whole-day format iCal expects.
    return String(dateStr).split('T')[0].replace(/-/g, '');
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    // Read with the service key. Bookings are protected by row-level security,
    // so the public key would return an empty calendar and quietly tell other
    // platforms every date was free.
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const token = req.nextUrl.searchParams.get('token');

    const { data: listing } = await supabase
        .from('listings')
        .select('id, ical_token')
        .eq('id', params.id)
        .maybeSingle();

    // The link is a secret. Without it anyone holding a listing id could read
    // when a property is occupied.
    if (!listing || !listing.ical_token || token !== listing.ical_token) {
        return new NextResponse('Not found', { status: 404 });
    }

    // Everything that makes a date unavailable here has to be unavailable
    // everywhere else too. A booking awaiting the host's answer still holds
    // the dates, so it counts.
    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, check_in, check_out, status')
        .eq('listing_id', params.id)
        .in('status', ['confirmed', 'pending', 'pending_payment']);

    const { data: blocks } = await supabase
        .from('calendar_overrides')
        .select('date')
        .eq('listing_id', params.id)
        .eq('is_blocked', true);

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Galloway Getaways//Booking Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Galloway Getaways',
    ];

    (bookings || []).forEach((b: any) => {
        lines.push(
            'BEGIN:VEVENT',
            // Tied to the booking, so the same stay keeps the same identifier
            // however the list is ordered next time.
            'UID:booking-' + b.id + '@gallowaygetaways.co.uk',
            'DTSTART;VALUE=DATE:' + icalDate(b.check_in),
            'DTEND;VALUE=DATE:' + icalDate(b.check_out),
            'SUMMARY:' + (b.status === 'confirmed' ? 'Reserved' : 'Reserved (pending)'),
            'END:VEVENT'
        );
    });

    // Runs of blocked days are joined into one entry each. A fortnight held
    // back would otherwise arrive in someone's calendar as fourteen separate
    // items. The run boundaries are calendar-day arithmetic (lib/icalRuns), so
    // the exclusive DTEND survives both DST transitions rather than dropping the
    // spring-forward night.
    blockedRuns((blocks || []).map((row: any) => row.date)).forEach((run) => {
        lines.push(
            'BEGIN:VEVENT',
            'UID:blocked-' + run.start + '-' + params.id + '@gallowaygetaways.co.uk',
            'DTSTART;VALUE=DATE:' + icalDate(run.start),
            'DTEND;VALUE=DATE:' + icalDate(run.endExclusive),
            'SUMMARY:Unavailable',
            'END:VEVENT'
        );
    });

    lines.push('END:VCALENDAR');

    return new NextResponse(lines.join('\r\n'), {
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="calendar.ics"',
            'Cache-Control': 'no-store',
        },
    });
}
