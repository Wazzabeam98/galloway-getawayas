// Pure rules for the stay Resolution Centre ("send or request money"). Kept free
// of Supabase/Stripe so the money maths and the state machine can be unit-tested
// on their own; the routes and the webhook wire these into the world.

// Relative import, not '@/lib/dayKey': this module is executed directly by the
// unit test, and Node cannot resolve the @/ alias at runtime.
import { londonDayKey } from './dayKey';

export type ResolutionDirection = 'request' | 'send';
export type ResolutionReason = 'extra_services' | 'damage';
export type ResolutionStatus =
    | 'pending' | 'countered' | 'paid' | 'declined' | 'escalated'
    | 'cancelled' | 'expired' | 'awaiting_host_payment'
    // The guest has accepted a request and a Checkout session is open, waiting
    // for them to pay. Parking the row here (rather than leaving it 'pending')
    // is what lets a second click reuse the one session instead of opening a
    // second, so a single request can only ever produce one payment.
    | 'awaiting_guest_payment' | 'completed';

// A guest has this long to respond to a request before it escalates to an admin.
// Airbnb uses 24h; the house rule here is 72h.
export const ESCALATION_HOURS = 72;

export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export function toPence(pounds: number): number {
    return Math.round(pounds * 100);
}

// Commission: an EXTRA-SERVICES request takes the platform's 10%; DAMAGE takes
// nothing (it is reimbursement, not a sale), and a SEND is a refund, so no cut.
export function commissionRateFor(direction: ResolutionDirection, reason: ResolutionReason): number {
    if (direction === 'request' && reason === 'extra_services') return 0.10;
    return 0;
}

// The platform fee, in pence, taken from a guest's payment on a request. Damage
// and sends resolve to 0.
export function applicationFeePence(amountPence: number, commissionRate: number): number {
    return Math.round(amountPence * commissionRate);
}

// Damage can only be claimed once the stay is over — before then there is no
// damage to reimburse. `checkOut` is the booking's check-out date (yyyy-mm-dd).
export function isDamageAllowed(checkOut: string | null, now: Date = new Date()): boolean {
    if (!checkOut) return false;
    // Compare on calendar date: the stay is "over" from the check-out day on.
    // "Today" is the UK calendar day (Europe/London), not the UTC one — under
    // British Summer Time a UTC date rolls over an hour after midnight London,
    // so a plain toISOString() would open damage a day early (or, at the far end
    // of the day, judge a check-out still to come). See lib/dayKey.
    const co = String(checkOut).slice(0, 10);
    const today = londonDayKey(now);
    return today >= co;
}

// What a SEND may refund at most: everything the guest has actually paid, net of
// anything already refunded. Refusing more is the guard against sending back
// money that was never received.
export function sendCapPounds(amountPaid: number, amountRefunded: number): number {
    return round2(Math.max(0, Number(amountPaid || 0) - Number(amountRefunded || 0)));
}

export function validateSendAmount(amount: number, cap: number): { ok: boolean; error?: string } {
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount to send.' };
    if (round2(amount) > round2(cap)) {
        return { ok: false, error: 'That is more than the £' + round2(cap).toFixed(2) + ' the guest has paid, net of refunds.' };
    }
    return { ok: true };
}

export function escalationDeadline(fromIso: string): string {
    return new Date(new Date(fromIso).getTime() + ESCALATION_HOURS * 3600 * 1000).toISOString();
}

// Whether a pending/countered request has passed its 72h deadline.
export function isPastDeadline(expiresAt: string | null, now: Date = new Date()): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() <= now.getTime();
}

// State-machine gates — who may do what, from which status.
// Decline and counter are only offered while the request is still 'pending' —
// once the guest has committed to pay they can no longer send it back.
export function guestMayRespond(status: ResolutionStatus): boolean {
    return status === 'pending';
}
// Accepting/continuing to pay is allowed from 'pending' (first accept) and from
// 'awaiting_guest_payment' (returning to an already-open Checkout session). The
// route reuses the stored session in the second case rather than opening a new
// one, so this can never turn into two payments.
export function guestMayPay(status: ResolutionStatus): boolean {
    return status === 'pending' || status === 'awaiting_guest_payment';
}
export function hostMayDecideCounter(status: ResolutionStatus): boolean {
    return status === 'countered';
}
export function hostMayCancel(status: ResolutionStatus): boolean {
    return status === 'pending' || status === 'countered';
}
export function isOpenRequest(status: ResolutionStatus): boolean {
    return status === 'pending' || status === 'countered';
}
export function isTerminal(status: ResolutionStatus): boolean {
    return status === 'paid' || status === 'completed' || status === 'declined'
        || status === 'cancelled' || status === 'expired' || status === 'escalated';
}
