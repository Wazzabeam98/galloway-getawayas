// The set of TIMES a request-shape provider offers.
//
// A slot provider's times come from its weekly template / declared sessions. The
// two request shapes had no time at all: a chef (comes_to_you) simply came "on
// the day", and a made-to-order baker was collected/delivered "some time" that
// day. Providers now name the times they offer — a chef the sittings they cook,
// a baker the collection/delivery windows — and the guest picks one at booking.
//
// Stored as guest_details.offered_times: an array of "HH:MM" 24-hour strings.
// Empty (or unset) means the provider has named none, and the booking flow then
// falls back to asking only for a date (backwards-compatible with orders taken
// before this existed).

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Normalise one value to a canonical "HH:MM", or null if it isn't a time. */
export function normaliseTime(v: unknown): string | null {
    if (v == null) return null;
    const s = String(v).trim().slice(0, 5);
    const m = TIME_RE.exec(s);
    if (!m) {
        // Also accept "H:MM" / "HH:MM:SS".
        const m2 = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(v).trim());
        if (!m2) return null;
        return m2[1].padStart(2, '0') + ':' + m2[2];
    }
    return m[1].padStart(2, '0') + ':' + m[2];
}

/** The provider's offered times, canonical "HH:MM", de-duplicated and sorted. */
export function offeredTimes(guestDetails: any): string[] {
    const raw = guestDetails && guestDetails.offered_times;
    if (!Array.isArray(raw)) return [];
    const set = new Set<string>();
    for (const v of raw) {
        const t = normaliseTime(v);
        if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** True when this provider names at least one time. */
export function hasOfferedTimes(guestDetails: any): boolean {
    return offeredTimes(guestDetails).length > 0;
}

/** True when `t` is one of the provider's offered times. */
export function isOfferedTime(guestDetails: any, t: unknown): boolean {
    const norm = normaliseTime(t);
    if (!norm) return false;
    return offeredTimes(guestDetails).includes(norm);
}

/** "7:30pm" from "19:30" — a friendly label for a picked time. */
export function prettyTime(t: unknown): string {
    const norm = normaliseTime(t);
    if (!norm) return '';
    const [h, m] = norm.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ampm;
}
