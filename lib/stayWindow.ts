// When a stay starts and when it is over.
//
// This exists because the same question was being answered three different
// ways and they disagreed. A booking is a pair of date-only strings, and the
// moment you compare one of those against `new Date()` you are comparing
// midnight against the current time — so a stay checking in today reads as
// already in the past from 00:01 onwards. That is what put a booking made for
// tonight under Past bookings, where its Confirm button was the only one on
// the page.
//
// Everything here works in the host's local day. Nothing compares a date-only
// value against a timestamp.

import { dateFromKey, dateKey } from '@/lib/pricing';

// 11am, the same figure the listing page falls back to when a host has not
// set a check-out time.
const DEFAULT_CHECK_OUT_HOUR = 11;

// 'HH:MM:SS' -> [hours, minutes]. Anything unparseable falls back to 11am
// rather than to midnight, because midnight would put the stay's end a whole
// day earlier and quietly reintroduce the bug this file exists to fix.
function hoursAndMinutes(value: string | null | undefined): number[] {
    if (!value) return [DEFAULT_CHECK_OUT_HOUR, 0];

    const parts = String(value).split(':');
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1] || '0', 10);

    if (isNaN(hour) || hour < 0 || hour > 23) return [DEFAULT_CHECK_OUT_HOUR, 0];
    if (isNaN(minute) || minute < 0 || minute > 59) return [hour, 0];

    return [hour, minute];
}

// The moment the guest is due out: the check-out date at the listing's
// check-out time, in local time.
export function stayEnd(checkOut: string, checkOutTime?: string | null): Date {
    const end = dateFromKey(checkOut);
    const hm = hoursAndMinutes(checkOutTime);
    end.setHours(hm[0], hm[1], 0, 0);
    return end;
}

// Has the guest's stay finished? False all the way through check-out morning,
// true once they are due out.
export function stayHasEnded(
    checkOut: string,
    checkOutTime?: string | null,
    now?: Date
): boolean {
    return (now || new Date()).getTime() >= stayEnd(checkOut, checkOutTime).getTime();
}

// Has the guest arrived yet? A stay checking in today counts as not yet
// started for the whole of today — the host still has the day to call it off,
// and arrival time is the guest's business, not something we know.
export function stayHasStarted(checkIn: string, now?: Date): boolean {
    return dateKey(now || new Date()) > String(checkIn).split('T')[0];
}

// Is a phone number worth putting on the screen yet?
//
// A guest's number, and a host's, are private until they are useful. Close to
// arrival they are very useful — a late ferry, a key left somewhere, a gate
// nobody can find — and at every other time there is no reason to put one on
// a page that opens the moment somebody signs in.
//
// The rule was written out three times over, and the copies disagreed: one of
// them showed the number on a booking that had been cancelled, which is the
// one case where nobody is arriving at all. This is the rule.
export function contactNumberVisible(
    booking: { check_in: string; check_out: string; status?: string | null },
    checkOutTime?: string | null,
    now?: Date
): boolean {
    // Nobody is coming. Whatever the dates say, there is no arrival to help
    // with and no reason to show the number.
    if (booking.status === 'cancelled' || booking.status === 'declined') return false;

    // They have gone home.
    if (stayHasEnded(booking.check_out, checkOutTime, now)) return false;

    const today = now ? new Date(now.getTime()) : new Date();
    today.setHours(0, 0, 0, 0);

    const daysToArrival = Math.round(
        (dateFromKey(booking.check_in).getTime() - today.getTime()) / 86400000
    );

    // From the day before arrival, and right through the stay.
    return daysToArrival <= 1;
}
