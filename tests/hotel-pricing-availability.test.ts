// The two hotel divergences from the cottage money path, unit-tested: room-type
// pricing (returns the cottage PriceQuote shape) and counting availability
// (rooms sold < rooms available per night, not the single-unit constraint).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { quoteHotelStay } = require('../lib/hotelPricing');
const { peakRoomsHeld, nightsOf, HOLD_MINUTES } = require('../lib/hotelAvailability');

test('a room-type quote is nights × rate × rooms, in the PriceQuote shape', () => {
    const q = quoteHotelStay({ price_per_night: 95 }, '2026-12-01', '2026-12-04', 1);
    assert.equal(q.nights, 3);
    assert.equal(q.nightsSubtotal, 285);
    assert.equal(q.total, 285);
    assert.equal(q.nightly.length, 3);
    assert.deepEqual(q.nightly[0], { date: '2026-12-01', rate: 95, kind: 'base' });
    // Cottage-only lines are zero in phase one.
    assert.equal(q.cleaningFeeTotal, 0);
    assert.equal(q.petFeeTotal, 0);
    assert.equal(q.extrasTotal, 0);
    assert.equal(q.discount, null);
});

test('more than one room multiplies the rate', () => {
    const q = quoteHotelStay({ price_per_night: 100 }, '2026-12-01', '2026-12-03', 2);
    assert.equal(q.total, 400); // 2 nights × £100 × 2 rooms
    assert.equal(q.nightly[0].rate, 200);
});

test('nightsOf is half-open [in, out) — the checkout morning is not a night', () => {
    assert.deepEqual(nightsOf('2026-12-01', '2026-12-04'), ['2026-12-01', '2026-12-02', '2026-12-03']);
    assert.deepEqual(nightsOf('2026-12-01', '2026-12-01'), []);
});

test('peakRoomsHeld counts the tightest night, confirmed + pending always', () => {
    const bookings = [
        { check_in: '2026-12-01', check_out: '2026-12-03', rooms_booked: 1, status: 'confirmed' },
        { check_in: '2026-12-02', check_out: '2026-12-05', rooms_booked: 1, status: 'pending' },
        // A different, non-overlapping stay — must not count.
        { check_in: '2026-12-10', check_out: '2026-12-12', rooms_booked: 1, status: 'confirmed' },
    ];
    // Nights 01,02,03: night 02 is held by both -> peak 2.
    assert.equal(peakRoomsHeld(bookings, '2026-12-01', '2026-12-04'), 2);
    // Night 03 only (the second booking) -> 1.
    assert.equal(peakRoomsHeld(bookings, '2026-12-03', '2026-12-04'), 1);
});

test('a half-open touch does not overlap (checkout == next check-in)', () => {
    const bookings = [{ check_in: '2026-12-01', check_out: '2026-12-03', rooms_booked: 1, status: 'confirmed' }];
    // A stay starting 03 shares no night with one ending 03.
    assert.equal(peakRoomsHeld(bookings, '2026-12-03', '2026-12-05'), 0);
});

test('a pending_payment hold counts only while it is live (30 min)', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const fresh = { check_in: '2026-12-01', check_out: '2026-12-02', rooms_booked: 1, status: 'pending_payment', created_at: '2026-11-04T11:50:00Z' };
    const stale = { check_in: '2026-12-01', check_out: '2026-12-02', rooms_booked: 1, status: 'pending_payment', created_at: '2026-11-04T11:00:00Z' };
    assert.equal(peakRoomsHeld([fresh], '2026-12-01', '2026-12-02', now), 1, 'a fresh hold counts');
    assert.equal(peakRoomsHeld([stale], '2026-12-01', '2026-12-02', now), 0, 'an expired hold does not');
    assert.equal(HOLD_MINUTES, 30);
});

test('cancelled / declined never block', () => {
    const bookings = [
        { check_in: '2026-12-01', check_out: '2026-12-02', rooms_booked: 2, status: 'cancelled' },
        { check_in: '2026-12-01', check_out: '2026-12-02', rooms_booked: 1, status: 'declined' },
    ];
    assert.equal(peakRoomsHeld(bookings, '2026-12-01', '2026-12-02'), 0);
});
