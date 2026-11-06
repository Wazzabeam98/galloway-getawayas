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

import { dateFromKey, nightsBetween, type PriceQuote, type NightRate, type ExtraLine } from '@/lib/pricing';
import { normaliseUnit, type QuoteExtra } from '@/lib/listingExtras';

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
    // Optional paid extras (phase one: just breakfast). Priced the SAME way the
    // cottage path prices host extras (lib/pricing): a per-night extra once per
    // night, a per-person extra once per guest, a per-stay extra once — summed
    // into the total after nothing-is-discounted, each line frozen with its VAT
    // treatment for the receipt. The caller passes the resolved figures; the
    // browser never sets them.
    extras: QuoteExtra[] = [],
    // Guests on the booking, for a per-person extra.
    totalGuests: number = 1,
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

    // Extras — the exact line maths of lib/pricing, so a hotel breakfast is
    // priced, frozen and commissioned identically to a cottage sauna pack.
    const extraLines: ExtraLine[] = [];
    let extrasTotal = 0;
    for (const e of extras || []) {
        if (!e) continue;
        const qty = Math.floor(Number(e.qty) || 0);
        const unitPrice = Number(e.unitPrice) || 0;
        if (!(qty > 0) || !(unitPrice > 0)) continue;
        const units = e.unit === 'night' ? nights
            : e.unit === 'person' ? Math.max(1, totalGuests)
            : 1;
        const lineTotal = money(unitPrice * qty * units);
        extraLines.push({
            id: String(e.id),
            label: String(e.label),
            unit: normaliseUnit(e.unit),
            unitPrice: money(unitPrice),
            qty,
            units,
            lineTotal,
            vat_treatment: e.vat_treatment === 'zero' ? 'zero' : 'standard',
        });
        extrasTotal += lineTotal;
    }
    extrasTotal = money(extrasTotal);

    return {
        nights,
        nightsSubtotal,
        extraGuestTotal: 0,
        petFeeTotal: 0,
        cleaningFeeTotal: 0,
        extrasTotal,
        extras: extraLines,
        discount: null,
        nonRefundableDiscount: 0,
        total: money(nightsSubtotal + extrasTotal),
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
