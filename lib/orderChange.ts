// Changing a booked experience — the rules shared by "change guest count" and
// "change date or time", for the two REQUEST shapes (made_to_order,
// comes_to_you). Slot has its own engine (top-up / move) and is left untouched;
// this file never runs for a slot.
//
// THE CANCELLATION POLICY, APPLIED TO A CHANGE. The same free-cancellation
// window that decides a refund decides a change:
//   - inside the window: any change is allowed. A lower count refunds the
//     difference, a higher one tops up, and the date can move.
//   - past the window: a higher count still tops up, but a reduction refunds
//     nothing (so it is not offered — a floor is kept, see below) and the date
//     is fixed.
// The sheet is told which applies and says so before the guest confirms.
//
// WHY A REDUCTION IS NOT OFFERED PAST THE WINDOW rather than "allowed for no
// refund": price on the row is the amount paid, and payouts are struck from it.
// Reducing the count past the window with no refund would either leave
// price/quantity inconsistent (breaking the top-up delta maths) or drop the
// price below what was actually paid (under-paying the provider). So the count
// floor is the current count once the window has passed — the honest reading of
// "reductions refund nothing".

import { shapeOf, freeCancelDeadline, guestMayCancelFree } from './serviceSlots';
import { pricedPerHead, servesExistingBookings } from './serviceOrders';

// Per-group pricing = the price does not follow the head count: a flat or event
// price, and also per hour / per item (9 Oct 2026), which multiply by hours or
// items, never by people. So a count change only has to respect capacity. Only
// a per-head unit (per person) moves money when the party changes.
export function perGroupPricing(unit: string | null | undefined): boolean {
    return !pricedPerHead(unit);
}

// The free-cancellation state for a change: `free` while inside the window (any
// change allowed), and the deadline for the sheet to name.
export function changeWindowState(
    order: { shape?: string | null; service_date: string; service_time?: string | null },
    windowHours: number,
    now: Date
): { free: boolean; deadlineISO: string | null } {
    const shape = shapeOf(order);
    const deadline = freeCancelDeadline(shape, String(order.service_date), order.service_time || null, windowHours);
    const free = guestMayCancelFree(shape, String(order.service_date), order.service_time || null, windowHours, now);
    return { free, deadlineISO: isNaN(deadline.getTime()) ? null : deadline.toISOString() };
}

// yyyy-mm-dd for a Date in UTC (service dates are stored and compared as plain
// day keys, never times, for the request shapes).
export function dayKey(d: Date): string {
    return d.getUTCFullYear()
        + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
        + '-' + String(d.getUTCDate()).padStart(2, '0');
}
export function dayKeyFromNow(offsetDays: number, now: Date): string {
    return dayKey(new Date(now.getTime() + offsetDays * 86400000));
}

// A provider that a guest may still change a booking against. NOT the live gate
// the booking flow uses: a paused or taken-down provider still serves the
// bookings it already has (servesExistingBookings), so the guest can still
// change theirs — only brand-new orders are refused. No Stripe account needed:
// a change's charge is held like the booking's (lib/experienceFunds).
export function providerTakesChanges(provider: any): boolean {
    return !!provider && servesExistingBookings(provider);
}
