import { shiftDayKey } from './dayKey';

// Joining blocked days into runs for the iCal export.
//
// A run of blocked nights becomes one VEVENT. iCal's DATE-valued DTEND is
// EXCLUSIVE, so a single blocked night on 2026-03-29 is [2026-03-29, 2026-03-30):
// DTSTART the 29th, DTEND the 30th.
//
// The day-after used to be `new Date(runEnd); setDate(+1); toISOString()`, which
// adds a day to an INSTANT. On the spring-forward Sunday that lands back on the
// same calendar day, so DTEND equalled DTSTART, the event was zero-length, and
// the exported unavailable run came out a night short — a night another platform
// could then sell over the top of. Built on shiftDayKey (calendar-part
// arithmetic), the boundary survives both DST transitions.

export interface BlockedRun {
    start: string;         // yyyy-mm-dd, inclusive
    endExclusive: string;  // yyyy-mm-dd, exclusive (DTEND)
}

export function blockedRuns(days: string[]): BlockedRun[] {
    const sorted = Array.from(new Set(days.map((d) => String(d).slice(0, 10)))).sort();

    const runs: BlockedRun[] = [];
    let start: string | null = null;
    let end: string | null = null;

    for (const day of sorted) {
        if (start === null) {
            start = day;
            end = day;
            continue;
        }
        // Contiguous with the run so far?
        if (day === shiftDayKey(end as string, 1)) {
            end = day;
        } else {
            runs.push({ start, endExclusive: shiftDayKey(end as string, 1) });
            start = day;
            end = day;
        }
    }

    if (start !== null) {
        runs.push({ start, endExclusive: shiftDayKey(end as string, 1) });
    }

    return runs;
}
