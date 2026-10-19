// What the calendar's Manage dates panel may save: a nightly price, a minimum
// stay and whether the dates are blocked, for a run of dates. One check, used
// by the panel before it sends and by /api/listings/calendar before it writes,
// so the browser and the server can never disagree about what is allowed.

import { MAX_PRICE_PER_NIGHT } from './listingRules';

export const MAX_DATES_PER_SAVE = 400;
export const MAX_MIN_NIGHTS = 365;

export type OverridePatch = {
    dates: string[];
    is_blocked: boolean;
    price_override: number | null;
    min_nights_override: number | null;
};

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

    return {
        ok: true,
        patch: {
            dates: Array.from(new Set(dates as string[])),
            is_blocked: input.is_blocked === true,
            price_override: price,
            min_nights_override: minNights,
        },
    };
}

/** For a reset: just the dates, checked the same way. */
export function checkOverrideDates(input: any): { ok: true; dates: string[] } | { ok: false; error: string } {
    const r: any = checkOverridePatch({ dates: input && input.dates });
    return r.ok ? { ok: true, dates: r.patch.dates as string[] } : { ok: false, error: r.error as string };
}
