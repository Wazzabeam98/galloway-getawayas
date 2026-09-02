// A stay that spans New Year.
//
// Pinned because a booking crossing 31 December → 1 January is the kind of edge
// nobody thinks to try until a guest books it: the night loop, the weekend-rate
// day-of-week check and nightsBetween all have to carry across a year change
// without dropping or doubling a night. There is no clock change between
// December and January in the UK, so a correct implementation simply works —
// which is exactly why an incorrect one would sit unnoticed. This keeps it
// covered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteBooking, dateFromKey } from '../lib/pricing';

const CHECK_IN = dateFromKey('2026-12-30');   // Wed
const CHECK_OUT = dateFromKey('2027-01-03');  // Sat — 4 nights: 30, 31, 1, 2

const BASE: any = {
    price_per_night: 100,
    cleaning_fee: 0,
    pet_fee: 0,
    extra_guest_fee: 0,
    extra_guest_after: 1,
};

test('a New Year stay counts four nights, not three or five', () => {
    const q = quoteBooking(BASE, {}, CHECK_IN, CHECK_OUT, 2, 0, 0);
    assert.equal(q.nights, 4);
    assert.equal(q.total, 400);
});

test('the weekend rate lands on the right nights across the year change', () => {
    // 2027-01-01 is a Friday and 2027-01-02 a Saturday, so a £150 weekend rate
    // applies to two of the four nights; 30 and 31 December are Wed/Thu at £100.
    const q = quoteBooking({ ...BASE, weekend_price: 150 }, {}, CHECK_IN, CHECK_OUT, 2, 0, 0);
    assert.equal(q.nights, 4);
    assert.equal(q.total, 100 + 100 + 150 + 150);
});

test('a calendar override on a night across the boundary is honoured', () => {
    // A blocked-out New Year's Eve priced up by hand.
    const q = quoteBooking(BASE, { '2026-12-31': 250 }, CHECK_IN, CHECK_OUT, 2, 0, 0);
    assert.equal(q.total, 100 + 250 + 100 + 100);
});
