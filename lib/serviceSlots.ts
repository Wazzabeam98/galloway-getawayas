// The slot shape: pure rules for the third booking model.
//
// Same discipline as lib/serviceOrders.ts — no queries, so the booking route,
// the availability generator and the tests all read the same rules. The one
// thing that CANNOT live here is the seat claim itself: that is a single atomic
// UPDATE in the route (seats_taken <= capacity), because only the database can
// make "check and take" one indivisible step. Everything around it is here.

import { shiftDayKey } from './dayKey';

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
        comes_to_you: 'Comes to where you’re staying',
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

// A partial block: a range [startMin, endMin) on one date that no booking may
// touch. The database is the authority (a block is a slot_sessions row counted by
// the no-overlap exclusion); this shape is what the wizard-free surfaces — the
// guest grid and the claim's legibility check — use to grey/skip covered starts,
// so the guest never even sees a start the database would then refuse.
export interface PartialBlock { date: string; startMin: number; endMin: number; }

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
    return shiftDayKey(dateKey, 1);
}

/**
 * Every bookable session between fromDate and toDate inclusive (date-only keys),
 * from the weekly template, minus blocked days. Ordered by date then time.
 *
 * stepMinutes is the spacing between starts; fitMinutes is how much room a start
 * needs before close_time to be offered. They are the same for a fixed-grid
 * provider (one length back-to-back). They DIFFER for the per-treatment shape:
 * the grid steps by duration + turnaround (so consecutive bookings never overlap
 * once the reset gap is counted), while a start only has to leave room for the
 * treatment itself (duration) before close — the trailing turnaround after the
 * last booking of the day is not required. fitMinutes defaults to stepMinutes, so
 * every existing caller keeps today's exact grid. A guard caps the horizon so a
 * malformed template can never spin.
 */
export function generateSessions(
    availability: Availability[],
    blocks: string[],
    stepMinutes: number,
    fromDate: string,
    toDate: string,
    fitMinutes?: number,
    partialBlocks?: PartialBlock[]
): GeneratedSession[] {
    const step = Math.max(1, Number(stepMinutes) || 0);
    const fit = Math.max(1, Number(fitMinutes) || step);
    const blocked = new Set(blocks);
    const byDow: Record<number, Availability[]> = {};
    for (const a of availability || []) (byDow[a.day_of_week] = byDow[a.day_of_week] || []).push(a);
    // Partial blocks grouped by date. A start is dropped when the interval a
    // booking there would occupy — [start, start + step), the same span the
    // database exclusion measures — overlaps a block. Mirrors the DB guard so the
    // grid never offers a start the claim would then refuse.
    const blocksByDate: Record<string, PartialBlock[]> = {};
    for (const pb of partialBlocks || []) (blocksByDate[pb.date] = blocksByDate[pb.date] || []).push(pb);

    const out: GeneratedSession[] = [];
    let date = fromDate;
    for (let guard = 0; guard < 400 && date <= toDate; guard++, date = nextDay(date)) {
        if (blocked.has(date)) continue;
        const dayBlocks = blocksByDate[date] || [];
        const windows = byDow[dowOf(date)] || [];
        for (const w of windows) {
            const open = toMinutes(w.open_time);
            const close = toMinutes(w.close_time);
            for (let start = open; start + fit <= close; start += step) {
                const busy = { startMin: start, endMin: start + step };
                if (dayBlocks.some((pb) => intervalsOverlap(busy, { startMin: pb.startMin, endMin: pb.endMin }))) continue;
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

/**
 * True when the provider has a real per-person capacity. A shared table needs a
 * set number of seats; a per-person item without one is misconfigured. Left to
 * sessionCapacity() it would fall back to a single seat and the "shared" table
 * would sell as a one-seat private hire at a per-person price. The booking route
 * uses this to refuse such an item before the seat is claimed.
 */
export function hasSlotCapacity(provider: any): boolean {
    const n = Number(provider && provider.slot_capacity);
    return Number.isInteger(n) && n >= 1;
}

/** The capacity a materialised session should carry, from the provider config. */
export function sessionCapacity(provider: any, unit: string): number {
    if (String(unit) === 'flat') return 1;               // a private/whole slot
    // The fallback to 1 stays as a last-ditch safety, but the booking route no
    // longer relies on it: a per-person item with no capacity is refused up front
    // (see hasSlotCapacity), never quietly sold as a single seat.
    return hasSlotCapacity(provider) ? Number(provider.slot_capacity) : 1;
}

/** Places still open on a session. Never negative. */
export function seatsLeft(session: { capacity: number; seats_taken: number }): number {
    return Math.max(0, Number(session.capacity) - Number(session.seats_taken));
}

// ---------------------------------------------------------------------------
// PRIVATE HIRE vs SHARED TABLE — a slot time is sold as one or the other
// ---------------------------------------------------------------------------
//
// The item's unit decides which a BOOKING is: a flat (whole-session) price is a
// private hire; a per-person price is a seat at a shared table. The mode is then
// pinned to the TIME by whoever books it first, recorded on slot_sessions.private
// (see 20260912090000_slot_session_mode.sql). These are the pure rules; the
// booking route carries them out atomically.

/** A booking of this item is a private hire — it takes the whole session. */
export function bookingIsPrivate(unit: string | null | undefined): boolean {
    return String(unit) === 'flat';
}

// WHAT A SLOT PROVIDER OFFERS — private hire, a shared table, or both.
//
// There is no stored "offering" column: it is inferred from which item units
// the provider has — a flat item is a private hire, a per-person item a shared
// table. This is what a RETURNING host who set up under the old single-item
// model sees: their one flat item loads as 'private', their one per-person item
// as 'shared'. They are never silently upgraded to 'both'; they see what they
// had, and opt into the second product only if they add it. A provider with no
// items yet has made no choice (null) and is asked.
export type SlotOffering = 'private' | 'shared' | 'both';
export function slotOfferingFromUnits(
    units: Array<string | null | undefined>,
): SlotOffering | null {
    const hasFlat = units.some((u) => String(u) === 'flat');
    const hasPerson = units.some((u) => String(u) === 'person');
    if (hasFlat && hasPerson) return 'both';
    if (hasPerson) return 'shared';
    if (hasFlat) return 'private';
    return null;
}

/** Does this offering include a shared table (so the per-person minimum applies)? */
export function offeringHasShared(offer: SlotOffering | null): boolean {
    return offer === 'shared' || offer === 'both';
}
/** Does this offering include a private hire? */
export function offeringHasPrivate(offer: SlotOffering | null): boolean {
    return offer === 'private' || offer === 'both';
}

// What a claim may do to a session, given the session's current state and
// whether this booking is a private hire.
//
//   'establish'  the session is empty — fresh, or reopened by a cancellation.
//                This booking sets its mode and capacity. A 0-seat row has no
//                effective mode, so its stored `private` is ignored here.
//   'join'       the session already has this same mode — take a seat / fill it.
//   'mode-clash' the session is the OTHER mode with someone already in it: a
//                private hire on a table people have joined, or a seat on a
//                privately-hired room. REFUSED. This is the guard: without it a
//                private booking silently takes ONE seat of a shared table, and
//                the guest pays a whole-room price for a single chair.
export type SlotClaim = 'establish' | 'join' | 'mode-clash';
export function slotClaimKind(
    session: { seats_taken: number; private: boolean } | null | undefined,
    isPrivate: boolean,
): SlotClaim {
    if (!session || Number(session.seats_taken) === 0) return 'establish';
    if (Boolean(session.private) !== Boolean(isPrivate)) return 'mode-clash';
    return 'join';
}

// ---------------------------------------------------------------------------
// PER-OPTION AVAILABILITY — the one truth the two displays share
// ---------------------------------------------------------------------------
//
// A slot time can carry several priced options (a per-person seat AND a private
// hire), and what is still bookable differs per option because they share the one
// session: a private hire needs the whole, empty room; a per-person seat needs
// only room for the smallest group. This is the SAME rule the booking route
// enforces atomically — establish on an empty time, join the same mode, refuse
// the other — written once here as a read-time predicate, so the guest panel and
// the host diary READ it rather than each re-deriving it and drifting. The route
// keeps the atomic claim (the CAS on seats_taken); this only says, for a session's
// CURRENT state, whether an option is still possible and how many seats it fits.
//
// The route (app/api/services/slots/book) calls this too, on each read of the
// session inside its claim loop, so the possibility check there and the two
// displays are literally one function — see slotClaimKind for the CAS guard the
// route layers on top.

export type OptionReason = 'open' | 'other-mode' | 'full' | 'too-small' | 'misconfigured';
export interface OptionAvailability { possible: boolean; seatsLeft: number; reason: OptionReason; }

/**
 * The effective seats and minimum for ONE item — the phased per-item override.
 * The item's own value wins when set; a null item value falls back to the
 * provider's slot_capacity / slot_min_people. This is the single resolver every
 * surface calls (the guest panel, the book route, the host diary) before it hands
 * the seat engine a config below, so the DISPLAY and the ENFORCEMENT can never
 * read a different number. It returns a provider-shaped object, so
 * optionAvailability / sessionCapacity take it unchanged — the seat engine itself
 * is not cut, only fed the right value.
 */
export function seatConfig(
    itemCapacity: number | null | undefined,
    itemMinPeople: number | null | undefined,
    provider: { slot_capacity?: number | null; slot_min_people?: number | null },
): { slot_capacity: number | null; slot_min_people: number | null } {
    return {
        slot_capacity: itemCapacity != null ? Number(itemCapacity) : (provider.slot_capacity ?? null),
        slot_min_people: itemMinPeople != null ? Number(itemMinPeople) : (provider.slot_min_people ?? null),
    };
}

export function optionAvailability(
    row: { capacity: number; seats_taken: number; private: boolean } | null | undefined,
    unit: string | null | undefined,
    provider: { slot_capacity?: number | null; slot_min_people?: number | null },
): OptionAvailability {
    const isPrivate = bookingIsPrivate(unit);
    const claim = slotClaimKind(row ?? null, isPrivate);
    if (claim === 'mode-clash') return { possible: false, seatsLeft: 0, reason: 'other-mode' };

    // establish ⇒ the time is empty, so capacity is what THIS option would pin
    // from the provider config; join ⇒ the capacity already pinned on the row.
    const empty = claim === 'establish';
    const capacity = empty ? sessionCapacity(provider, String(unit)) : Number(row!.capacity);
    const taken = empty ? 0 : Number(row!.seats_taken);
    const left = Math.max(0, capacity - taken);

    if (isPrivate) {
        // A private hire takes the whole room; it can only land on an empty one.
        return left >= 1
            ? { possible: true, seatsLeft: left, reason: 'open' }
            : { possible: false, seatsLeft: 0, reason: 'full' };
    }
    // A per-person seat: the smallest group the session runs for must still fit.
    // A per-person item with no capacity set is misconfigured — the route refuses
    // it up front (hasSlotCapacity), so the display must not offer it either.
    if (empty && !hasSlotCapacity(provider)) return { possible: false, seatsLeft: 0, reason: 'misconfigured' };
    const minPeople = Math.max(1, Number(provider.slot_min_people) || 1);
    if (left <= 0) return { possible: false, seatsLeft: 0, reason: 'full' };
    if (left < minPeople) return { possible: false, seatsLeft: left, reason: 'too-small' };
    return { possible: true, seatsLeft: left, reason: 'open' };
}

/**
 * Is a session closed to EVERY option the provider offers? A time is closed when
 * no unit the provider sells can still be booked on it — a private hire taken, or
 * a shared table with fewer seats left than its minimum group. Used by the host
 * diary to mark a time "closed". `units` are the provider's own item units.
 */
// `items` are the provider's own items, each carrying its unit and its per-item
// seats/minimum (null = fall back to the provider). Per-item capacity means two
// per-person items can have DIFFERENT seat counts, so the check resolves each
// item's own config — deduped by the effective (mode, seats, minimum) so
// identical options don't each cost a call.
export function sessionClosedToAll(
    row: { capacity: number; seats_taken: number; private: boolean } | null | undefined,
    items: Array<{ unit?: string | null; capacity?: number | null; min_people?: number | null }>,
    provider: { slot_capacity?: number | null; slot_min_people?: number | null },
): boolean {
    if (!items || !items.length) return false;
    const seen = new Set<string>();
    for (const it of items) {
        const cfg = seatConfig(it.capacity, it.min_people, provider);
        const key = bookingIsPrivate(it.unit) ? 'flat' : ('person:' + cfg.slot_capacity + ':' + cfg.slot_min_people);
        if (seen.has(key)) continue;
        seen.add(key);
        if (optionAvailability(row, it.unit, cfg).possible) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// INTERVAL OVERLAP — the per-treatment shape's collision rule
// ---------------------------------------------------------------------------
//
// When session length belonged to the provider, every session was the same
// length and the day tiled into non-overlapping cells, so a start-time alone
// stood in for "this provider is busy". With per-treatment durations that stops
// being true: a 90-minute booking at 10:00 and a 30-minute booking at 11:00 have
// different start-times but the same masseuse is double-booked 11:00–11:30.
//
// A booked session therefore BLOCKS an interval on the provider's day —
// [start, start + duration + turnaround) minutes from midnight — and two
// bookings for one provider on one date collide when those half-open intervals
// overlap. The DATABASE is the authority on this (the slot_sessions_no_overlap
// exclusion constraint); these pure functions are what the claim's courtesy
// check and the guest panel's greying use, so all three agree on the same rule.
// The turnaround is folded into the BLOCK, never the displayed duration: the
// guest sees "60 min" while the day reserves 70.

export interface DayInterval { startMin: number; endMin: number; }

/** "HH:MM[:SS]" → minutes past midnight. Tolerant of either width. */
export function minutesOfDay(clock: string): number {
    return toMinutes(String(clock));
}

/** The length a booking of this item runs: the item's own, else the provider's. */
export function resolvedDuration(
    item: { duration_minutes?: number | null } | null | undefined,
    provider: { slot_length_minutes?: number | null } | null | undefined,
): number {
    const perItem = Number(item && item.duration_minutes);
    if (Number.isInteger(perItem) && perItem > 0) return perItem;
    return Math.max(1, Number(provider && provider.slot_length_minutes) || 60);
}

/** True when the item carries its own duration — the per-treatment shape's tell. */
export function itemHasOwnDuration(item: { duration_minutes?: number | null } | null | undefined): boolean {
    const n = Number(item && item.duration_minutes);
    return Number.isInteger(n) && n > 0;
}

/** The [start, start + duration + turnaround) block a booking reserves, in minutes. */
export function blockInterval(time: string, durationMinutes: number, turnaroundMinutes: number): DayInterval {
    const startMin = minutesOfDay(time);
    const len = Math.max(0, Number(durationMinutes) || 0) + Math.max(0, Number(turnaroundMinutes) || 0);
    return { startMin, endMin: startMin + len };
}

/** Half-open overlap: [aStart,aEnd) and [bStart,bEnd) share a minute. */
export function intervalsOverlap(a: DayInterval, b: DayInterval): boolean {
    return a.startMin < b.endMin && b.startMin < a.endMin;
}

export interface BookedBlock {
    session_time: string;
    duration_minutes?: number | null;
    turnaround_minutes?: number | null;
}

/**
 * Does a booking of `durationMinutes` (+ turnaround) at `time` overlap any of the
 * provider's already-booked sessions? A booked session at the SAME start-time is
 * not an overlap — it is the one session this booking would join or establish, so
 * the caller passes only OTHER sessions (or this returns on same-start as its own
 * interval, which the caller filters). Used by the claim before it touches Stripe
 * and by the guest panel to grey overlapping starts.
 */
export function overlapsBooked(
    time: string,
    durationMinutes: number,
    turnaroundMinutes: number,
    booked: BookedBlock[],
): boolean {
    const want = blockInterval(time, durationMinutes, turnaroundMinutes);
    for (const b of booked || []) {
        const bi = blockInterval(b.session_time, Number(b.duration_minutes) || 0, Number(b.turnaround_minutes) || 0);
        if (intervalsOverlap(want, bi)) return true;
    }
    return false;
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
