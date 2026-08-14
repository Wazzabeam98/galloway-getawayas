import { NextRequest, NextResponse } from 'next/server';

// Minimal iCal parser: pulls DTSTART/DTEND out of each VEVENT block.
// Handles whole-day values (DTSTART;VALUE=DATE:20260615) and
// timestamp values (DTSTART:20260615T140000Z) — for blocking purposes
// we only need the date portion either way.
function parseICS(text: string): { start: string; end: string }[] {
    const events: { start: string; end: string }[] = [];
    const blocks = text.split('BEGIN:VEVENT').slice(1);

    for (const block of blocks) {
        const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
        const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
        if (!startMatch || !endMatch) continue;

        const toISO = (raw: string) => {
            const y = raw.slice(0, 4);
            const m = raw.slice(4, 6);
            const d = raw.slice(6, 8);
            return `${y}-${m}-${d}`;
        };

        events.push({ start: toISO(startMatch[1]), end: toISO(endMatch[1]) });
    }

    return events;
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing calendar URL.' }, { status: 400 });
    }

    let target: URL;
    try {
        target = new URL(url);
        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
            throw new Error('Invalid protocol');
        }
    } catch {
        return NextResponse.json({ error: 'That doesn\'t look like a valid calendar URL.' }, { status: 400 });
    }

    try {
        const response = await fetch(target.toString(), {
            headers: { 'User-Agent': 'GallowayGetawaysCalendarSync/1.0' },
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return NextResponse.json({ error: `Could not reach that calendar (status ${response.status}).` }, { status: 502 });
        }

        const text = await response.text();
        const events = parseICS(text);

        return NextResponse.json({ events });
    } catch (err: any) {
        const message = err?.name === 'TimeoutError' ? 'That calendar took too long to respond.' : 'Could not read that calendar.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
