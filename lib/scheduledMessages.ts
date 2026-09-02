// When a host's saved message is actually due.
//
// Hosts have been able to write these since the templates were built —
// check-in details with the key safe code, a note before check-out — and
// nothing has ever sent them. Only the booking-confirmation template with no
// delay goes out, and that is posted inline when a host accepts. Everything
// anchored to the dates of the stay was saved, shown as saved, and silently
// dropped. That is a lockbox code not reaching somebody standing outside a
// house in the dark.
//
// The timing rules live here rather than in the route so they can be tested
// without a database, because "three days before arrival at 9am" has more
// edge cases in it than it looks: British Summer Time, a run that was missed,
// and a message whose moment has simply passed.

import { shiftDayKey } from './dayKey';

export interface Template {
    user_id: string;
    template_type: string;
    body: string;
    enabled: boolean;
    anchor: string | null;
    days_offset: number | null;
    send_hour: number | null;
    minutes_after: number | null;
    hours_after: number | null;
    hours_before: number | null;
    // Vestigial. Scope moved to `message_template_listings` so the database
    // can refuse two templates of a type naming the same listing; the column
    // is dropped once the old code is out of production. Nothing reads it.
    listing_ids?: string[] | null;
}

export interface BookingLike {
    id: string;
    host_id: string;
    guest_id: string;
    listing_id: string;
    check_in: string;
    check_out: string;
    status: string;
    confirmed_at: string | null;
}

// Everything a guest reads is in UK local time, and half the year that is not
// UTC. A host who sets "9am" means nine o'clock as they and their guest
// experience it, so the wall clock has to be London's, not the server's.
function londonOffsetMs(at: Date): number {
    // What London's clock reads at this instant, compared with UTC. Derived
    // from the runtime's own timezone data rather than a hardcoded BST rule,
    // so it stays right when the dates of the change move.
    const asLondon = new Date(at.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const asUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
    return asLondon.getTime() - asUtc.getTime();
}

// A local UK date and hour, as an instant.
export function londonInstant(dateKey: string, hour: number, minute?: number): Date {
    const parts = String(dateKey).split('T')[0].split('-');
    // Start from the naive UTC reading of that wall clock, then correct by
    // whatever London is offset at around that moment.
    const naive = Date.UTC(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10),
        hour,
        minute || 0,
        0,
        0
    );
    return new Date(naive - londonOffsetMs(new Date(naive)));
}

function addDays(dateKey: string, days: number): string {
    return shiftDayKey(String(dateKey).split('T')[0], days);
}

// 'HH:MM:SS' -> hours, defaulting the way the rest of the site does.
function hourOf(value: string | null | undefined, fallback: number): number {
    if (!value) return fallback;
    const h = parseInt(String(value).split(':')[0], 10);
    return isNaN(h) || h < 0 || h > 23 ? fallback : h;
}

export interface Timing {
    // When it should go out.
    dueAt: Date;
    // After this, the moment has passed and sending would be worse than not:
    // check-in details are no use once somebody has arrived.
    staleAfter: Date;
}

// Null when this template has no sensible time for this booking — an anchor
// nobody recognises, or a booking-anchored template on a booking that was
// never accepted.
export function timingFor(
    template: Template,
    booking: BookingLike,
    listing: { check_in_time?: string | null; check_out_time?: string | null }
): Timing | null {
    const anchor = template.anchor || 'none';
    const sendHour = typeof template.send_hour === 'number' ? template.send_hour : 9;

    if (anchor === 'booking') {
        if (!booking.confirmed_at) return null;
        const from = new Date(booking.confirmed_at).getTime();
        const dueAt = new Date(from + (template.minutes_after || 0) * 60000);
        // A welcome note is worth sending late, but not once they have been
        // and gone.
        return { dueAt: dueAt, staleAfter: londonInstant(booking.check_out, 23, 59) };
    }

    if (anchor === 'check_in') {
        const days = template.days_offset || 0;
        return {
            dueAt: londonInstant(addDays(booking.check_in, -days), sendHour),
            // Pointless once they are due to arrive.
            staleAfter: londonInstant(booking.check_in, hourOf(listing.check_in_time, 15)),
        };
    }

    if (anchor === 'check_out') {
        const days = template.days_offset || 0;
        return {
            dueAt: londonInstant(addDays(booking.check_out, -days), sendHour),
            staleAfter: londonInstant(booking.check_out, hourOf(listing.check_out_time, 11)),
        };
    }

    if (anchor === 'after_check_in') {
        const checkInAt = londonInstant(booking.check_in, hourOf(listing.check_in_time, 15));
        return {
            dueAt: new Date(checkInAt.getTime() + (template.hours_after || 0) * 3600000),
            // "Did you get in alright" is fine the next morning, absurd after
            // they have left.
            staleAfter: londonInstant(booking.check_out, hourOf(listing.check_out_time, 11)),
        };
    }

    if (anchor === 'before_check_out') {
        const checkOutAt = londonInstant(booking.check_out, hourOf(listing.check_out_time, 11));
        return {
            dueAt: new Date(checkOutAt.getTime() - (template.hours_before || 0) * 3600000),
            staleAfter: checkOutAt,
        };
    }

    return null;
}

// Should this go out on this run?
//
// Due already and not yet stale — deliberately not "due in the last hour".
// A run that fails, or a deploy that lands over the top of one, must not mean
// a guest never gets their key safe code; the message goes out late instead.
export function isDue(timing: Timing | null, now: Date): boolean {
    if (!timing) return false;
    return now.getTime() >= timing.dueAt.getTime()
        && now.getTime() < timing.staleAfter.getTime();
}

// The stock greeting the editor puts at the top of every template. A body
// that is only this has not been written yet, and "Hi Alex," on its own is
// worse than silence.
const GREETING_ONLY = /^\s*hi\s*\{guest_name\}\s*,?\s*$/i;

export function hasRealContent(body: string | null | undefined): boolean {
    const text = String(body || '').trim();
    if (!text) return false;
    return !GREETING_ONLY.test(text);
}

// The door code is the one placeholder that can fail to resolve, because it
// lives per listing and a host may not have set it. See needsLockboxCode.
export const LOCKBOX_TOKEN = '{lockbox_code}';

export function usesLockboxCode(body: string | null | undefined): boolean {
    return String(body || '').indexOf(LOCKBOX_TOKEN) !== -1;
}

// Whether this message must be held back rather than sent.
//
// A guest reading "the code is {lockbox_code}" has been sent nonsense, and an
// empty string is worse — it reads as though there is no code and they will
// stand at the door trying the handle. Neither is better than the message
// arriving late, once somebody has noticed and filled the code in.
export function needsLockboxCode(body: string | null | undefined, code: string | null | undefined): boolean {
    return usesLockboxCode(body) && !String(code || '').trim();
}

export function fillPlaceholders(
    body: string,
    values: {
        guestName: string;
        listing: string;
        checkIn: string;
        checkOut: string;
        lockboxCode?: string | null;
    }
): string {
    return String(body)
        .split('{guest_name}').join(values.guestName)
        .split('{listing}').join(values.listing)
        .split('{check_in}').join(values.checkIn)
        .split('{check_out}').join(values.checkOut)
        .split(LOCKBOX_TOKEN).join(String(values.lockboxCode || ''));
}

// The floor a guest gets when their host never wrote a check-in template: the
// address, the arrival time, and how to get in. Plain, factual, and sent in
// the host's thread — nothing here is anything a host would not have said.
//
// The door code is included ONLY for a self-check-in method the host set up
// with a code. A host who chose "lockbox" and typed a code intends the guest
// to let themselves in with it; withholding it is the lockout this is meant to
// prevent. For a greeted check-in, or a self-check-in with no code set yet, it
// says who will be in touch instead, so the guest chases it in advance rather
// than at the door.
export function checkInFallbackBody(args: {
    firstName: string;
    listing: {
        title?: string | null;
        location?: string | null;
        check_in_time?: string | null;
        check_out_time?: string | null;
        check_in_method?: string | null;
    };
    checkIn: string;
    code?: string | null;
}): string {
    const { firstName, listing, checkIn, code } = args;
    const title = listing.title || 'your stay';
    // A local time formatter, deliberately not imported: this module is loaded
    // by tests that resolve no path aliases, so it stays free of cross-lib
    // imports. Mirrors lib/utils formatTime for the HH:MM(:SS) values a listing
    // stores — 15:00 -> "3pm", 11:00 -> "11am", noon and midnight by name.
    const fmtTime = (value: string | null | undefined): string => {
        if (!value) return '';
        const parts = String(value).split(':');
        const hour = Number(parts[0]);
        const minute = Number(parts[1] || 0);
        if (isNaN(hour) || isNaN(minute)) return '';
        if (hour === 0 && minute === 0) return 'midnight';
        if (hour === 12 && minute === 0) return 'noon';
        const suffix = hour < 12 ? 'am' : 'pm';
        let display = hour % 12;
        if (display === 0) display = 12;
        return minute === 0 ? display + suffix : display + '.' + String(minute).padStart(2, '0') + suffix;
    };
    const arrival = fmtTime(listing.check_in_time) || '3pm';
    const method = listing.check_in_method || '';
    const selfServe = ['Lockbox', 'Smart lock', 'Keypad'].indexOf(method) !== -1;

    let entry: string;
    if (selfServe && code) {
        const where = method === 'Lockbox'
            ? 'There is a key safe by the door'
            : 'The door has a keypad';
        entry = where + ' — the code is ' + code + '.';
    } else if (selfServe) {
        entry = "You'll let yourself in — I'll send the code before you arrive.";
    } else if (method === 'Host greets you') {
        entry = "I'll meet you at the property to let you in.";
    } else if (method === 'Keys collected nearby') {
        entry = "Keys are collected from a nearby address — I'll confirm exactly where.";
    } else if (method === 'Building staff') {
        entry = 'The building staff will let you in.';
    } else {
        entry = "I'll confirm exactly how to get in before you arrive.";
    }

    const lines = [
        'Hi ' + firstName + ", you're booked into " + title + ' from ' + checkIn
            + '. Here are the practical details for getting in:',
        '',
        'Address: ' + (listing.location || '— I’ll send this before you arrive'),
        'Arrival: any time after ' + arrival
            + (fmtTime(listing.check_out_time) ? '. Check-out is by ' + fmtTime(listing.check_out_time) : ''),
        'Getting in: ' + entry,
        '',
        "If anything's unclear, just reply here before you set off and I'll sort it. Looking forward to having you.",
    ];
    return lines.join('\n');
}
