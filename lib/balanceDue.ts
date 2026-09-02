// When a deposit booking's balance is charged: a fixed number of calendar days
// before check-in, as a 'yyyy-mm-dd' key.
//
// This is the same lesson lib/dayKey and freeCancelUntilKey already learned. The
// checkout route used to compute it as:
//
//     const balanceDue = new Date(booking.check_in);   // UTC midnight
//     balanceDue.setDate(balanceDue.getDate() - 30);    // LOCAL-time arithmetic
//     balance_due_date: balanceDue.toISOString().split('T')[0]
//
// `new Date('2026-11-20')` is UTC midnight; `.getDate()`/`.setDate()` then work
// in local wall-clock time. When the check-in parses in GMT but its date-minus-30
// lands in BST — roughly 26 October to 24 November check-ins — the result keeps
// the local 00:00 wall clock in a +1h zone, so toISOString rolls back to the
// previous day and the balance is stored (and charged) a day early. Working on
// the calendar parts removes the instant entirely, so the answer is the same
// calendar day in every zone.
import { shiftDayKey } from './dayKey';

export const BALANCE_DAYS_BEFORE_CHECKIN = 30;

// The calendar day the outstanding balance falls due: BALANCE_DAYS_BEFORE_CHECKIN
// days before check-in, worked out on the parts and never through an instant.
export function balanceDueKey(checkIn: string | Date): string {
    const key = typeof checkIn === 'string'
        ? String(checkIn).slice(0, 10)
        // A Date — its own calendar day, read on the parts (matches freeCancelUntilKey).
        : `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}-${String(checkIn.getDate()).padStart(2, '0')}`;
    return shiftDayKey(key, -BALANCE_DAYS_BEFORE_CHECKIN);
}
