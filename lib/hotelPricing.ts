// Pricing a hotel room-type stay.
//
// The cottage lib/pricing.ts quoteBooking is built for one nightly rate plus
// cottage fees (cleaning/pet/extra-guest) and the length-of-stay discounts. A
// hotel is simpler in phase one — a room type has one nightly price and a guest
// books a number of rooms — but the rest of the money path (the checkout
// recompute, the snapshot the booking freezes, the receipt) expects the SAME
// PriceQuote shape lib/pricing.ts returns. So this returns exactly that shape,
// with the cottage-only lines zeroed, and the one place a hotel total is worked
// out stays here, read by both the booking panel and the checkout route so a
// browser-posted total is never trusted.
//
// Rate plans (room-only vs breakfast, flexible vs non-refundable) and per-date
// rates arrive in phase two; they will price here and still return a PriceQuote.

import { dateFromKey, nightsBetween, type PriceQuote, type NightRate } from '@/lib/pricing';

export interface HotelRoomTypePricing {
    price_per_night: number;
}

function money(value: number): number {
    return Math.round(value * 100) / 100;
}

// Quote a stay in one room type for a date range and a number of rooms. Dates
// are day keys ('yyyy-mm-dd'), half-open [checkIn, checkOut) exactly as the
// cottage model. Returns a PriceQuote: the whole total is nightly-only in phase
// one, so the fee lines are zero and there is no discount.
export function quoteHotelStay(
    roomType: HotelRoomTypePricing,
    checkInKey: string,
    checkOutKey: string,
    rooms: number = 1,
    // Per-night seasonal prices from the room-type calendar (date key → price).
    // A night not in the map uses the room type's base price.
    overrides: Record<string, number> = {},
): PriceQuote {
    const nights = nightsBetween(dateFromKey(checkInKey), dateFromKey(checkOutKey));
    const roomCount = Math.max(1, Math.floor(rooms || 1));
    const base = Number(roomType.price_per_night) || 0;

    const nightly: NightRate[] = [];
    let nightsSubtotal = 0;
    let cursor = dateFromKey(checkInKey);
    for (let i = 0; i < nights; i++) {
        const key = isoKey(cursor);
        const over = overrides[key];
        const rate = over != null ? Number(over) : base;
        nightly.push({ date: key, rate: money(rate * roomCount), kind: over != null ? 'override' : 'base' });
        nightsSubtotal += rate * roomCount;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    nightsSubtotal = money(nightsSubtotal);

    return {
        nights,
        nightsSubtotal,
        extraGuestTotal: 0,
        petFeeTotal: 0,
        cleaningFeeTotal: 0,
        extrasTotal: 0,
        extras: [],
        discount: null,
        nonRefundableDiscount: 0,
        total: nightsSubtotal,
        nightly,
    };
}

// yyyy-mm-dd from local parts (never toISOString, which shifts a day in BST).
function isoKey(d: Date): string {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
