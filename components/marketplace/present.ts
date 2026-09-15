// Small presentational helpers for the marketplace — pure, shared by the grid,
// the listing page and the booking widgets so a price or a time reads the same
// everywhere. No JSX, no 'use client'.

import type { MpProvider } from '@/lib/experiencesData';

const UNIT_SUFFIX: Record<string, string> = {
    person: ' pp', night: ' / night', hour: ' / hr', ticket: '', item: '', flat: '',
};

/** "£45", "from £18", "from £20 pp" — the card's price line. */
export function fromPriceLabel(p: MpProvider): string {
    const min = p.priceFrom;
    const cheapest = [...p.items].sort((a, b) => a.price - b.price)[0];
    const suffix = cheapest ? (UNIT_SUFFIX[cheapest.unit] || '') : '';
    const money = '£' + (Number.isInteger(min) ? String(min) : min.toFixed(2));
    return (p.items.length > 1 ? 'from ' + money : money) + suffix;
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

/**
 * Coverage as a guest should read it — a radius as a radius, not a place.
 * A label like "Kirkcudbright and 25 miles" becomes "Within 25 miles of
 * Kirkcudbright"; a named-region label ("The Stewartry", "A & B") passes
 * through unchanged. Null when they cover nowhere.
 */
export function coverageDisplay(p: MpProvider): string | null {
    const raw = coverageLabel(p);
    if (!raw) return null;
    const m = raw.match(/^(.+?)\s+and\s+(\d+(?:\.\d+)?)\s*miles?$/i);
    if (m) return 'Within ' + Math.round(Number(m[2])) + ' miles of ' + m[1].trim();
    return raw;
}

/**
 * The pre-payment "where it happens" line — coverage, never the base town.
 * A comes-to-you provider happens at the guest's own cottage, so it says so even
 * with no coverage set (never a blank); a fixed-venue provider with no coverage
 * has nothing safe to show before payment, so this returns null and the row is
 * dropped rather than left empty.
 */
export function whereLine(p: MpProvider): string | null {
    if (p.shape === 'comes_to_you' || p.fulfilment === 'delivery') return 'Comes to your cottage';
    return coverageDisplay(p);
}

/** The per-item price as the guest reads it on a listing: "£30 pp", "£45". */
export function itemPriceLabel(price: number, unit: string): string {
    const money = '£' + (Number.isInteger(price) ? String(price) : price.toFixed(2));
    return money + (UNIT_SUFFIX[unit] || '');
}

/** The activity level as a guest reads it, from the stored key. Null for an
 *  unknown/blank value, so the row is dropped rather than shown empty. */
export function activityLevelLabel(level: string | null | undefined): string | null {
    const map: Record<string, string> = {
        gentle: 'Gentle — suitable for most',
        moderate: 'Moderate — some walking or standing',
        challenging: 'Challenging — a good level of fitness needed',
    };
    return map[String(level || '').trim().toLowerCase()] || null;
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

/** The full "per person / per night" phrase for prose. Empty for flat. */
export function unitPhrase(unit: string): string {
    const map: Record<string, string> = {
        person: 'per person', night: 'per night', hour: 'per hour', ticket: 'per ticket', item: 'per item', flat: '',
    };
    return map[unit] || '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd → "Sat 14 Sep". */
export function dateLabel(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00Z');
    if (isNaN(d.getTime())) return dateKey;
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
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

/** The card hint for a slot: "Next: Sat 2pm" plus how many more. */
export function nextSessionLabel(p: MpProvider): string {
    if (!p.sessions || !p.sessions.length) return '';
    const s = p.sessions[0];
    const more = p.sessions.length - 1;
    return 'Next: ' + DAYS[new Date(s.date + 'T00:00:00Z').getUTCDay()] + ' ' + timeLabel(s.time)
        + (more > 0 ? '  ·  ' + (more + 1) + ' times' : '');
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
