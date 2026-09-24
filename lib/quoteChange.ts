// Re-price a stay for a proposed change, the SAME way checkout priced it — the
// listing's nightly rates (with weekend and calendar overrides) for the new
// dates, plus the extra-guest fee above the listing's included-guest number,
// plus pets and cleaning. Never trust a total the browser sends; this is the
// authoritative figure both the create route and the quote endpoint use.

import { quoteBooking, dateFromKey } from '@/lib/pricing';

function round2(v: number): number {
    return Math.round(Number(v || 0) * 100) / 100;
}

export interface ChangeQuoteInput {
    listingId: string;
    newCheckIn: string;   // yyyy-mm-dd
    newCheckOut: string;
    newGuests: number;    // total headcount (adults + children)
    newChildren: number;
    newPets: number;
}

// Returns the new accommodation total for the proposed stay.
export async function quoteChangeTotal(admin: any, input: ChangeQuoteInput): Promise<number> {
    const { data: listing } = await admin
        .from('listings')
        .select('price_per_night, weekend_price, cleaning_fee, pet_fee, extra_guest_fee, extra_guest_after, extra_guest_period')
        .eq('id', input.listingId)
        .maybeSingle();
    if (!listing) return 0;

    const { data: overrideRows } = await admin
        .from('calendar_overrides')
        .select('date, price_override')
        .eq('listing_id', input.listingId);
    const overrides: Record<string, number> = {};
    (overrideRows || []).forEach((row: any) => {
        const key = String(row.date).split('T')[0];
        if (row.price_override) overrides[key] = Number(row.price_override);
    });

    const adults = Math.max(0, Number(input.newGuests) - Number(input.newChildren));
    const quote = quoteBooking(
        listing,
        overrides,
        dateFromKey(input.newCheckIn),
        dateFromKey(input.newCheckOut),
        adults,
        Number(input.newChildren) || 0,
        Number(input.newPets) || 0,
    );
    return round2(quote.total);
}
