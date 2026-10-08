// The one place a booking total is worked out.
//
// The booking widget uses this to show the guest a price, and the checkout
// route uses it to recalculate that price from the listing before charging
// anything. Because both call the same code, the two can never drift apart —
// and a total posted from the browser can never be taken on trust.

import type { QuoteExtra, ExtraUnit, ExtraVat } from './listingExtras';

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
    // The four discount switches a host toggles on the listing. On/off only —
    // the percentages and the windows are fixed (see DISCOUNTS below), exactly
    // the figures the listing editor advertises beside each switch.
    new_listing_promo?: boolean | null;
    last_minute_discount?: boolean | null;
    weekly_discount?: boolean | null;
    monthly_discount?: boolean | null;
}

// The discount figures and thresholds. The host sets only the on/off switch,
// so the percentages and the windows live here as the one source the price,
// the booking card and the editor copy all read, the way Airbnb fixes them
// rather than letting the host type a number.
//
//   new listing  20%  — a listing's first 3 bookings
//   last minute   5%  — booked 14 days or fewer before check-in
//   weekly       10%  — stays of 7 nights or more
//   monthly      20%  — stays of 28 nights or more
//
// Airbnb applies ONE discount per booking (help.airbnb "How discounts are
// applied": new-listing, length-of-stay and last-minute may not be combined).
// Of weekly and monthly only one — the larger — ever applies, and that single
// length-of-stay discount then competes with the others; the one that saves
// the guest the most wins. chooseDiscount() below is that rule.
export type DiscountKind = 'new_listing' | 'last_minute' | 'weekly' | 'monthly';

export const DISCOUNTS: Record<DiscountKind, { percent: number; label: string }> = {
    new_listing: { percent: 20, label: 'New listing discount' },
    last_minute: { percent: 5, label: 'Last-minute discount' },
    weekly: { percent: 10, label: 'Weekly discount' },
    monthly: { percent: 20, label: 'Monthly discount' },
};

export const LAST_MINUTE_DAYS = 14;
export const WEEKLY_MIN_NIGHTS = 7;
export const MONTHLY_MIN_NIGHTS = 28;
export const NEW_LISTING_MAX_BOOKINGS = 3;

// The discount applied to a stay: which one, its rate, and the money it takes
// off the nightly subtotal (fees are never discounted, as on Airbnb).
export interface AppliedDiscount {
    kind: DiscountKind;
    label: string;
    percent: number;
    amount: number;
}

// What the caller knows that a quote cannot work out for itself: whether the
// new-listing promo still applies (it depends on the listing's booking history,
// which the checkout route and the listing page read and pass in), and the
// date the booking is being made (for the last-minute window). asOf defaults to
// now, so the booking card and the checkout agree on "if you booked today".
export interface DiscountContext {
    newListingEligible?: boolean;
    asOf?: Date;
}

// One night, priced, with the reason it cost what it did. `kind` is what a
// guest reads to see why a night was dearer — the weekend rate, or a date the
// host priced by hand — rather than taking the subtotal on trust.
export interface NightRate {
    date: string; // yyyy-mm-dd
    rate: number;
    kind: 'base' | 'weekend' | 'override';
}

// One host-sold extra, priced. unitPrice and vat_treatment are the catalogue's,
// frozen here the way a night's rate is: the checkout route snapshots this array
// onto the booking (extras_breakdown) so the receipt and the VAT split read what
// was actually charged, never the host's catalogue as it stands later.
export interface ExtraLine {
    id: string;
    label: string;
    unit: ExtraUnit;
    unitPrice: number;
    qty: number;
    // How many units were multiplied: the night count for a per-night extra, 1
    // for a per-stay one. Kept so the breakdown can say "£20 × 3 nights".
    units: number;
    lineTotal: number;
    vat_treatment: ExtraVat;
}

export interface PriceQuote {
    nights: number;
    nightsSubtotal: number;
    extraGuestTotal: number;
    petFeeTotal: number;
    cleaningFeeTotal: number;
    // Host-sold optional extras. extrasTotal is already inside `total`; `extras`
    // is the per-line series behind it, for the breakdown and the snapshot. An
    // extra is never discounted and never commissioned (the host's own supply).
    extrasTotal: number;
    extras: ExtraLine[];
    // The one discount that applies, or null. The money off is in `amount`, and
    // it has already been taken out of `total` below — a reader adds the lines
    // and subtracts this, exactly as the breakdown shows them.
    discount: AppliedDiscount | null;
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

// Which single discount a stay earns, or null. The whole Airbnb rule in one
// pure place: only one discount per booking, the largest; and of weekly and
// monthly only the larger. Kept separate from quoteBooking so it can be read
// and tested on its own, and so the one decision is made in one spot.
//
// daysUntilCheckIn is calendar days from the booking date to check-in; null
// when it is not known (then last-minute simply can't apply). nightsSubtotal is
// the gross nightly total the percentage comes off — fees are never discounted.
export function chooseDiscount(
    listing: PricingListing,
    nights: number,
    nightsSubtotal: number,
    ctx: { newListingEligible: boolean; daysUntilCheckIn: number | null }
): AppliedDiscount | null {
    if (!(nights > 0) || !(nightsSubtotal > 0)) return null;

    // priority breaks a tie on percent so the chosen label is deterministic:
    // length-of-stay first, then new-listing, then last-minute.
    const candidates: { kind: DiscountKind; percent: number; priority: number }[] = [];

    // Length-of-stay: weekly at 7+ nights, monthly at 28+. Only one applies —
    // the larger of the two the stay qualifies for.
    const lengthOfStay: { kind: DiscountKind; percent: number; priority: number }[] = [];
    if (listing.weekly_discount && nights >= WEEKLY_MIN_NIGHTS) {
        lengthOfStay.push({ kind: 'weekly', percent: DISCOUNTS.weekly.percent, priority: 0 });
    }
    if (listing.monthly_discount && nights >= MONTHLY_MIN_NIGHTS) {
        lengthOfStay.push({ kind: 'monthly', percent: DISCOUNTS.monthly.percent, priority: 0 });
    }
    if (lengthOfStay.length) {
        lengthOfStay.sort((a, b) => b.percent - a.percent);
        candidates.push(lengthOfStay[0]);
    }

    // New-listing promo: the listing's first 3 bookings, decided by the caller
    // from the booking history. The quote never guesses at it.
    if (listing.new_listing_promo && ctx.newListingEligible) {
        candidates.push({ kind: 'new_listing', percent: DISCOUNTS.new_listing.percent, priority: 1 });
    }

    // Last-minute: booked within the window before check-in.
    if (
        listing.last_minute_discount &&
        ctx.daysUntilCheckIn !== null &&
        ctx.daysUntilCheckIn >= 0 &&
        ctx.daysUntilCheckIn <= LAST_MINUTE_DAYS
    ) {
        candidates.push({ kind: 'last_minute', percent: DISCOUNTS.last_minute.percent, priority: 2 });
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => (b.percent - a.percent) || (a.priority - b.priority));
    const chosen = candidates[0];
    return {
        kind: chosen.kind,
        label: DISCOUNTS[chosen.kind].label,
        percent: chosen.percent,
        amount: money(nightsSubtotal * (chosen.percent / 100)),
    };
}

// The full breakdown for a stay. Guest counts follow the widget: the first
// guest is included, every additional adult or child carries the extra guest
// fee for each night, pets are charged once, and cleaning is charged once.
// opts carries the two things a quote can't know on its own — new-listing
// eligibility and the booking date (see DiscountContext).
export function quoteBooking(
    listing: PricingListing,
    overrides: Record<string, number>,
    checkIn: Date,
    checkOut: Date,
    adults: number,
    children: number,
    pets: number,
    opts?: DiscountContext,
    extras?: QuoteExtra[]
): PriceQuote {
    const nights = nightsBetween(checkIn, checkOut);

    if (nights <= 0) {
        return {
            nights: 0,
            nightsSubtotal: 0,
            extraGuestTotal: 0,
            petFeeTotal: 0,
            cleaningFeeTotal: 0,
            extrasTotal: 0,
            extras: [],
            discount: null,
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

    // The discount comes off the nightly subtotal only (fees are never
    // discounted, as on Airbnb). daysUntilCheckIn is from the booking date,
    // which defaults to now so the card and the checkout agree.
    const asOf = (opts && opts.asOf) || new Date();
    const daysUntilCheckIn = nightsBetween(asOf, checkIn);
    const discount = chooseDiscount(listing, nights, money(nightsSubtotal), {
        newListingEligible: !!(opts && opts.newListingEligible),
        daysUntilCheckIn,
    });
    const discountAmount = discount ? discount.amount : 0;

    // Host-sold extras. A per-stay extra is charged once; a per-night extra once
    // for each night of the stay. Priced from the catalogue's unit price (passed
    // in already resolved against the live catalogue — never the browser's
    // figure), never discounted, and summed into the total after the discount so
    // a weekly discount can't quietly come off a sauna pack. Each line also
    // carries its VAT treatment, frozen for the receipt.
    const extraLines: ExtraLine[] = [];
    let extrasTotal = 0;
    for (const e of extras || []) {
        if (!e) continue;
        const qty = Math.floor(Number(e.qty) || 0);
        const unitPrice = Number(e.unitPrice) || 0;
        if (!(qty > 0) || !(unitPrice > 0)) continue;
        const units = e.unit === 'night' ? nights : 1;
        const lineTotal = money(unitPrice * qty * units);
        extraLines.push({
            id: String(e.id),
            label: String(e.label),
            unit: e.unit === 'night' ? 'night' : 'stay',
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
        nights: nights,
        nightsSubtotal: money(nightsSubtotal),
        extraGuestTotal: money(extraGuestTotal),
        petFeeTotal: money(petFeeTotal),
        cleaningFeeTotal: money(cleaningFeeTotal),
        extrasTotal: extrasTotal,
        extras: extraLines,
        discount: discount,
        total: money(nightsSubtotal - discountAmount + extraGuestTotal + petFeeTotal + cleaningFeeTotal + extrasTotal),
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
