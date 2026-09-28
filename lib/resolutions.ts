// Pure rules for the stay Resolution Centre ("send or request money"). Kept free
// of Supabase/Stripe so the money maths and the state machine can be unit-tested
// on their own; the routes and the webhook wire these into the world.

// Relative import, not '@/lib/dayKey': this module is executed directly by the
// unit test, and Node cannot resolve the @/ alias at runtime.
import { londonDayKey } from './dayKey';
import { formatGBP } from './formatMoney';

export type ResolutionDirection = 'request' | 'send';
// A REQUEST is for extra services, damage, or other; a SEND is a goodwill refund,
// a change to the booking, or other. The column stores all six in one text field
// (the check constraint in the booking_resolutions migration), and the money
// rules below key only off 'extra_services' — every other reason carries no fee.
export type ResolutionReason =
    | 'extra_services' | 'damage' | 'other'
    | 'goodwill_refund' | 'booking_change';

// Which reasons belong to which direction, for the stepped flow and the route's
// validation — a send can never be 'extra_services'/'damage', a request can never
// be 'goodwill_refund'/'booking_change'.
export const REQUEST_REASONS: ResolutionReason[] = ['extra_services', 'damage', 'other'];
export const SEND_REASONS: ResolutionReason[] = ['goodwill_refund', 'booking_change', 'other'];

export function reasonAllowedFor(direction: ResolutionDirection, reason: ResolutionReason): boolean {
    return (direction === 'request' ? REQUEST_REASONS : SEND_REASONS).indexOf(reason) !== -1;
}

// A "change to the booking" SEND must not run alongside the automated change-order
// flow (#173). That flow already settles the money for a change — charging the
// guest the extra or refunding the difference when the change is accepted — so a
// manual send for the SAME change, while its request is still open, would move
// money twice. Block the send only while a change request is open
// (pending / awaiting_guest_payment); once none is open there is nothing in flight
// to double, and a discretionary send is the host's own call.
export function sendCollidesWithOpenChange(
    direction: ResolutionDirection,
    reason: ResolutionReason,
    hasOpenChangeRequest: boolean,
): boolean {
    return direction === 'send' && reason === 'booking_change' && hasOpenChangeRequest;
}

// One label per reason, so the guest email, the guest's review screen, the Stripe
// line item, the admin note and the flow itself all word a reason the same way.
export function reasonLabel(reason: ResolutionReason): string {
    switch (reason) {
        case 'damage': return 'Damage or extra cleaning';
        case 'extra_services': return 'Extra services';
        case 'goodwill_refund': return 'Goodwill refund';
        case 'booking_change': return 'Change to the booking';
        case 'other': return 'Other';
        default: return 'Other';
    }
}
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

// Commission on a REQUEST: the platform takes its 10% on every reason EXCEPT
// damage, which is reimbursement for a loss rather than a sale. 'other' is charged
// too, on purpose — otherwise a host could dodge the fee on an extra-services
// charge by wording it "other". A SEND is a refund to the guest, so it never
// carries a cut, whatever its reason.
export function commissionRateFor(direction: ResolutionDirection, reason: ResolutionReason): number {
    if (direction === 'request') return reason === 'damage' ? 0 : 0.10;
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
        return { ok: false, error: 'That is more than the ' + formatGBP(cap) + ' the guest has paid, net of refunds.' };
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
