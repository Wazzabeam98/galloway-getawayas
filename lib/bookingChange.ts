// Pure rules for "Change reservation" — the host proposes new dates / guest
// count / price on a stay, and the guest must accept before anything moves.
// Kept free of Supabase/Stripe so the money maths and the state machine can be
// unit-tested on their own; the routes and the webhook wire these into the world.
//
// The booking's `guests` column is the TOTAL headcount (adults + children); its
// `children` column is the subset (see components/BookingWidget). Pets do not
// count toward the listing's max. This module speaks that same shape.

// Relative import, not '@/lib/cancellation': this module is executed directly by
// the unit test, and Node cannot resolve the @/ alias at runtime.
import { refundFraction } from './cancellation';

export type ChangeStatus = 'pending' | 'awaiting_guest_payment' | 'accepted' | 'declined' | 'cancelled' | 'expired';

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

// A GUEST change whose re-priced delta is exactly zero — no extra-guest fee, no
// pet fee, or still within the numbers already paid for — applies straight away
// with no host approval (the host is only told). Any price change, up or down,
// and every HOST-proposed change, stays a request. Decided on the server's
// re-priced delta, never the browser's number.
export function guestChangeIsInstant(initiatedBy: 'host' | 'guest', delta: number): boolean {
    return initiatedBy === 'guest' && round2(delta) === 0;
}

// What a decrease actually refunds: only what the guest has OVERPAID against the
// NEW total, and never more than they have paid net of refunds. A guest who paid
// only a deposit that is still below the new total is owed nothing back — the
// decrease just shrinks the balance they have left to pay. This is
// max(0, netPaid - newTotal), which is also automatically ≤ netPaid.
export function refundForDecrease(netPaid: number, newTotal: number): number {
    return round2(Math.max(0, Number(netPaid || 0) - Number(newTotal || 0)));
}

// What share of a shortening's removed nights is refunded, as a partial
// cancellation of those nights. A HOST-proposed shortening refunds them in full
// (the host is the one shortening the stay, so the guest keeps all their money).
// A GUEST-proposed one follows the booking's cancellation policy: full inside the
// free-cancellation window, the tier's share outside it (none once the window has
// closed on Firm/Moderate, 50% within Limited's or Firm's partial window — see
// lib/cancellation.refundFraction), anchored on the original check-in.
export function decreaseRefundFraction(
    initiatedBy: 'host' | 'guest',
    checkIn: string,
    policy: string | null | undefined,
    now?: Date,
): number {
    if (initiatedBy === 'host') return 1;
    return refundFraction(checkIn, policy, now);
}

// The balance still owed after a change (and after any refund it triggered):
// the new total less what the guest has paid net of refunds, floored at zero.
export function balanceAfter(newTotal: number, netPaidAfterRefund: number): number {
    return round2(Math.max(0, Number(newTotal || 0) - Number(netPaidAfterRefund || 0)));
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
    // Check-in may stay in the past — a mid-stay extension keeps the original
    // arrival — but it can't be MOVED to a new past date. Check-out must still be
    // ahead: you can't change a stay that is already over (that's a job for Send
    // or request money).
    if (next.checkIn < today && next.checkIn !== oldStay.checkIn) return { ok: false, error: 'Check-in can’t be moved into the past.' };
    if (next.checkOut < today) return { ok: false, error: 'That stay is already over — use Send or request money instead.' };
    if (!(next.guests >= 1)) return { ok: false, error: 'A stay needs at least one guest.' };
    if (next.children < 0 || next.pets < 0) return { ok: false, error: 'Counts can’t be negative.' };
    if (next.children > next.guests) return { ok: false, error: 'There can’t be more children than guests.' };
    if (next.guests > limits.maxGuests) return { ok: false, error: 'This place sleeps up to ' + limits.maxGuests + ' guests.' };
    if (next.pets > 0 && !limits.petsAllowed) return { ok: false, error: 'This place doesn’t allow pets.' };
    if (!(next.total >= 0)) return { ok: false, error: 'Enter a price of £0 or more.' };
    if (!isRealChange(oldStay, next)) return { ok: false, error: 'Nothing has changed yet.' };
    return { ok: true };
}

// Who must answer a pending proposal: the party who did NOT make it. A host
// proposal waits on the guest; a guest proposal waits on the host.
export function whoAnswers(initiatedBy: 'host' | 'guest'): 'host' | 'guest' {
    return initiatedBy === 'host' ? 'guest' : 'host';
}

// A change is "open" (still in play, blocks a second one) while it is waiting on
// the counterparty or on the guest's payment.
export function isOpenChange(status: ChangeStatus): boolean {
    return status === 'pending' || status === 'awaiting_guest_payment';
}

// State-machine gate: the counterparty may answer only while it is pending.
export function guestMayAnswerChange(status: ChangeStatus): boolean {
    return status === 'pending';
}
// Either side may withdraw a proposal they own only while it is still open.
export function hostMayCancelChange(status: ChangeStatus): boolean {
    return status === 'pending' || status === 'awaiting_guest_payment';
}
// The guest pays from the awaiting-payment step (a guest proposal the host
// approved), and a repeat pay reuses the one session — same as host proposals.
export function guestMayPayChange(status: ChangeStatus): boolean {
    return status === 'awaiting_guest_payment';
}
export function isChangeTerminal(status: ChangeStatus): boolean {
    return status === 'accepted' || status === 'declined' || status === 'cancelled' || status === 'expired';
}
