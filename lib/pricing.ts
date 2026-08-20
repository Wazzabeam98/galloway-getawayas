// The one place a booking total is worked out.
//
// The booking widget uses this to show the guest a price, and the checkout
// route uses it to recalculate that price from the listing before charging
// anything. Because both call the same code, the two can never drift apart —
// and a total posted from the browser can never be taken on trust.

export interface PricingListing {
    price_per_night: number;
    weekend_price?: number | null;
    cleaning_fee?: number | null;
    pet_fee?: number | null;
    extra_guest_fee?: number | null;
    // The number of guests included before the fee starts. 2 means the first
    // two are included and the third onwards is charged.
    extra_guest_after?: number | null;
    // 'night' charges per extra guest per night, 'stay' charges once.
    extra_guest_period?: string | null;
}

export interface PriceQuote {
    nights: number;
    nightsSubtotal: number;
    extraGuestTotal: number;
    petFeeTotal: number;
    cleaningFeeTotal: number;
    total: number;
}

function money(value: number): number {
    return Math.round(value * 100) / 100;
}

// yyyy-mm-dd, built from local parts so a date never slips a day.
export function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
}

// 'yyyy-mm-dd' -> a local Date at midnight. Parsing the string directly
// would give UTC and shift the day for anyone behind Greenwich.
export function dateFromKey(value: string): Date {
    const parts = String(value).split('T')[0].split('-');
    return new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
    );
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
    const start = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
    const end = new Date(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());
    return Math.round((end.getTime() - start.getTime()) / 86400000);
}

// What one night costs: a calendar override wins, then the weekend rate on
// Friday and Saturday, otherwise the standard nightly price.
export function nightlyRate(
    date: Date,
    listing: PricingListing,
    overrides: Record<string, number>
): number {
    const key = dateKey(date);
    // Tested for presence, not truthiness: an override of 0 is a free night
    // somebody set deliberately, and `if (overrides[key])` silently charged
    // them the standard rate instead.
    const override = overrides ? overrides[key] : undefined;
    if (override !== undefined && override !== null && !isNaN(Number(override))) {
        return Number(override);
    }

    const day = date.getDay(); // 5 = Friday, 6 = Saturday
    if ((day === 5 || day === 6) && listing.weekend_price) {
        return Number(listing.weekend_price);
    }

    return Number(listing.price_per_night || 0);
}

// The full breakdown for a stay. Guest counts follow the widget: the first
// guest is included, every additional adult or child carries the extra guest
// fee for each night, pets are charged once, and cleaning is charged once.
export function quoteBooking(
    listing: PricingListing,
    overrides: Record<string, number>,
    checkIn: Date,
    checkOut: Date,
    adults: number,
    children: number,
    pets: number
): PriceQuote {
    const nights = nightsBetween(checkIn, checkOut);

    if (nights <= 0) {
        return {
            nights: 0,
            nightsSubtotal: 0,
            extraGuestTotal: 0,
            petFeeTotal: 0,
            cleaningFeeTotal: 0,
            total: 0,
        };
    }

    let nightsSubtotal = 0;
    const cursor = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
    for (let i = 0; i < nights; i++) {
        nightsSubtotal += nightlyRate(cursor, listing, overrides);
        cursor.setDate(cursor.getDate() + 1);
    }

    const totalGuests = (adults || 0) + (children || 0);
    const extraGuestFee = Number(listing.extra_guest_fee || 0);

    // How many are included before anything is charged. Defaults to 1 so a
    // listing set up before this existed behaves exactly as it did.
    const includedGuests = Math.max(1, Number(listing.extra_guest_after || 1));
    const chargeableGuests = Math.max(0, totalGuests - includedGuests);

    const perNight = (listing.extra_guest_period || 'night') !== 'stay';
    const extraGuestTotal =
        chargeableGuests > 0
            ? extraGuestFee * chargeableGuests * (perNight ? nights : 1)
            : 0;

    const petFeeTotal = (pets || 0) > 0 ? Number(listing.pet_fee || 0) : 0;
    const cleaningFeeTotal = Number(listing.cleaning_fee || 0);

    return {
        nights: nights,
        nightsSubtotal: money(nightsSubtotal),
        extraGuestTotal: money(extraGuestTotal),
        petFeeTotal: money(petFeeTotal),
        cleaningFeeTotal: money(cleaningFeeTotal),
        total: money(nightsSubtotal + extraGuestTotal + petFeeTotal + cleaningFeeTotal),
    };
}

// Two totals agree if they round to the same penny.
export function totalsMatch(a: number, b: number): boolean {
    return Math.abs(money(a) - money(b)) < 0.005;
}
