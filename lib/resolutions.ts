// Pure rules for the stay Resolution Centre ("send or request money"). Kept free
// of Supabase/Stripe so the money maths and the state machine can be unit-tested
// on their own; the routes and the webhook wire these into the world.

export type ResolutionDirection = 'request' | 'send';
export type ResolutionReason = 'extra_services' | 'damage';
export type ResolutionStatus =
    | 'pending' | 'countered' | 'paid' | 'declined' | 'escalated'
    | 'cancelled' | 'expired' | 'awaiting_host_payment' | 'completed';

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
    const co = String(checkOut).slice(0, 10);
    const today = now.toISOString().slice(0, 10);
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
export function guestMayRespond(status: ResolutionStatus): boolean {
    return status === 'pending';
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
