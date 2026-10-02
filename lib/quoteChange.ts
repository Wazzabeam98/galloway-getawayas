// Price a reservation change as a DIFF against what was booked (see
// lib/changeMoney): kept nights keep their paid price, added nights are charged
// at today's rate, removed nights are refunded at what was paid. Never trust a
// total the browser sends; this is the authoritative figure the create route
// and the quote endpoint both use.

import { nightlyRate, dateFromKey, dateKey } from '@/lib/pricing';
import { changeMoney, applyChangePolicy, shorteningNotice } from '@/lib/changeMoney';
import { decreaseRefundFraction } from '@/lib/bookingChange';
import { policyOf } from '@/lib/cancellation';

export interface ChangeQuoteInput {
    newCheckIn: string;   // yyyy-mm-dd
    newCheckOut: string;
    newGuests: number;    // total headcount (adults + children)
    newChildren: number;
    newPets: number;
}

export interface QuotedBooking {
    listing_id: string;
    check_in: string;
    check_out: string;
    guests: number;
    pets: number;
    total_price: number | string;
    nightly_breakdown?: any;
}

// Enumerate the half-open [checkIn, checkOut) night date keys.
function nightKeys(checkIn: string, checkOut: string): string[] {
    const out: string[] = [];
    const start = dateFromKey(checkIn);
    const end = dateFromKey(checkOut);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cursor < end) {
        out.push(dateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}

export interface ChangeQuoteContext {
    // Who is proposing the change. A host-proposed shortening refunds the removed
    // nights in full; a guest-proposed one follows the cancellation policy. When
    // omitted (older callers) the guest rule is applied — the more conservative one.
    initiatedBy?: 'host' | 'guest';
    now?: Date;
}

export async function quoteChangeMoney(admin: any, booking: QuotedBooking, input: ChangeQuoteInput, ctx: ChangeQuoteContext = {}): Promise<{ delta: number; newTotal: number; notice: string | null }> {
    const { data: listing } = await admin
        .from('listings')
        .select('price_per_night, weekend_price, cleaning_fee, pet_fee, extra_guest_fee, extra_guest_after, extra_guest_period, cancellation_policy')
        .eq('id', booking.listing_id)
        .maybeSingle();
    if (!listing) return { delta: 0, newTotal: Math.round(Number(booking.total_price || 0) * 100) / 100, notice: null };

    const { data: overrideRows } = await admin
        .from('calendar_overrides')
        .select('date, price_override')
        .eq('listing_id', booking.listing_id);
    const overrides: Record<string, number> = {};
    (overrideRows || []).forEach((row: any) => {
        const key = String(row.date).split('T')[0];
        if (row.price_override) overrides[key] = Number(row.price_override);
    });

    const oldNightKeys = nightKeys(String(booking.check_in).slice(0, 10), String(booking.check_out).slice(0, 10));
    const newNightKeys = nightKeys(input.newCheckIn, input.newCheckOut);

    // What the guest PAID per night, from the frozen breakdown (#120).
    const paidRate: Record<string, number> = {};
    if (Array.isArray(booking.nightly_breakdown)) {
        booking.nightly_breakdown.forEach((n: any) => { if (n && n.date) paidRate[String(n.date).slice(0, 10)] = Number(n.rate || 0); });
    }
    // Today's rate for every night in the new range (only the added ones are used).
    const currentRate: Record<string, number> = {};
    newNightKeys.forEach((k) => { currentRate[k] = nightlyRate(dateFromKey(k), listing, overrides); });

    const includedGuests = Math.max(1, Number(listing.extra_guest_after || 1));
    const oldChargeable = Math.max(0, Number(booking.guests || 1) - includedGuests);
    const newChargeable = Math.max(0, Number(input.newGuests) - includedGuests);
    const perNight = (listing.extra_guest_period || 'night') !== 'stay';

    const oldTotal = Math.round(Number(booking.total_price || 0) * 100) / 100;
    const money = changeMoney({
        oldNightKeys, newNightKeys, paidRate, currentRate,
        oldChargeableGuests: oldChargeable, newChargeableGuests: newChargeable,
        extraGuestFee: Number(listing.extra_guest_fee || 0), perNightGuestFee: perNight,
        oldPets: Number(booking.pets || 0), newPets: Number(input.newPets) || 0,
        petFee: Number(listing.pet_fee || 0),
        oldTotal,
    });

    // Apply the cancellation policy to a NET LOSS of nights only. A move (same or
    // more nights) settles in full — added nights charged, removed ones credited,
    // netted — with no penalty; only nights given back on net are a partial
    // cancellation. A host-proposed shortening refunds them in full; a
    // guest-proposed one is full inside the free window and the tier's share
    // outside it. Fees always settle in full.
    const fraction = decreaseRefundFraction(
        ctx.initiatedBy || 'guest',
        String(booking.check_in).slice(0, 10),
        listing.cancellation_policy,
        ctx.now,
    );
    const { delta, newTotal } = applyChangePolicy(oldTotal, money, fraction);
    // Warn a guest, before they send, when a shortening won't come back in full.
    const notice = (ctx.initiatedBy || 'guest') === 'guest'
        ? shorteningNotice(money, fraction, policyOf(listing.cancellation_policy))
        : null;
    return { delta, newTotal, notice };
}
