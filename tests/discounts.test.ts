// Stay discounts (lib/pricing: chooseDiscount + quoteBooking).
//
// Airbnb's rule, which these hold to:
//   * new listing 20% on the first 3 bookings, last-minute 5% within 14 days,
//     weekly 10% at 7+ nights, monthly 20% at 28+ nights;
//   * of weekly and monthly only one applies — the larger;
//   * only ONE discount applies per booking — the one that saves the guest the
//     most; a tie falls to length-of-stay, then new-listing, then last-minute;
//   * the discount comes off the nightly subtotal only, never the fees;
//   * the 10% commission is worked out on the discounted total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteBooking, chooseDiscount, dateFromKey, DISCOUNTS } from '../lib/pricing';
import { feeAmount, netOfFee, DEFAULT_COMMISSION_PERCENT } from '../lib/fees';

const d = dateFromKey;
// £100/night flat, no weekend rate, no fees — so nightsSubtotal is just 100×n.
const base = { price_per_night: 100 } as const;

// ---------------------------------------------------------------- eligibility

test('weekly: 10% at 7 nights, nothing at 6', () => {
    const on = { ...base, weekly_discount: true };
    assert.equal(chooseDiscount(on, 7, 700, { newListingEligible: false, daysUntilCheckIn: null })?.kind, 'weekly');
    assert.equal(chooseDiscount(on, 6, 600, { newListingEligible: false, daysUntilCheckIn: null }), null);
});

test('monthly: 20% at 28 nights, nothing at 27', () => {
    const on = { ...base, monthly_discount: true };
    assert.equal(chooseDiscount(on, 28, 2800, { newListingEligible: false, daysUntilCheckIn: null })?.kind, 'monthly');
    assert.equal(chooseDiscount(on, 27, 2700, { newListingEligible: false, daysUntilCheckIn: null }), null);
});

test('of weekly and monthly only the larger applies on a long stay', () => {
    const both = { ...base, weekly_discount: true, monthly_discount: true };
    // 28 nights qualifies for both; monthly (20%) beats weekly (10%).
    const picked = chooseDiscount(both, 28, 2800, { newListingEligible: false, daysUntilCheckIn: null });
    assert.equal(picked?.kind, 'monthly');
    assert.equal(picked?.percent, 20);
    // 10 nights qualifies for weekly only.
    assert.equal(chooseDiscount(both, 10, 1000, { newListingEligible: false, daysUntilCheckIn: null })?.kind, 'weekly');
});

test('new-listing applies only when the caller says it is eligible', () => {
    const on = { ...base, new_listing_promo: true };
    assert.equal(chooseDiscount(on, 3, 300, { newListingEligible: true, daysUntilCheckIn: null })?.kind, 'new_listing');
    assert.equal(chooseDiscount(on, 3, 300, { newListingEligible: false, daysUntilCheckIn: null }), null);
});

test('last-minute applies within 14 days, not at 15, and never when the date is unknown', () => {
    const on = { ...base, last_minute_discount: true };
    assert.equal(chooseDiscount(on, 2, 200, { newListingEligible: false, daysUntilCheckIn: 14 })?.kind, 'last_minute');
    assert.equal(chooseDiscount(on, 2, 200, { newListingEligible: false, daysUntilCheckIn: 0 })?.kind, 'last_minute');
    assert.equal(chooseDiscount(on, 2, 200, { newListingEligible: false, daysUntilCheckIn: 15 }), null);
    assert.equal(chooseDiscount(on, 2, 200, { newListingEligible: false, daysUntilCheckIn: null }), null);
});

// ------------------------------------------------------------- only one wins

test('only one discount applies — the largest saves the guest the most', () => {
    // new-listing 20% vs weekly 10% on a 7-night eligible stay → new-listing.
    const l = { ...base, new_listing_promo: true, weekly_discount: true };
    const picked = chooseDiscount(l, 7, 700, { newListingEligible: true, daysUntilCheckIn: null });
    assert.equal(picked?.kind, 'new_listing');
    assert.equal(picked?.percent, 20);
});

test('a tie on percent falls to length-of-stay for a deterministic label', () => {
    // monthly 20% ties new-listing 20% at 28 eligible nights → monthly wins the label.
    const l = { ...base, new_listing_promo: true, monthly_discount: true };
    const picked = chooseDiscount(l, 28, 2800, { newListingEligible: true, daysUntilCheckIn: 3 });
    assert.equal(picked?.kind, 'monthly');
});

// ----------------------------------------------------- quoteBooking wiring

test('the discount comes off the nightly subtotal only; fees are untouched', () => {
    const l = {
        price_per_night: 100, cleaning_fee: 50, pet_fee: 25,
        extra_guest_fee: 20, extra_guest_after: 1, extra_guest_period: 'stay',
        weekly_discount: true,
    };
    // 7 nights, 2 guests (1 extra, once), 1 pet.
    const q = quoteBooking(l, {}, d('2026-09-07'), d('2026-09-14'), 2, 0, 1, { asOf: d('2026-09-01') });
    assert.equal(q.nightsSubtotal, 700);
    assert.equal(q.discount?.kind, 'weekly');
    assert.equal(q.discount?.amount, 70);            // 10% of 700, not of the fees
    assert.equal(q.extraGuestTotal, 20);
    assert.equal(q.petFeeTotal, 25);
    assert.equal(q.cleaningFeeTotal, 50);
    // 700 − 70 + 20 + 25 + 50
    assert.equal(q.total, 725);
});

test('no discount flags means no discount and the total is unchanged', () => {
    const q = quoteBooking({ price_per_night: 100, cleaning_fee: 50 }, {}, d('2026-09-07'), d('2026-09-14'), 1, 0, 0);
    assert.equal(q.discount, null);
    assert.equal(q.total, 750); // 700 + 50, exactly as before discounts existed
});

test('the 10% commission is worked out on the discounted total', () => {
    const l = { price_per_night: 100, monthly_discount: true };
    const q = quoteBooking(l, {}, d('2026-09-01'), d('2026-09-29'), 1, 0, 0, { asOf: d('2026-08-01') });
    assert.equal(q.nightsSubtotal, 2800);
    assert.equal(q.discount?.kind, 'monthly');
    assert.equal(q.total, 2240); // 2800 − 20%
    // Commission nets off the discounted figure, never the headline 2800.
    assert.equal(feeAmount(q.total, DEFAULT_COMMISSION_PERCENT), 224);
    assert.equal(netOfFee(q.total, DEFAULT_COMMISSION_PERCENT), 2016);
});

test('DISCOUNTS carries the advertised rates', () => {
    assert.equal(DISCOUNTS.new_listing.percent, 20);
    assert.equal(DISCOUNTS.last_minute.percent, 5);
    assert.equal(DISCOUNTS.weekly.percent, 10);
    assert.equal(DISCOUNTS.monthly.percent, 20);
});
