// The per-night snapshot, and the one guarantee it exists to make.
//
// A booking stores only its total. quoteBooking works the per-night split out
// every time from the listing and the calendar — and the calendar is the
// host's to change after the booking is made. So a breakdown recomputed later
// can show a guest different nightly prices than the ones they were charged.
//
// The fix is to freeze the series at checkout, beside the cleaning fee and the
// commission, and render THAT — never a recompute. This test holds the two
// halves of that promise:
//
//   1. quoteBooking returns the series it charges on, each night tagged with
//      why it cost what it did.
//   2. once that series is captured (as the checkout route captures it onto the
//      booking), a later change to the calendar moves a fresh quote but leaves
//      the captured snapshot — and the total it accounts for — untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quoteBooking, dateFromKey } from '../lib/pricing';

const d = (s: string) => dateFromKey(s);

// September 2026: the 11th is a Friday and the 12th a Saturday, so a stay from
// Thu 10th to Mon 14th is four nights — base, weekend, weekend, base — and the
// override lands on the last of them.
const LISTING = { price_per_night: 100, weekend_price: 150, cleaning_fee: 40 };
const CHECK_IN = d('2026-09-10');
const CHECK_OUT = d('2026-09-14');

test('quoteBooking returns a per-night series tagged with why each night cost what it did', () => {
    const overrides = { '2026-09-13': 200 }; // host priced the Sunday by hand
    const q = quoteBooking(LISTING, overrides, CHECK_IN, CHECK_OUT, 2, 0, 0);

    assert.equal(q.nights, 4);
    assert.deepEqual(q.nightly, [
        { date: '2026-09-10', rate: 100, kind: 'base' },
        { date: '2026-09-11', rate: 150, kind: 'weekend' },
        { date: '2026-09-12', rate: 150, kind: 'weekend' },
        { date: '2026-09-13', rate: 200, kind: 'override' },
    ]);

    // The series is the subtotal, not a decoration beside it.
    const sum = q.nightly.reduce((t, n) => t + n.rate, 0);
    assert.equal(sum, q.nightsSubtotal);
    assert.equal(q.nightsSubtotal, 600);
});

test('an empty stay has an empty series, not a phantom night', () => {
    const q = quoteBooking(LISTING, {}, d('2026-09-10'), d('2026-09-10'), 2, 0, 0);
    assert.equal(q.nights, 0);
    assert.deepEqual(q.nightly, []);
});

test('changing the calendar after checkout moves a fresh quote but not the frozen snapshot', () => {
    // At checkout: quote, and capture the series exactly as the route stamps it
    // onto the booking. A deep copy, because this is what is written to the row
    // — nothing that happens later is allowed to reach back and change it.
    const atCheckout = quoteBooking(LISTING, { '2026-09-13': 200 }, CHECK_IN, CHECK_OUT, 2, 0, 0);
    const stampedNightly = JSON.parse(JSON.stringify(atCheckout.nightly));
    const charged = atCheckout.total;

    // Later, the host edits that night's override upward.
    const afterEdit = quoteBooking(LISTING, { '2026-09-13': 300 }, CHECK_IN, CHECK_OUT, 2, 0, 0);

    // A recompute HAS drifted — this is the whole hazard, proven present.
    assert.notEqual(afterEdit.total, charged);
    assert.equal(afterEdit.nightsSubtotal, 700);

    // The stored snapshot is unmoved, and still accounts for exactly what the
    // guest was charged. Rendering it (as the trip card does) shows the price
    // paid, not the price the calendar would give today.
    assert.deepEqual(stampedNightly, [
        { date: '2026-09-10', rate: 100, kind: 'base' },
        { date: '2026-09-11', rate: 150, kind: 'weekend' },
        { date: '2026-09-12', rate: 150, kind: 'weekend' },
        { date: '2026-09-13', rate: 200, kind: 'override' },
    ]);
    const snapshotSubtotal = stampedNightly.reduce((t: number, n: any) => t + n.rate, 0);
    assert.equal(snapshotSubtotal + LISTING.cleaning_fee, charged);
});
