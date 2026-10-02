// Parse an .ics feed into BUSY INTERVALS a provider's day, in Europe/London.
//
// The cottage sync (app/api/cron/ical-sync) only reads 8-digit whole-day dates —
// a night is a whole day. An experience is hours within a day, so this reads
// TIMED events too (DTSTART/DTEND with T-times, in UTC "Z" or with a TZID) and
// turns each event into one or more { date, startMin, endMin } spans, merged per
// day. An all-day event blocks the whole day (0..1440). Everything is expressed
// as London wall-clock minutes-from-midnight, which is what a slot session is.
//
// Deliberately forgiving: an event we can't read is skipped, not fatal — a
// broken line shouldn't drop the rest of someone's calendar.

const DAY = 1440;

export interface BusyInterval {
    date: string;      // YYYY-MM-DD (London)
    startMin: number;  // minutes from midnight, London
    endMin: number;    // exclusive
    allDay: boolean;
    summary: string;   // the event's title, for the clash warning; '' if none
}

// Unfold RFC-5545 line folding (a CRLF followed by a space/tab continues a line).
function unfold(text: string): string {
    return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}
function keyOf(y: number, mo: number, d: number): string {
    return y + '-' + pad(mo) + '-' + pad(d);
}
function addDays(y: number, mo: number, d: number, n: number): [number, number, number] {
    const t = new Date(Date.UTC(y, mo - 1, d + n));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

// A wall-clock point: London calendar date + minutes from midnight.
interface Wall { y: number; mo: number; d: number; min: number; }

const londonFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
});

// A UTC instant → the London wall-clock it reads as (handles GMT/BST itself).
function utcToLondon(y: number, mo: number, d: number, h: number, mi: number): Wall {
    const instant = new Date(Date.UTC(y, mo - 1, d, h, mi));
    const p: Record<string, string> = {};
    for (const part of londonFmt.formatToParts(instant)) p[part.type] = part.value;
    let hour = parseInt(p.hour, 10);
    if (hour === 24) hour = 0; // some environments emit 24 for midnight
    return { y: parseInt(p.year, 10), mo: parseInt(p.month, 10), d: parseInt(p.day, 10), min: hour * 60 + parseInt(p.minute, 10) };
}

// Read one DTSTART/DTEND line's value into a Wall point (and whether it's a date).
// Forms handled: `;VALUE=DATE:YYYYMMDD` (all-day), `:YYYYMMDDTHHMMSSZ` (UTC),
// `;TZID=...:YYYYMMDDTHHMMSS` and bare `:YYYYMMDDTHHMMSS` (treated as London wall
// time — the common case for a UK provider; a non-London TZID is read as its wall
// time, which is the safe-busy direction).
function readPoint(line: string): { wall: Wall; allDay: boolean } | null {
    const m = line.match(/^(?:DTSTART|DTEND)([^:]*):\s*([0-9T]+Z?)/i);
    if (!m) return null;
    const params = m[1].toUpperCase();
    const raw = m[2];

    const dateOnly = /^\d{8}$/.test(raw) || /VALUE=DATE(?!-TIME)/.test(params);
    const y = parseInt(raw.slice(0, 4), 10);
    const mo = parseInt(raw.slice(4, 6), 10);
    const d = parseInt(raw.slice(6, 8), 10);
    if (!y || !mo || !d) return null;

    if (dateOnly) return { wall: { y, mo, d, min: 0 }, allDay: true };

    const h = parseInt(raw.slice(9, 11), 10) || 0;
    const mi = parseInt(raw.slice(11, 13), 10) || 0;
    const isUtc = /Z$/.test(raw);
    const wall = isUtc ? utcToLondon(y, mo, d, h, mi) : { y, mo, d, min: h * 60 + mi };
    return { wall, allDay: false };
}

// Split a start→end span (London wall time) into per-day [startMin, endMin) spans.
function splitByDay(start: Wall, end: Wall, allDay: boolean, summary: string): BusyInterval[] {
    const out: BusyInterval[] = [];
    // Guard against absurd ranges (a malformed feed) — cap at 366 days.
    let [y, mo, d] = [start.y, start.mo, start.d];
    const endKey = keyOf(end.y, end.mo, end.d);
    for (let i = 0; i < 366; i++) {
        const k = keyOf(y, mo, d);
        const isFirst = i === 0;
        const isLast = k === endKey;
        // All-day DTEND is exclusive: the end day itself is not blocked.
        if (allDay && isLast) break;
        const startMin = isFirst && !allDay ? start.min : 0;
        const endMin = isLast && !allDay ? end.min : DAY;
        if (endMin > startMin) out.push({ date: k, startMin, endMin, allDay, summary });
        if (isLast) break;
        [y, mo, d] = addDays(y, mo, d, 1);
    }
    return out;
}

function mergePerDay(items: BusyInterval[]): BusyInterval[] {
    const byDate = new Map<string, BusyInterval[]>();
    for (const it of items) {
        const list = byDate.get(it.date);
        if (list) list.push(it); else byDate.set(it.date, [it]);
    }
    const out: BusyInterval[] = [];
    for (const list of Array.from(byDate.values())) {
        list.sort((a, b) => a.startMin - b.startMin);
        let cur: BusyInterval | null = null;
        for (const it of list) {
            if (cur && it.startMin <= cur.endMin) {
                if (it.endMin > cur.endMin) cur.endMin = it.endMin;
                cur.allDay = cur.allDay || it.allDay;
                if (!cur.summary) cur.summary = it.summary;
            } else {
                if (cur) out.push(cur);
                cur = { ...it };
            }
        }
        if (cur) out.push(cur);
    }
    return out.sort((a, b) => (a.date + pad(a.startMin) < b.date + pad(b.startMin) ? -1 : 1));
}

/**
 * Parse an .ics document into merged busy intervals, dropping anything outside
 * [fromKey, toKey) and any event explicitly marked free (TRANSP:TRANSPARENT) or
 * cancelled (STATUS:CANCELLED). Returns [] for something that isn't a calendar.
 */
export function parseBusyIntervals(text: string, fromKey: string, toKey: string): BusyInterval[] {
    if (!text || text.indexOf('BEGIN:VCALENDAR') === -1) return [];
    const unfolded = unfold(text);
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
    const raw: BusyInterval[] = [];

    for (const block of blocks) {
        const body = block.split('END:VEVENT')[0];
        if (/^TRANSP:\s*TRANSPARENT/im.test(body)) continue;
        if (/^STATUS:\s*CANCELLED/im.test(body)) continue;

        const startLine = (body.match(/^DTSTART[^\r\n]*/im) || [])[0];
        const endLine = (body.match(/^DTEND[^\r\n]*/im) || [])[0];
        if (!startLine) continue;

        const start = readPoint(startLine);
        if (!start) continue;
        let end = endLine ? readPoint(endLine) : null;
        // No DTEND: an all-day event is one day; a timed one defaults to an hour.
        if (!end) {
            end = start.allDay
                ? { wall: (() => { const [y, mo, d] = addDays(start.wall.y, start.wall.mo, start.wall.d, 1); return { y, mo, d, min: 0 }; })(), allDay: true }
                : { wall: { ...start.wall, min: Math.min(DAY, start.wall.min + 60) }, allDay: false };
        }

        const summaryLine = (body.match(/^SUMMARY[^:]*:([^\r\n]*)/im) || [])[1] || '';
        const summary = summaryLine.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim().slice(0, 120);

        for (const span of splitByDay(start.wall, end.wall, start.allDay || end.allDay, summary)) {
            if (span.date >= fromKey && span.date < toKey) raw.push(span);
        }
    }

    return mergePerDay(raw);
}
