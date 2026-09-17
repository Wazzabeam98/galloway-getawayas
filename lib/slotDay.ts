// Shape one day into its slots — the single source both the month tick-strip and
// the day time-axis read, so a day reads the same at a glance and up close.
//
// A day is the provider's generated open-hours slots (from the weekly template),
// with the real things overlaid: booked open-hours sessions, the provider's
// declared sessions (a class), private hires, and partial blocks. Pure: no
// queries, so it can run on the server or in the browser and be unit-tested.

import { generateSessions, minutesOfDay, type Availability } from './serviceSlots';

export type SlotKind = 'free' | 'session' | 'private' | 'declared';

export interface DaySlotRow {
    startMin: number; endMin: number; time: string;      // "HH:MM"
    kind: SlotKind;
    title?: string | null;
    capacity?: number; seatsTaken?: number; seatsLeft?: number;
    declaredId?: string | null;
}
export interface DayBand { startMin: number; endMin: number; id: string }
export interface DayData {
    rows: DaySlotRow[];
    bands: DayBand[];
    dayOff: boolean;
    windowStart: number;   // minutes-of-day the timeline starts at
    windowEnd: number;     // and ends at
    booked: number;        // sessions/hires with a booking, for the month count
    added: number;         // declared sessions with no booking yet
    free: number;          // empty open-hours slots
}

export interface DayInputs {
    availabilityRows: Availability[];
    slotLen: number;
    blockedDates: string[];
    partialBlocks: { date: string; startMin: number; endMin: number; id?: string }[];
    sessions: { date: string; time: string; capacity: number; seats_taken: number; seats_left: number; private: boolean }[];
    declared: { id: string; date: string; time: string; capacity: number; seats_taken: number; title: string | null; duration_minutes?: number | null }[];
    // What an as-yet-unbooked slot could hold — resolved by the caller through
    // seatConfig (item wins, else the provider default), so a free slot's "N free"
    // matches what the guest could actually book. null for a private-only provider
    // (a free slot is a whole-session hire, no seat count).
    freeCapacity: number | null;
}

const dowOf = (dateKey: string) => new Date(dateKey + 'T00:00:00Z').getUTCDay();

export function daySlots(date: string, i: DayInputs): DayData {
    const slotLen = Math.max(15, Number(i.slotLen) || 60);
    const dayOff = i.blockedDates.includes(date);
    const dayPartials = i.partialBlocks.filter((p) => p.date === date);

    // Open-hours slots from the template, minus part-blocked starts. None on a full
    // day off — the whole day reads as off instead.
    const gen = dayOff ? [] : generateSessions(
        i.availabilityRows, [], slotLen, date, date, slotLen,
        dayPartials.map((p) => ({ date, startMin: p.startMin, endMin: p.endMin })),
    );

    const byTime = new Map<string, DaySlotRow>();
    const freeCap = i.freeCapacity != null && i.freeCapacity > 0 ? i.freeCapacity : undefined;
    for (const g of gen) { const sm = minutesOfDay(g.time); byTime.set(g.time, { startMin: sm, endMin: sm + slotLen, time: g.time, kind: 'free', capacity: freeCap, seatsTaken: 0, seatsLeft: freeCap }); }

    // Declared sessions (violet) win their time — booked or not.
    const declaredHere = i.declared.filter((d) => d.date === date);
    const declaredTimes = new Set(declaredHere.map((d) => String(d.time).slice(0, 5)));
    for (const d of declaredHere) {
        const t = String(d.time).slice(0, 5); const sm = minutesOfDay(t);
        const dur = Number(d.duration_minutes) || slotLen;
        byTime.set(t, { startMin: sm, endMin: sm + dur, time: t, kind: 'declared', title: d.title, capacity: d.capacity, seatsTaken: d.seats_taken, seatsLeft: Math.max(0, d.capacity - d.seats_taken), declaredId: d.id });
    }
    // Booked open-hours sessions (emerald) — a private hire is one taken whole.
    for (const s of i.sessions.filter((x) => x.date === date)) {
        const t = String(s.time).slice(0, 5);
        if (declaredTimes.has(t)) continue;   // a booked declared session stays violet
        const sm = minutesOfDay(t);
        byTime.set(t, { startMin: sm, endMin: sm + slotLen, time: t, kind: s.private ? 'private' : 'session', capacity: s.capacity, seatsTaken: s.seats_taken, seatsLeft: s.seats_left });
    }

    const rows = Array.from(byTime.values()).sort((a, b) => a.startMin - b.startMin);
    const bands: DayBand[] = dayPartials.map((p, n) => ({ startMin: p.startMin, endMin: p.endMin, id: p.id || `band-${date}-${n}` }));

    // The timeline window: the weekday's open→close, widened to hold anything
    // outside it (an evening class, an early block), with a sane fallback.
    const windows = i.availabilityRows.filter((a) => a.day_of_week === dowOf(date));
    let ws = Infinity, we = -Infinity;
    for (const w of windows) { ws = Math.min(ws, minutesOfDay(String(w.open_time).slice(0, 5))); we = Math.max(we, minutesOfDay(String(w.close_time).slice(0, 5))); }
    for (const r of rows) { ws = Math.min(ws, r.startMin); we = Math.max(we, r.endMin); }
    for (const b of bands) { ws = Math.min(ws, b.startMin); we = Math.max(we, b.endMin); }
    if (!isFinite(ws)) { ws = 9 * 60; we = 17 * 60; }
    // Snap to the hour and pad a touch so first/last rows aren't flush to the edge.
    ws = Math.floor(ws / 60) * 60; we = Math.ceil(we / 60) * 60;
    if (we <= ws) we = ws + 60;

    const booked = rows.filter((r) => r.kind === 'private' || r.kind === 'session' || (r.kind === 'declared' && (r.seatsTaken || 0) > 0)).length;
    const added = rows.filter((r) => r.kind === 'declared' && (r.seatsTaken || 0) === 0).length;
    const free = rows.filter((r) => r.kind === 'free').length;

    return { rows, bands, dayOff, windowStart: ws, windowEnd: we, booked, added, free };
}

// The compact per-day summary the month cell paints — a tick per slot in time
// order (blocks interleaved), plus the counts.
export type Tick = 'free' | 'session' | 'private' | 'declared' | 'declared-empty' | 'block';
export function dayTicks(d: DayData): Tick[] {
    const marks: { at: number; tick: Tick }[] = [];
    for (const r of d.rows) marks.push({ at: r.startMin, tick: r.kind === 'declared' ? (((r.seatsTaken || 0) > 0) ? 'declared' : 'declared-empty') : r.kind });
    for (const b of d.bands) marks.push({ at: b.startMin, tick: 'block' });
    return marks.sort((a, b) => a.at - b.at).map((m) => m.tick);
}
