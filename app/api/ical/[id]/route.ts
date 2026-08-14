import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Env from '@/config/Env';

function formatDate(dateStr: string): string {
    // Turn "2026-06-15" into the "20260615" format iCal expects for whole-day events.
    return dateStr.replace(/-/g, '');
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const supabase = createClient(Env.SUPABASE_URL, Env.SUPABASE_KEY);

    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('check_in, check_out')
        .eq('listing_id', params.id)
        .eq('status', 'confirmed');

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Galloway Getaways//Booking Calendar//EN',
        'CALSCALE:GREGORIAN',
    ];

    (bookings || []).forEach((b, i) => {
        lines.push(
            'BEGIN:VEVENT',
            `UID:galloway-getaways-${params.id}-${i}@galloway-getaways`,
            `DTSTART;VALUE=DATE:${formatDate(b.check_in)}`,
            `DTEND;VALUE=DATE:${formatDate(b.check_out)}`,
            'SUMMARY:Reserved',
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
