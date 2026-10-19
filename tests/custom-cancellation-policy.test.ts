// The Custom cancellation policy and the non-refundable rate — the new money
// rules, tested as pure functions the way refund-due / money already are.
//
//   * Custom = full refund more than X days before check-in, nothing within X.
//     No 50% band (unlike Limited/Firm).
//   * The X is a whole number 1–365, enforced by ONE shared validator
//     (cancelDaysProblem) the editor and /api/listings/save both call.
//   * A non-refundable booking returns nothing on a guest cancel — not even the
//     cleaning fee — but a host cancellation still returns everything.
//   * The non-refundable rate takes 10% off the nightly subtotal (after any
//     other discount), never off the fees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    refundDue, refundFraction, freeCancelUntilKey, policyOf, customDaysOf,
    cancelDaysProblem, CUSTOM_MIN_DAYS, CUSTOM_MAX_DAYS, DEFAULT_CUSTOM_DAYS,
} from '../lib/cancellation';
import { quoteBooking, NON_REFUNDABLE_DISCOUNT_PERCENT } from '../lib/pricing';

const d = (iso: string) => new Date(iso + 'T12:00:00');
const CHECK_IN = '2026-11-10';

/** A £400 stay with a £60 clean, paid in full, Custom/30, unless overridden. */
function input(overrides: any = {}) {
    return {
        amountPaid: 400,
        alreadyRefunded: 0,
        cleaningFee: 60,
        checkIn: CHECK_IN,
        policy: 'Custom',
        customDays: 30,
        ...overrides,
    };
}

// --------------------------------------------------------------------------
// The validator — the one rule, mirrored client and server
// --------------------------------------------------------------------------

test('cancelDaysProblem accepts a whole number in range and nothing else', () => {
    assert.equal(cancelDaysProblem(30), null);
    assert.equal(cancelDaysProblem('30'), null);
    assert.equal(cancelDaysProblem(CUSTOM_MIN_DAYS), null);
    assert.equal(cancelDaysProblem(CUSTOM_MAX_DAYS), null);

    assert.ok(cancelDaysProblem(''), 'empty is a problem');
    assert.ok(cancelDaysProblem(null), 'null is a problem');
    assert.ok(cancelDaysProblem(undefined), 'undefined is a problem');
    assert.ok(cancelDaysProblem(0), '0 is below the minimum');
    assert.ok(cancelDaysProblem(366), '366 is above the maximum');
    assert.ok(cancelDaysProblem(5.5), 'a fraction is not a whole number');
    assert.ok(cancelDaysProblem('abc'), 'not a number');
});

test('customDaysOf coerces to a whole number in range, falling back to the default', () => {
    assert.equal(customDaysOf(30), 30);
    assert.equal(customDaysOf('45'), 45);
    assert.equal(customDaysOf(0), DEFAULT_CUSTOM_DAYS);
    assert.equal(customDaysOf(400), DEFAULT_CUSTOM_DAYS);
    assert.equal(customDaysOf(null), DEFAULT_CUSTOM_DAYS);
    assert.equal(customDaysOf(undefined), DEFAULT_CUSTOM_DAYS);
    assert.equal(DEFAULT_CUSTOM_DAYS, 30);
});

test("'Custom' is a recognised policy", () => {
    assert.equal(policyOf('Custom'), 'Custom');
    assert.equal(policyOf('nonsense'), 'Moderate');
});

// --------------------------------------------------------------------------
// Custom refund maths — full before X, nothing within X, no 50% band
// --------------------------------------------------------------------------

test('Custom: full refund more than X days before check-in', () => {
    // 40 days out, Custom/30 → full
    assert.equal(refundFraction(CHECK_IN, 'Custom', d('2026-10-01'), 30), 1);
    // the £400 all comes back
    assert.equal(refundDue(input({ on: d('2026-10-01') })), 400);
});

test('Custom: on the cut-off day itself it is still full (inclusive)', () => {
    // exactly 30 days before 2026-11-10 is 2026-10-11
    assert.equal(refundFraction(CHECK_IN, 'Custom', d('2026-10-11'), 30), 1);
});

test('Custom: within X days, nothing on the stay but the cleaning fee still returns', () => {
    // 20 days out, inside the 30-day window → fraction 0
    assert.equal(refundFraction(CHECK_IN, 'Custom', d('2026-10-21'), 30), 0);
    // refundable tier: the clean still comes back whole, the rest does not
    assert.equal(refundDue(input({ on: d('2026-10-21') })), 60);
});

test('Custom: there is no 50% band — it is only ever full or the cleaning fee', () => {
    // sweep a range of "days before"; the stay share is never 0.5
    for (let i = 1; i <= 60; i++) {
        const on = new Date(d(CHECK_IN).getTime() - i * 86400000);
        const f = refundFraction(CHECK_IN, 'Custom', on, 30);
        assert.ok(f === 0 || f === 1, 'Custom fraction must be 0 or 1, got ' + f + ' at ' + i + ' days');
    }
});

test('freeCancelUntilKey for Custom is X days before check-in', () => {
    assert.equal(freeCancelUntilKey('2026-11-10', 'Custom', 30), '2026-10-11');
    assert.equal(freeCancelUntilKey('2026-11-10', 'Custom', 7), '2026-11-03');
});

// --------------------------------------------------------------------------
// Non-refundable — the guest's checkout choice
// --------------------------------------------------------------------------

test('non-refundable: a guest cancel returns nothing, not even the cleaning fee', () => {
    // well inside a full-refund window on the underlying tier, but non-refundable
    assert.equal(refundDue(input({ policy: 'Flexible', customDays: null, nonRefundable: true, on: d('2026-10-01') })), 0);
});

test('non-refundable: a host cancellation still returns everything', () => {
    assert.equal(
        refundDue(input({ nonRefundable: true, hostCancelling: true, on: d('2026-10-21') })),
        400,
    );
});

// --------------------------------------------------------------------------
// Non-refundable pricing — 10% off the nights, never the fees
// --------------------------------------------------------------------------

test('non-refundable rate takes 10% off the nightly subtotal only', () => {
    const listing = { price_per_night: 100, cleaning_fee: 50 };
    const base = quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 0, { nonRefundable: false });
    const nonRef = quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 0, { nonRefundable: true });

    // 3 nights @ £100 = £300 nights + £50 clean = £350
    assert.equal(base.total, 350);
    assert.equal(base.nonRefundableDiscount, 0);

    // 10% off the £300 of nights only = £30; the £50 clean is untouched
    assert.equal(nonRef.nonRefundableDiscount, 30);
    assert.equal(nonRef.total, 320);
    assert.equal(NON_REFUNDABLE_DISCOUNT_PERCENT, 10);
});

test('non-refundable discount comes off AFTER an ordinary discount', () => {
    // weekly discount (10%) on a 7-night stay, then non-refundable on top.
    const listing = { price_per_night: 100, cleaning_fee: 0, weekly_discount: true };
    const q = quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-14'), 2, 0, 0, { nonRefundable: true });
    // 7 nights @ £100 = £700; weekly 10% = £70 off → £630; non-refundable 10%
    // of £630 = £63.
    assert.equal(q.discount && q.discount.amount, 70);
    assert.equal(q.nonRefundableDiscount, 63);
    assert.equal(q.total, 700 - 70 - 63);
});
