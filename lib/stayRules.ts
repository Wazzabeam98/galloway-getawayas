// The host's availability rules for a holiday-let stay, in one place: the
// booking card greys out what they forbid and the checkout route refuses what
// they forbid, from the same functions — so what a guest can pick and what
// they can pay for cannot come apart. Airbnb's rules, as the calendar's
// Availability tab sets them:
//
//   minimum nights      a stay is at least this long (unset = 1). A per-date
//                       "min nights" override on the calendar applies to a
//                       stay CHECKING IN on that date, as Airbnb's does.
//   maximum nights      a stay is at most this long (unset = no limit).
//   advance notice      check-in at least this many days after today
//                       ('Same day' = today is fine).
//   preparation time    this many nights kept free before and after every
//                       other stay (bookings here and on other platforms).
//   availability window how far ahead guests can book; the checkout date may
//                       not be later than today + the window.
//
// Framework-free and relative imports only: the client card, the server route
// and the unit test all run it. Day keys are 'yyyy-mm-dd', and "today" is the
// London calendar day, so a guest abroad and the server agree.

export interface StayRulesListing {
    min_nights?: number | null;
    max_nights?: number | null;
    advance_notice?: string | null;
    preparation_time?: string | null;
    availability_window?: string | null;
}

export type StayRange = { start: string; end: string };

function keyToUtc(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(d: Date): string {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

export function addDaysKey(key: string, days: number): string {
    const d = keyToUtc(key);
    d.setUTCDate(d.getUTCDate() + days);
    return utcToKey(d);
}

export function addMonthsKey(key: string, months: number): string {
    const d = keyToUtc(key);
    d.setUTCMonth(d.getUTCMonth() + months);
    return utcToKey(d);
}

export function nightsBetweenKeys(checkIn: string, checkOut: string): number {
    return Math.round((keyToUtc(checkOut).getTime() - keyToUtc(checkIn).getTime()) / 86400000);
}

/** Today's date in London, as a day key. */
export function londonTodayKey(now: Date = new Date()): string {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const g = (t: string) => (p.find((x) => x.type === t) || { value: '' }).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
}

// '2 days' → 2, '1 day' → 1, 'Same day' / 'None' / unset → 0.
function leadingDays(value: string | null | undefined): number {
    const m = String(value || '').match(/^(\d+)\s*day/i);
    return m ? Number(m[1]) : 0;
}

export const noticeDays = (listing: StayRulesListing): number => leadingDays(listing.advance_notice);
export const prepDays = (listing: StayRulesListing): number => leadingDays(listing.preparation_time);

/** '9 months' → 9; 'All future dates' or unset → null (no window). */
export function windowMonths(listing: StayRulesListing): number | null {
    const m = String(listing.availability_window || '').match(/^(\d+)\s*month/i);
    return m ? Number(m[1]) : null;
}

/** The minimum for a stay checking in on `checkInKey`: that date's override, else the listing's, else 1. */
export function minNightsFor(listing: StayRulesListing, minOverrides: Record<string, number> | null | undefined, checkInKey: string | null): number {
    const override = checkInKey && minOverrides ? Number(minOverrides[checkInKey] || 0) : 0;
    const base = Number(listing.min_nights || 0);
    return Math.max(1, Math.floor(override > 0 ? override : base > 0 ? base : 1));
}

/** The maximum, or null for no limit. */
export function maxNightsFor(listing: StayRulesListing): number | null {
    const n = Number(listing.max_nights || 0);
    return n > 0 ? Math.floor(n) : null;
}

/** The first date a guest may check in. */
export function earliestCheckInKey(listing: StayRulesListing, todayKey: string): string {
    return addDaysKey(todayKey, noticeDays(listing));
}

/** The latest checkout date the window allows, or null for no window. */
export function latestCheckOutKey(listing: StayRulesListing, todayKey: string): string | null {
    const months = windowMonths(listing);
    return months ? addMonthsKey(todayKey, months) : null;
}

/** The nights preparation time keeps free around other stays. */
export function prepBufferNights(ranges: StayRange[], days: number): Set<string> {
    const out = new Set<string>();
    if (days <= 0) return out;
    for (const r of ranges || []) {
        if (!r || !r.start || !r.end) continue;
        for (let i = 1; i <= days; i++) {
            out.add(addDaysKey(r.start, -i));      // before it checks in
            out.add(addDaysKey(r.end, i - 1));     // after it checks out
        }
    }
    return out;
}

/** "3-night minimum · 14-night maximum", or '' when there is nothing to say. */
export function stayLengthNote(min: number, max: number | null): string {
    const parts: string[] = [];
    if (min > 1) parts.push(`${min}-night minimum`);
    if (max) parts.push(`${max}-night maximum`);
    return parts.join(' · ');
}

/**
 * Why this stay breaks the host's rules, in the guest's words — or null.
 * `prepBuffer` is prepBufferNights() over the OTHER stays on the listing.
 */
export function stayProblem(input: {
    listing: StayRulesListing;
    checkIn: string;
    checkOut: string;
    todayKey: string;
    minOverrides?: Record<string, number> | null;
    prepBuffer?: Set<string> | null;
    // Every unavailable night — taken here, taken on another platform, host
    // blocked, or kept free by preparation time. Only used to let a stay
    // SHORTER than the minimum through when it fills a gap exactly (see
    // fillsGapExactly). Omit it and the minimum is enforced with no exception,
    // which is the old behaviour.
    unavailable?: Set<string> | null;
}): string | null {
    const { listing, checkIn, checkOut, todayKey } = input;
    const nights = nightsBetweenKeys(checkIn, checkOut);
    if (!(nights > 0)) return 'Those dates don’t make a valid stay.';

    const notice = noticeDays(listing);
    if (checkIn < earliestCheckInKey(listing, todayKey)) {
        return notice > 0
            ? `This host needs ${notice} day${notice === 1 ? '' : 's'}’ notice before check-in. Please pick a later date.`
            : 'That check-in date has passed. Please pick a later date.';
    }

    const latest = latestCheckOutKey(listing, todayKey);
    if (latest && checkOut > latest) {
        return 'This host only accepts bookings within their availability window. Please pick earlier dates.';
    }

    const min = minNightsFor(listing, input.minOverrides, checkIn);
    // A stay shorter than the minimum is refused UNLESS it fills a gap between
    // two unavailable periods exactly — the night before check-in and the
    // checkout night are both taken — so nothing bookable is orphaned either
    // side. Airbnb does the same: a 2-night stay can take the only 2 free
    // nights between two bookings even where the minimum is 3.
    if (nights < min && !fillsGapExactly(checkIn, checkOut, input.unavailable)) {
        return `This place has a ${min}-night minimum for those dates.`;
    }

    const max = maxNightsFor(listing);
    if (max && nights > max) return `This place has a ${max}-night maximum.`;

    if (input.prepBuffer && input.prepBuffer.size) {
        for (let i = 0; i < nights; i++) {
            if (input.prepBuffer.has(addDaysKey(checkIn, i))) {
                return 'Those dates are too close to another stay — the host needs time to get the place ready. Please pick different dates.';
            }
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// WHICH DAYS THE BOOKING CALENDAR LETS A GUEST PICK
//
// A stay occupies its NIGHTS (check-in up to, not including, checkout), the
// same '[)' the database's no-overlap rule and checkout use. So a day whose
// night is unavailable — another stay checks in, a host block, or a night kept
// free by preparation time — can still be a CHECKOUT, as on Airbnb, as long as
// none of the nights being stayed is unavailable.
// `unavailable` is every unavailable night (taken, blocked, preparation time).
// ---------------------------------------------------------------------------

/** A day can be a check-in if its own night is free. */
export function checkInPickable(key: string, unavailable: Set<string>): boolean {
    return !unavailable.has(key);
}

/**
 * Does the stay [checkIn, checkOut) fill a gap between two unavailable periods
 * EXACTLY? True only when every night of the stay is free, the night before
 * check-in is unavailable, and the checkout night is unavailable — so the stay
 * butts onto a taken (or blocked, or prep-held) night at both ends and leaves
 * no free night stranded. This is the one case a stay shorter than the host's
 * minimum is allowed, the same gap-night booking Airbnb permits.
 *
 * The edge of the calendar, the past and the booking window are NOT boundaries:
 * a short run of free nights trapped against one of those is not a gap that can
 * be filled, it is an orphan the host cannot sell — which is exactly what the
 * calendar marks as unsellable.
 */
export function fillsGapExactly(checkIn: string, checkOut: string, unavailable?: Set<string> | null): boolean {
    if (!unavailable || unavailable.size === 0) return false;
    const nights = nightsBetweenKeys(checkIn, checkOut);
    if (nights <= 0) return false;
    for (let i = 0; i < nights; i++) {
        if (unavailable.has(addDaysKey(checkIn, i))) return false;
    }
    return unavailable.has(addDaysKey(checkIn, -1)) && unavailable.has(checkOut);
}

/** A day can be the checkout for a stay starting `startKey` if every night is free and the length fits. */
export function checkoutPickable(startKey: string, key: string, unavailable: Set<string>, min: number, max: number | null): boolean {
    const nights = nightsBetweenKeys(startKey, key);
    if (nights <= 0) return false;
    if (max !== null && nights > max) return false;
    for (let i = 0; i < nights; i++) {
        if (unavailable.has(addDaysKey(startKey, i))) return false;
    }
    // Below the minimum only when the stay fills a gap exactly (see above).
    if (nights < min && !fillsGapExactly(startKey, key, unavailable)) return false;
    return true;
}

/**
 * Which of these free nights the host cannot sell to anyone.
 *
 * `orderedNights` is a run of CONSECUTIVE night keys (pass the whole bookable
 * horizon, not just one month, so a run that crosses the month edge is not
 * cut short and mis-judged). The free nights between unavailable ones are
 * grouped into runs; a run is sellable when either a stay of at least its
 * minimum fits inside it, or it is closed by an unavailable night on BOTH
 * sides so a guest can fill it exactly (fillsGapExactly). A run that is too
 * short for the minimum and open on at least one side — trapped against the
 * past, the booking window, or simply a long empty stretch it cannot reach the
 * end of — has no stay that can include it, so every night in it is returned.
 *
 * `minFor(checkInKey)` gives the minimum for a stay checking in on that day,
 * i.e. minNightsFor(listing, overrides, key).
 */
export function unsellableNights(
    orderedNights: string[],
    unavailable: Set<string>,
    minFor: (checkInKey: string) => number,
): Set<string> {
    const out = new Set<string>();
    const n = orderedNights.length;
    let i = 0;
    while (i < n) {
        if (unavailable.has(orderedNights[i])) { i++; continue; }
        let j = i;
        while (j < n && !unavailable.has(orderedNights[j])) j++;
        const runStart = orderedNights[i];
        const runEnd = orderedNights[j - 1];
        const runLen = nightsBetweenKeys(runStart, runEnd) + 1;
        const leftBounded = unavailable.has(addDaysKey(runStart, -1));
        const rightBounded = unavailable.has(addDaysKey(runEnd, 1));
        const sellable = runLen >= minFor(runStart) || (leftBounded && rightBounded);
        if (!sellable) {
            for (let k = i; k < j; k++) out.add(orderedNights[k]);
        }
        i = j;
    }
    return out;
}
