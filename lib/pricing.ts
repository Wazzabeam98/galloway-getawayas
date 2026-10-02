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

// One night, priced, with the reason it cost what it did. `kind` is what a
// guest reads to see why a night was dearer — the weekend rate, or a date the
// host priced by hand — rather than taking the subtotal on trust.
export interface NightRate {
    date: string; // yyyy-mm-dd
    rate: number;
    kind: 'base' | 'weekend' | 'override';
}

export interface PriceQuote {
    nights: number;
    nightsSubtotal: number;
    extraGuestTotal: number;
    petFeeTotal: number;
    cleaningFeeTotal: number;
    total: number;
    // The per-night series behind nightsSubtotal. Computed here so the one place
    // that owns the arithmetic is also the one place that can be snapshotted:
    // the checkout route freezes this onto the booking exactly as it freezes the
    // cleaning fee and commission, and every later view reads the snapshot
    // rather than recomputing against a calendar the host may have changed.
    nightly: NightRate[];
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
    return nightlyRateDetail(date, listing, overrides).rate;
}

// The same decision as nightlyRate, but keeping the reason. nightlyRate is left
// as the thin wrapper so every existing caller is unchanged and the two can
// never disagree about the number.
export function nightlyRateDetail(
    date: Date,
    listing: PricingListing,
    overrides: Record<string, number>
): { rate: number; kind: NightRate['kind'] } {
    const key = dateKey(date);
    // Tested for presence, not truthiness: an override of 0 is a free night
    // somebody set deliberately, and `if (overrides[key])` silently charged
    // them the standard rate instead.
    const override = overrides ? overrides[key] : undefined;
    if (override !== undefined && override !== null && !isNaN(Number(override))) {
        return { rate: Number(override), kind: 'override' };
    }

    const day = date.getDay(); // 5 = Friday, 6 = Saturday
    if ((day === 5 || day === 6) && listing.weekend_price) {
        return { rate: Number(listing.weekend_price), kind: 'weekend' };
    }

    return { rate: Number(listing.price_per_night || 0), kind: 'base' };
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
            nightly: [],
        };
    }

    let nightsSubtotal = 0;
    const nightly: NightRate[] = [];
    const cursor = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
    for (let i = 0; i < nights; i++) {
        const detail = nightlyRateDetail(cursor, listing, overrides);
        nightsSubtotal += detail.rate;
        nightly.push({ date: dateKey(cursor), rate: money(detail.rate), kind: detail.kind });
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
        nightly: nightly,
    };
}

// Two totals agree if they round to the same penny.
export function totalsMatch(a: number, b: number): boolean {
    return Math.abs(money(a) - money(b)) < 0.005;
}

// ---------------------------------------------------------------------------
// What a service job is quoted at, and what the commission comes off.
//
// Here rather than in lib/serviceProviders.ts because this is a total, and a
// total is worked out in one place. serviceProviders holds the vocabulary —
// which extras exist and what type each is — and this holds the arithmetic.
//
// The ceiling is the band price plus the priced extras. It is a ceiling in the
// real sense: a provider may charge less on the day, never more, and the 10%
// comes off this figure.
//
// Reimbursed extras are absent by construction, not by subtraction. The
// provider spends the host's money on consumables or a welcome gift and is
// paid back directly against a receipt — it never touches Stripe, it is not
// revenue for anybody, and no number for it exists when the quote is given.
// Only 'priced' is summed below, so there is no branch that could let one
// through. tests/service-extras.test.ts asserts that both behaviourally and by
// reading this file.
// ---------------------------------------------------------------------------

export interface ServiceCeilingInput {
    bandPrice?: any;
    // Keyed by extra key. `quantity` matters only for per-unit extras, and is
    // what the host says when they ask — bedding is a fact about the booking,
    // not about the property.
    extras?: Record<string, { offered?: boolean; price?: any; quantity?: any }> | null;
}

export function serviceCeiling(
    input: ServiceCeilingInput,
    catalogue: Array<{ key: string; type: string; unit?: string }>
): number {
    let total = Number(input.bandPrice) > 0 ? Number(input.bandPrice) : 0;

    const chosen = input.extras || {};

    for (const extra of catalogue) {
        if (extra.type !== 'priced') continue;

        const entry = chosen[extra.key];
        if (!entry || entry.offered !== true) continue;

        const price = Number(entry.price);
        if (!(price > 0)) continue;

        if (extra.unit === 'each') {
            const quantity = Math.floor(Number(entry.quantity));
            if (!(quantity > 0)) continue;
            total += price * quantity;
        } else {
            total += price;
        }
    }

    return money(total);
}

// The commission, off the ceiling. Rounded once, at the end, so it can never
// disagree with what was quoted by a penny.
// What an hourly cleaning visit comes to.
//
// THIS IS THE ONLY PLACE A RATE IS MULTIPLIED BY A DURATION, and it is here
// rather than in lib/serviceProviders.ts for two reasons that agree. The house
// rule says this file is the only place a total is calculated. And the
// structural guard in tests/service-pricing.test.ts scans serviceProviders.ts
// for any line mentioning hours that also multiplies or divides — putting this
// there would either trip that guard or tempt somebody to word around it, and
// the guard is what keeps `typical_hours` out of every total.
//
// It takes `billable_hourly_rate`, never `hourly_rate` (display only, the
// maintenance trades) and never `typical_hours` (a guide shown to the host).
//
// Nothing calls this yet: there is no service booking to total up. It is here
// so that the day there is one, the arithmetic is in the file that owns
// arithmetic rather than invented at the call site.
export function hourlyVisitTotal(
    billableHourlyRate: number | string | null | undefined,
    hoursWorked: number | string | null | undefined
): number {
    const rate = Number(billableHourlyRate);
    const worked = Number(hoursWorked);

    if (!(rate > 0) || !(worked > 0)) return 0;

    return money(rate * worked);
}

export function serviceCommission(ceiling: number, rate: number): number {
    const amount = Number(ceiling) * Number(rate);
    return money(amount > 0 ? amount : 0);
}
