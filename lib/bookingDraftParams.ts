// The booking box's choices — dates and guests — kept in the listing's URL,
// the way Airbnb's listing URLs carry check_in, check_out and adults.
//
// They used to live only in the widget's memory, so anything that reloaded
// the page lost them: signing in (the panel reloads to pick up the new
// session), Google sign-in (a full trip to Google and back), tapping the link
// in a sign-in email instead of typing the code, or a phone browser throwing
// the tab away while its owner fetched the code. In the URL they survive all
// four, because every one of those returns to the same address.
//
// Dates are day keys (YYYY-MM-DD) built from the local calendar day, never
// toISOString, which would shift a late-evening date back a day.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

export interface BookingDraft {
    checkIn: string | null;
    checkOut: string | null;
    adults: number;
    children: number;
    pets: number;
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateToKey(d: Date | null | undefined): string | null {
    if (!d || isNaN(d.getTime())) return null;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
}

// Local midnight on that day — what the date picker hands back itself.
export function keyToDate(key: string | null | undefined): Date | undefined {
    if (!key || !KEY_RE.test(key)) return undefined;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

function count(raw: string | null, min: number, max: number, fallback: number): number {
    if (raw == null || !/^\d+$/.test(raw)) return fallback;
    const n = Number(raw);
    return Math.min(max, Math.max(min, n));
}

// Read what the URL says, defensively: a hand-edited or stale link must never
// produce an impossible booking. Check-out must follow check-in or both go.
export function readBookingDraft(params: URLSearchParams, maxGuests = 50): BookingDraft {
    let checkIn = params.get('check_in');
    let checkOut = params.get('check_out');
    if (!keyToDate(checkIn)) checkIn = null;
    if (!keyToDate(checkOut)) checkOut = null;
    if (checkIn && checkOut && checkOut <= checkIn) { checkIn = null; checkOut = null; }
    if (!checkIn) checkOut = null;
    const adults = count(params.get('adults'), 1, Math.max(1, maxGuests), 1);
    const children = count(params.get('children'), 0, Math.max(0, maxGuests - adults), 0);
    const pets = count(params.get('pets'), 0, 10, 0);
    return { checkIn, checkOut, adults, children, pets };
}

// Write the draft into the given params, leaving every other param alone and
// dropping defaults so a fresh listing URL stays clean.
export function writeBookingDraft(params: URLSearchParams, draft: BookingDraft): URLSearchParams {
    const out = new URLSearchParams(params.toString());
    const set = (k: string, v: string | null) => (v ? out.set(k, v) : out.delete(k));
    set('check_in', draft.checkIn);
    set('check_out', draft.checkIn ? draft.checkOut : null);
    set('adults', draft.adults > 1 ? String(draft.adults) : null);
    set('children', draft.children > 0 ? String(draft.children) : null);
    set('pets', draft.pets > 0 ? String(draft.pets) : null);
    return out;
}
