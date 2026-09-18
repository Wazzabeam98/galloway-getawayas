// Small presentational helpers for the marketplace — pure, shared by the grid,
// the listing page and the booking widgets so a price or a time reads the same
// everywhere. No JSX, no 'use client'.

import type { MpProvider } from '@/lib/experiencesData';

const UNIT_SUFFIX: Record<string, string> = {
    person: ' / guest', night: ' / night', hour: ' / hr', ticket: '', item: '', flat: '',
};

/** "£45", "from £18", "from £20 / guest" — the card's price line. */
export function fromPriceLabel(p: MpProvider): string {
    const min = p.priceFrom;
    const cheapest = [...p.items].sort((a, b) => a.price - b.price)[0];
    const suffix = cheapest ? (UNIT_SUFFIX[cheapest.unit] || '') : '';
    const money = '£' + (Number.isInteger(min) ? String(min) : min.toFixed(2));
    return (p.items.length > 1 ? 'from ' + money : money) + suffix;
}

/** The headline price split so the unit can be set smaller and grey, Airbnb-style:
 *  money "£15" as the figure, per "/ guest" as quiet subtext (empty for a flat
 *  price). The caller adds any "From " prefix. */
export function priceParts(price: number, unit: string): { money: string; per: string } {
    const money = '£' + (Number.isInteger(price) ? String(price) : price.toFixed(2));
    return { money, per: (UNIT_SUFFIX[unit] || '').trim() };
}

/** The one-line cancellation policy for the booking panel, where Airbnb shows it:
 *  a plain "Free cancellation" (the window/detail lives in the Cancellation
 *  section lower down), or "No refunds". */
export function cancellationBadge(_hours: number | null | undefined, noRefund: boolean | null | undefined): string {
    return noRefund ? 'No refunds' : 'Free cancellation';
}

/** The regions a provider covers, read as one line: "The Stewartry", "The
 *  Rhins & The Machars", "A, B & C". Null when they've listed none, so the card
 *  shows nothing rather than an empty marker. */
export function coverageLabel(p: MpProvider): string | null {
    const a = (p.areas || []).filter(Boolean);
    if (!a.length) return null;
    if (a.length === 1) return a[0];
    if (a.length === 2) return a[0] + ' & ' + a[1];
    return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
}

// A "town and N miles" label — a radius carried over from the trades directory,
// where a van reaches a circle. It describes a catchment, not a place, so it must
// never surface on a guest experience: a sauna sits at one spot, and "within 25
// miles of Kirkcudbright" could be any town in that circle. Named regions
// ("The Stewartry") are fine and are not radii.
function isRadiusLabel(label: string): boolean {
    return /\s+and\s+\d+(?:\.\d+)?\s*miles?$/i.test(String(label || '').trim());
}

/** The regions a provider covers, with any radius label dropped. Null when
 *  nothing named is left. */
export function namedRegions(p: MpProvider): string | null {
    const named = (p.areas || []).filter(Boolean).filter((a) => !isRadiusLabel(a));
    if (!named.length) return null;
    if (named.length === 1) return named[0];
    if (named.length === 2) return named[0] + ' & ' + named[1];
    return named.slice(0, -1).join(', ') + ' & ' + named[named.length - 1];
}

/** True for a provider that travels to the guest rather than sitting at one
 *  place — a comes-to-you chef, or a slot/made-to-order that delivers. */
function travels(p: MpProvider): boolean {
    return p.shape === 'comes_to_you' || p.fulfilment === 'delivery';
}

/** The one place a fixed venue sits at — its public town (`based_line`, the
 *  DB-derived collection town; the street stays private until payment). Null for
 *  a traveller (no single place) and for a venue with no town stored. Never a
 *  radius, never a street. */
export function locationTag(p: MpProvider): string | null {
    if (travels(p)) return null;
    return (p.based_line || '').trim() || null;
}

/** A traveller's covered regions as a line — "Travels to The Stewartry & The
 *  Machars", or "Travels across Dumfries & Galloway". Null for a fixed venue, or
 *  a traveller who named no region (a bare radius is not a region). */
export function travelCoverageLine(p: MpProvider): string | null {
    if (!travels(p)) return null;
    const regions = namedRegions(p);
    if (!regions) return null;
    if (/^all of dumfries/i.test(regions)) return 'Travels across Dumfries & Galloway';
    return 'Travels to ' + regions;
}

/** The one location line on a provider card — a fixed venue's town, or a
 *  traveller's covered regions; never a radius, never a street. */
export function cardLocationLine(p: MpProvider): string | null {
    return travels(p) ? travelCoverageLine(p) : locationTag(p);
}

/** The pre-payment "where it happens" line. A comes-to-you provider happens at
 *  the guest's own cottage; a fixed venue happens in one town (its `based_line`)
 *  — never the old trades radius. Null with no town stored, so the row is dropped
 *  rather than showing a misleading circle. */
export function whereLine(p: MpProvider): string | null {
    if (travels(p)) return 'Comes to your cottage';
    return locationTag(p);
}

/** The per-item price as the guest reads it on a listing: "£30 / guest", "£45". */
export function itemPriceLabel(price: number, unit: string): string {
    const money = '£' + (Number.isInteger(price) ? String(price) : price.toFixed(2));
    return money + (UNIT_SUFFIX[unit] || '');
}

/** A length in minutes as a guest reads it: "45 min", "1 hr", "1 hr 30 min",
 *  "2 hr". Null/0/negative → null, so a caller renders nothing rather than "0 min". */
export function durationLabel(minutes: number | null | undefined): string | null {
    const m = Math.round(Number(minutes) || 0);
    if (m <= 0) return null;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return mm + ' min';
    if (mm === 0) return h + ' hr';
    return h + ' hr ' + mm + ' min';
}

/**
 * The one duration line for the header highlight, read across a provider's
 * offerings: a single length shows plainly ("45 min"); a spread shows the range
 * ("30 min – 1 hr 30 min"). Timed items (a massage's per-treatment lengths) win;
 * an untimed slot provider falls back to its single session length. Null when
 * nothing carries a length (a chef, a made-to-order baker) — the row disappears.
 */
export function durationSummary(p: MpProvider): string | null {
    const perItem = (p.items || [])
        .map((i) => Math.round(Number(i.duration_minutes) || 0))
        .filter((n) => n > 0);
    const mins = perItem.length ? perItem : (p.slotLength > 0 ? [p.slotLength] : []);
    if (!mins.length) return null;
    const lo = Math.min(...mins), hi = Math.max(...mins);
    return lo === hi ? durationLabel(lo) : durationLabel(lo) + ' – ' + durationLabel(hi);
}

/** "30 years' experience" from the bare years a provider typed. Tolerant of a
 *  non-numeric answer ("since 2010") — that is shown as-is with no suffix. Null
 *  when blank. */
export function yearsLabel(years: string | null | undefined): string | null {
    const s = (years || '').trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    if (String(n) === s && n > 0) return n + (n === 1 ? " year's experience" : " years' experience");
    return s; // free-text answer — show their own words
}

/** "Up to 8 guests" — a non-slot provider's largest group, for Good to know.
 *  Null when unknown or nonsensical. */
export function groupSizeLabel(maxGuests: number | null | undefined): string | null {
    const n = Math.floor(Number(maxGuests) || 0);
    if (n <= 0) return null;
    if (n === 1) return 'One guest at a time';
    return 'Up to ' + n + ' guests';
}

/** How many people a SLOT experience holds, from the capacity we already resolve
 *  (not a hardcoded number). Reads the same for both shapes it might describe: a
 *  per-person table where up to N seats can be booked, and a whole-session hire a
 *  group of up to N takes together — "Up to 7 people". A one-seat provider (a
 *  massage) reads "One person at a time". Null for 0/unknown. */
export function capacityLabel(capacity: number | null | undefined): string | null {
    const n = Math.floor(Number(capacity) || 0);
    if (n <= 0) return null;
    if (n === 1) return 'One person at a time';
    return 'Up to ' + n + ' people';
}

/** The full "per person / per night" phrase for prose. Empty for flat. */
export function unitPhrase(unit: string): string {
    const map: Record<string, string> = {
        person: 'per person', night: 'per night', hour: 'per hour', ticket: 'per ticket', item: 'per item', flat: '',
    };
    return map[unit] || '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** yyyy-mm-dd → "Sat 14 Sep". */
export function dateLabel(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00Z');
    if (isNaN(d.getTime())) return dateKey;
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

/** yyyy-mm-dd → "September 2026", the month header Airbnb shows above its date list. */
export function monthYearLabel(dateKey: string): string {
    const d = new Date(String(dateKey).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    return MONTHS_FULL[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** The day heading over a day's times, Airbnb-style: "Today, 18 September",
 *  "Tomorrow, 19 September", else "Fri, 19 September". `today` is a yyyy-mm-dd key
 *  so the caller fixes the timezone (London). */
export function dayHeadingLabel(dateKey: string, today: string, tomorrow: string): string {
    const key = String(dateKey).slice(0, 10);
    const d = new Date(key + 'T00:00:00Z');
    if (isNaN(d.getTime())) return key;
    const rest = d.getUTCDate() + ' ' + MONTHS_FULL[d.getUTCMonth()];
    if (key === today) return 'Today, ' + rest;
    if (key === tomorrow) return 'Tomorrow, ' + rest;
    return DAYS[d.getUTCDay()] + ', ' + rest;
}

/** "HH:MM" → "2pm" / "2:30pm". */
export function timeLabel(t: string): string {
    const [hs, ms] = String(t).split(':');
    let h = parseInt(hs, 10);
    const m = parseInt(ms, 10) || 0;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return h + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
}

/** The card hint for a slot: the next available time, and how many days have
 *  availability — "Next: Sat 2pm · 12 dates". A count of every slot in the horizon
 *  ("711 times") means nothing to a guest; distinct bookable days do. Merges the
 *  open-hours sessions and the declared dated sessions. */
export function nextSessionLabel(p: MpProvider): string {
    const rows = [
        ...(p.sessions || []).map((s) => ({ date: s.date, time: s.time })),
        ...(p.declaredSessions || []).map((d) => ({ date: d.date, time: d.time })),
    ].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    if (!rows.length) return '';
    const first = rows[0];
    const days = new Set(rows.map((r) => r.date)).size;
    const next = 'Next: ' + DAYS[new Date(first.date + 'T00:00:00Z').getUTCDay()] + ' ' + timeLabel(first.time);
    return days > 1 ? next + '  ·  ' + days + ' dates' : next;
}

/**
 * How an experience's date reads, framed by shape — because a date does not mean
 * the same thing to a chef and a baker:
 *   slot          — a date AND a time you turn up to: "Sat 14 Sep at 2pm"
 *   comes_to_you  — an appointment on the day (the hour is arranged after): "Sat 14 Sep"
 *   made_to_order — a deadline, not an event: "Ready for Sat 14 Sep"
 */
export function whenLabel(shape: string, dateKey: string, time: string | null): string {
    const d = dateLabel(String(dateKey).slice(0, 10));
    if (shape === 'slot') return time ? d + ' at ' + timeLabel(String(time).slice(0, 5)) : d;
    if (shape === 'made_to_order') return 'Ready for ' + d;
    return d;
}

/** The label above the date, per shape. "Ready for" already carries the date. */
export function whenHeading(shape: string): string {
    return shape === 'made_to_order' ? 'Ready for' : 'When';
}

/**
 * Does a headcount — "N guests", the cottage party — mean anything for this
 * shape? A private chef cooks for the party, so it does. A baker makes a cake of
 * a size for a date and nobody attends, so "2 guests" is nonsense and is dropped.
 * A slot counts seats booked (its own quantity), not the cottage party.
 */
export function partyMatters(shape: string): boolean {
    return shape === 'comes_to_you';
}

/** The cancellation policy in plain words, shown before the guest commits. */
export function cancellationSentence(shape: string, hours: number, who: string): string {
    const h = Math.max(0, Number(hours) || 0);
    const tail = ' After that it’s ' + who + '’s decision — they can still refund you, but it isn’t automatic.';
    if (shape === 'slot') {
        return 'Free to cancel up to ' + h + ' hour' + (h === 1 ? '' : 's') + ' before your time, and the slot reopens for someone else.' + tail;
    }
    const days = Math.round(h / 24);
    return 'Free to cancel up to ' + days + ' day' + (days === 1 ? '' : 's') + ' before, for a full refund.' + tail;
}

/**
 * A town-ish token from a listing's full address, for the header. Forgiving —
 * returns null rather than a wrong guess, so the header reads "Local
 * experiences" cleanly when it can't tell.
 */
export function townFromLocation(location: string | null | undefined): string | null {
    if (!location) return null;
    const parts = String(location).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    // The last part is usually a postcode; the one before it is usually the town.
    const candidate = parts[parts.length - 2];
    // Reject something that is plainly a postcode or a number.
    if (/\d/.test(candidate) && candidate.length <= 8) return null;
    return candidate || null;
}
