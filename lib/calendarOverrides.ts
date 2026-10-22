// What the calendar's Manage dates panel may save: a nightly price, a minimum
// stay and whether the dates are blocked, for a run of dates. One check, used
// by the panel before it sends and by /api/listings/calendar before it writes,
// so the browser and the server can never disagree about what is allowed.
//
// EACH SETTING STANDS ON ITS OWN. A field left out of the patch is left as it
// is on every date — so setting a price across a month neither unblocks the
// blocked nights in it nor wipes (or stamps) a minimum stay, and setting a
// minimum stay leaves each night's price alone. A field sent blank ('' or
// null) goes back to the listing's default. Airbnb's calendar behaves the same:
// editing the price of a run of dates touches nothing but the price.

import { MAX_PRICE_PER_NIGHT } from './listingRules';

export const MAX_DATES_PER_SAVE = 400;
export const MAX_MIN_NIGHTS = 365;

export type OverridePatch = {
    dates: string[];
    // Absent = leave each date as it is.
    is_blocked?: boolean;
    price_override?: number | null;
    min_nights_override?: number | null;
};

export type OverrideRow = {
    date: string;
    is_blocked: boolean;
    price_override: number | null;
    min_nights_override: number | null;
};

const has = (o: any, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The cleaned patch, or the reason it can't be saved. */
export function checkOverridePatch(input: any): { ok: true; patch: OverridePatch } | { ok: false; error: string } {
    const dates: unknown = input && input.dates;
    if (!Array.isArray(dates) || dates.length === 0) return { ok: false, error: 'Pick the dates first.' };
    if (dates.length > MAX_DATES_PER_SAVE) return { ok: false, error: 'That’s too many dates at once.' };
    for (const d of dates) {
        if (typeof d !== 'string' || !DAY.test(d) || isNaN(new Date(d + 'T00:00:00Z').getTime())) {
            return { ok: false, error: 'One of those dates isn’t a real date.' };
        }
    }

    const rawPrice = input.price_override;
    let price: number | null = null;
    if (rawPrice !== null && rawPrice !== undefined && rawPrice !== '') {
        price = Number(rawPrice);
        if (!isFinite(price) || price <= 0) return { ok: false, error: 'Enter a nightly price above £0.' };
        if (price > MAX_PRICE_PER_NIGHT) return { ok: false, error: 'The nightly price can’t be more than £' + MAX_PRICE_PER_NIGHT + '.' };
        price = Math.round(price * 100) / 100;
    }

    const rawMin = input.min_nights_override;
    let minNights: number | null = null;
    if (rawMin !== null && rawMin !== undefined && rawMin !== '') {
        minNights = Number(rawMin);
        if (!Number.isInteger(minNights) || minNights < 1 || minNights > MAX_MIN_NIGHTS) {
            return { ok: false, error: 'The minimum stay must be a whole number of nights, from 1 to ' + MAX_MIN_NIGHTS + '.' };
        }
    }

    const patch: OverridePatch = { dates: Array.from(new Set(dates as string[])) };
    if (has(input, 'is_blocked')) patch.is_blocked = input.is_blocked === true;
    if (has(input, 'price_override')) patch.price_override = price;
    if (has(input, 'min_nights_override')) patch.min_nights_override = minNights;
    return { ok: true, patch };
}

/** Does the patch change anything at all? */
export function patchChangesSomething(patch: OverridePatch): boolean {
    return patch.is_blocked !== undefined || patch.price_override !== undefined || patch.min_nights_override !== undefined;
}

/**
 * The rows to write for a patch, merged over what each date already holds:
 * only the fields in the patch change. A date left with nothing on it (not
 * blocked, default price, default minimum) comes back in `clear` instead, so
 * it is deleted rather than kept as an empty row.
 */
export function mergeOverrides(
    patch: OverridePatch,
    existing: Record<string, Partial<OverrideRow>>,
): { upsert: OverrideRow[]; clear: string[] } {
    const upsert: OverrideRow[] = [];
    const clear: string[] = [];
    for (const date of patch.dates) {
        const was = existing[date] || {};
        const row: OverrideRow = {
            date,
            is_blocked: patch.is_blocked !== undefined ? patch.is_blocked : !!was.is_blocked,
            price_override: patch.price_override !== undefined ? patch.price_override : (was.price_override != null ? Number(was.price_override) : null),
            min_nights_override: patch.min_nights_override !== undefined ? patch.min_nights_override : (was.min_nights_override != null ? Number(was.min_nights_override) : null),
        };
        if (!row.is_blocked && row.price_override == null && row.min_nights_override == null) clear.push(date);
        else upsert.push(row);
    }
    return { upsert, clear };
}

/** For a reset: just the dates, checked the same way. */
export function checkOverrideDates(input: any): { ok: true; dates: string[] } | { ok: false; error: string } {
    const r: any = checkOverridePatch({ dates: input && input.dates });
    return r.ok ? { ok: true, dates: r.patch.dates as string[] } : { ok: false, error: r.error as string };
}
