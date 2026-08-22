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
    listing_ids: string[] | null;
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
    const parts = String(dateKey).split('T')[0].split('-');
    const d = new Date(Date.UTC(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
    ));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
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

// Does this template apply to this listing? An empty selection means all of
// them, which is what the editor implies by leaving nothing ticked.
export function appliesToListing(template: Template, listingId: string): boolean {
    const targeted = template.listing_ids || [];
    return targeted.length === 0 || targeted.indexOf(listingId) !== -1;
}

export function fillPlaceholders(
    body: string,
    values: { guestName: string; listing: string; checkIn: string; checkOut: string }
): string {
    return String(body)
        .split('{guest_name}').join(values.guestName)
        .split('{listing}').join(values.listing)
        .split('{check_in}').join(values.checkIn)
        .split('{check_out}').join(values.checkOut);
}
