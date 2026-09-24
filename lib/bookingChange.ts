// Pure rules for "Change reservation" — the host proposes new dates / guest
// count / price on a stay, and the guest must accept before anything moves.
// Kept free of Supabase/Stripe so the money maths and the state machine can be
// unit-tested on their own; the routes and the webhook wire these into the world.
//
// The booking's `guests` column is the TOTAL headcount (adults + children); its
// `children` column is the subset (see components/BookingWidget). Pets do not
// count toward the listing's max. This module speaks that same shape.

export type ChangeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface StaySnapshot {
    checkIn: string;   // yyyy-mm-dd
    checkOut: string;  // yyyy-mm-dd
    guests: number;    // total headcount (adults + children)
    children: number;
    pets: number;
    total: number;     // accommodation total, in pounds
}

export function round2(value: number): number {
    return Math.round(Number(value || 0) * 100) / 100;
}

// new_total - old_total. Positive charges the guest the difference on accept,
// negative refunds it, zero is a dates/guests-only change.
export function changeDelta(oldTotal: number, newTotal: number): number {
    return round2(Number(newTotal || 0) - Number(oldTotal || 0));
}

// Which way the money goes, for copy and for the branch the routes take.
export function moneyDirection(delta: number): 'charge' | 'refund' | 'none' {
    const d = round2(delta);
    if (d > 0) return 'charge';
    if (d < 0) return 'refund';
    return 'none';
}

// A refund on a change can never exceed what the guest has actually paid, net of
// anything already refunded — the same guard the Resolution Centre's send uses.
export function refundForChange(delta: number, netPaid: number): number {
    if (round2(delta) >= 0) return 0;
    return round2(Math.min(Math.abs(round2(delta)), Math.max(0, Number(netPaid || 0))));
}

// Whole nights between two day keys (half-open, like the booking's daterange).
export function nights(checkIn: string, checkOut: string): number {
    const [ay, am, ad] = checkIn.split('-').map(Number);
    const [by, bm, bd] = checkOut.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Did anything actually change? "Send request" is disabled until it did.
export function isRealChange(oldStay: StaySnapshot, next: StaySnapshot): boolean {
    return oldStay.checkIn !== next.checkIn
        || oldStay.checkOut !== next.checkOut
        || Number(oldStay.guests) !== Number(next.guests)
        || Number(oldStay.children) !== Number(next.children)
        || Number(oldStay.pets) !== Number(next.pets)
        || round2(oldStay.total) !== round2(next.total);
}

export interface ChangeLimits {
    maxGuests: number;
    petsAllowed: boolean;
}

// Validate a proposed change against the listing's limits and basic sanity.
// Returns the first problem, or ok. `today` is a yyyy-mm-dd day key (UK day, so
// the caller passes londonDayKey()).
export function validateChange(
    oldStay: StaySnapshot,
    next: StaySnapshot,
    limits: ChangeLimits,
    today: string,
): { ok: boolean; error?: string } {
    if (!next.checkIn || !next.checkOut) return { ok: false, error: 'Pick both dates.' };
    if (next.checkOut <= next.checkIn) return { ok: false, error: 'The checkout date must be after the check-in date.' };
    if (next.checkIn < today) return { ok: false, error: 'Check-in can’t be in the past.' };
    if (!(next.guests >= 1)) return { ok: false, error: 'A stay needs at least one guest.' };
    if (next.children < 0 || next.pets < 0) return { ok: false, error: 'Counts can’t be negative.' };
    if (next.children > next.guests) return { ok: false, error: 'There can’t be more children than guests.' };
    if (next.guests > limits.maxGuests) return { ok: false, error: 'This place sleeps up to ' + limits.maxGuests + ' guests.' };
    if (next.pets > 0 && !limits.petsAllowed) return { ok: false, error: 'This place doesn’t allow pets.' };
    if (!(next.total >= 0)) return { ok: false, error: 'Enter a price of £0 or more.' };
    if (!isRealChange(oldStay, next)) return { ok: false, error: 'Nothing has changed yet.' };
    return { ok: true };
}

// State-machine gate: the guest may accept/decline only while it is pending.
export function guestMayAnswerChange(status: ChangeStatus): boolean {
    return status === 'pending';
}
// The host may withdraw only while it is pending.
export function hostMayCancelChange(status: ChangeStatus): boolean {
    return status === 'pending';
}
export function isChangeTerminal(status: ChangeStatus): boolean {
    return status === 'accepted' || status === 'declined' || status === 'cancelled' || status === 'expired';
}
