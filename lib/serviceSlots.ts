// The slot shape: pure rules for the third booking model.
//
// Same discipline as lib/serviceOrders.ts — no queries, so the booking route,
// the availability generator and the tests all read the same rules. The one
// thing that CANNOT live here is the seat claim itself: that is a single atomic
// UPDATE in the route (seats_taken <= capacity), because only the database can
// make "check and take" one indivisible step. Everything around it is here.

export type Shape = 'made_to_order' | 'comes_to_you' | 'slot';

export const SHAPES: Shape[] = ['made_to_order', 'comes_to_you', 'slot'];

/** The shape a provider is, defaulting safely to the request engine. */
export function shapeOf(provider: { shape?: string | null } | null | undefined): Shape {
    const s = provider && provider.shape;
    return (SHAPES as string[]).includes(String(s)) ? (s as Shape) : 'made_to_order';
}

/** A slot is the only instant shape — paid on booking, no provider approval. */
export function isSlot(provider: any): boolean {
    return shapeOf(provider) === 'slot';
}

/** comes_to_you holds the date exclusively; the others do not. */
export function isExclusiveShape(provider: any): boolean {
    return shapeOf(provider) === 'comes_to_you';
}

/** Guest-facing words for the shape — the cue on a marketplace card. */
export function shapeCue(shape: string): string {
    const map: Record<Shape, string> = {
        made_to_order: 'Made for your dates',
        comes_to_you: 'Comes to your cottage',
        slot: 'Book a time',
    };
    return map[shapeOf({ shape })];
}

// ---------------------------------------------------------------------------
// GENERATING SESSIONS FROM THE WEEKLY TEMPLATE
// ---------------------------------------------------------------------------
//
// A provider sets recurring opening hours per weekday, a slot length and a
// capacity. Concrete sessions are generated on the fly for a guest's stay —
// nothing is stored until a booking claims a seat. A blocked date drops its
// whole day.

export interface Availability { day_of_week: number; open_time: string; close_time: string; }

export interface GeneratedSession { date: string; time: string; }

/** "HH:MM[:SS]" → minutes past midnight. */
function toMinutes(t: string): number {
    const [h, m] = String(t).split(':');
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

/** minutes past midnight → "HH:MM". */
function toClock(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** yyyy-mm-dd → 0..6 (0 = Sunday), UTC to match the date-only keys. */
function dowOf(dateKey: string): number {
    return new Date(dateKey + 'T00:00:00Z').getUTCDay();
}

/** Step a yyyy-mm-dd forward by one day, staying a date-only key. */
function nextDay(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Every bookable session between fromDate and toDate inclusive (date-only keys),
 * from the weekly template, minus blocked days. Ordered by date then time.
 *
 * lengthMinutes is the step; a session at open_time, then every length until the
 * last one that still finishes by close_time. A guard caps the horizon so a
 * malformed template can never spin.
 */
export function generateSessions(
    availability: Availability[],
    blocks: string[],
    lengthMinutes: number,
    fromDate: string,
    toDate: string
): GeneratedSession[] {
    const length = Math.max(1, Number(lengthMinutes) || 0);
    const blocked = new Set(blocks);
    const byDow: Record<number, Availability[]> = {};
    for (const a of availability || []) (byDow[a.day_of_week] = byDow[a.day_of_week] || []).push(a);

    const out: GeneratedSession[] = [];
    let date = fromDate;
    for (let guard = 0; guard < 400 && date <= toDate; guard++, date = nextDay(date)) {
        if (blocked.has(date)) continue;
        const windows = byDow[dowOf(date)] || [];
        for (const w of windows) {
            const open = toMinutes(w.open_time);
            const close = toMinutes(w.close_time);
            for (let start = open; start + length <= close; start += length) {
                out.push({ date, time: toClock(start) });
            }
        }
    }
    out.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    return out;
}

// ---------------------------------------------------------------------------
// CAPACITY
// ---------------------------------------------------------------------------
//
// Per-person price ⇒ capacity is people, a booking takes its quantity of them.
// Whole-slot (flat) price ⇒ capacity is one booking, quantity is always one.

/** The capacity a materialised session should carry, from the provider config. */
export function sessionCapacity(provider: any, unit: string): number {
    if (String(unit) === 'flat') return 1;               // a private/whole slot
    const n = Number(provider && provider.slot_capacity);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Places still open on a session. Never negative. */
export function seatsLeft(session: { capacity: number; seats_taken: number }): number {
    return Math.max(0, Number(session.capacity) - Number(session.seats_taken));
}

// ---------------------------------------------------------------------------
// CANCELLATION — SHAPE-AWARE
// ---------------------------------------------------------------------------
//
// One window column (hours), two readings. The request shapes measure it in days
// before the service DATE; a slot measures it in hours before the service TIME,
// because a seat is perishable and a date has no time to count from. The window
// only bites near the moment; before it, a full refund is automatic, and a slot
// cancel additionally releases the seat (handled in the route).

/** The absolute instant a free cancel stops being automatic. */
export function freeCancelDeadline(
    shape: string,
    serviceDate: string,
    serviceTime: string | null,
    windowHours: number
): Date {
    // A slot counts from the session time; the others from the start of the
    // service day (there is no time to count from, and a day's notice is a day).
    const timePart = shapeOf({ shape }) === 'slot' && serviceTime ? serviceTime : '00:00';
    const when = new Date(serviceDate + 'T' + (timePart.length === 5 ? timePart + ':00' : timePart) + 'Z');
    return new Date(when.getTime() - Math.max(0, Number(windowHours) || 0) * 3600 * 1000);
}

/** True while a full refund is still automatic — before the deadline. */
export function guestMayCancelFree(
    shape: string,
    serviceDate: string,
    serviceTime: string | null,
    windowHours: number,
    now: Date
): boolean {
    const deadline = freeCancelDeadline(shape, serviceDate, serviceTime, windowHours);
    if (isNaN(deadline.getTime())) return false;   // an unreadable date is never free
    return now.getTime() <= deadline.getTime();
}

// How long a slot seat is held across Checkout before the sweep releases it.
// Stripe won't let a Checkout Session expire in under 30 minutes, and the hold
// and the session must expire together (otherwise a payment could complete
// after the seat was released). So the hold is 30 minutes — the floor Stripe
// imposes — not the 15 first sketched. The sweep's 5-minute grace then releases
// an abandoned seat at ~35 minutes, safely after the Checkout is dead.
export const SLOT_HOLD_MINUTES = 30;
