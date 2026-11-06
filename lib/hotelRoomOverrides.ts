// What a hotel room type's calendar may save per date: a block (close-out) and a
// seasonal nightly price, for a run of dates. The hotel twin of
// lib/calendarOverrides — same shape and the same "each field stands on its own,
// a blank reverts to the room's default" discipline — minus min-nights (a room
// type already has its own min_nights). Used by the dashboard calendar before it
// sends and by /api/hotels/calendar before it writes.

import { MAX_PRICE_PER_NIGHT } from './listingRules';

export const MAX_DATES_PER_SAVE = 400;

export type RoomOverridePatch = {
    dates: string[];
    is_blocked?: boolean;
    price_override?: number | null;
};

export type RoomOverrideRow = {
    date: string;
    is_blocked: boolean;
    price_override: number | null;
};

const has = (o: any, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function checkRoomOverridePatch(input: any): { ok: true; patch: RoomOverridePatch } | { ok: false; error: string } {
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

    const patch: RoomOverridePatch = { dates: Array.from(new Set(dates as string[])) };
    if (has(input, 'is_blocked')) patch.is_blocked = input.is_blocked === true;
    if (has(input, 'price_override')) patch.price_override = price;
    return { ok: true, patch };
}

export function patchChangesSomething(patch: RoomOverridePatch): boolean {
    return patch.is_blocked !== undefined || patch.price_override !== undefined;
}

export function mergeRoomOverrides(
    patch: RoomOverridePatch,
    existing: Record<string, Partial<RoomOverrideRow>>,
): { upsert: RoomOverrideRow[]; clear: string[] } {
    const upsert: RoomOverrideRow[] = [];
    const clear: string[] = [];
    for (const date of patch.dates) {
        const was = existing[date] || {};
        const row: RoomOverrideRow = {
            date,
            is_blocked: patch.is_blocked !== undefined ? patch.is_blocked : !!was.is_blocked,
            price_override: patch.price_override !== undefined ? patch.price_override : (was.price_override != null ? Number(was.price_override) : null),
        };
        if (!row.is_blocked && row.price_override == null) clear.push(date);
        else upsert.push(row);
    }
    return { upsert, clear };
}

export function checkRoomOverrideDates(input: any): { ok: true; dates: string[] } | { ok: false; error: string } {
    const r: any = checkRoomOverridePatch({ dates: input && input.dates });
    return r.ok ? { ok: true, dates: r.patch.dates as string[] } : { ok: false, error: r.error as string };
}
