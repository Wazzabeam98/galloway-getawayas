// The slot shape's rules, with no database and no clock — a wrong number here is
// wrong whatever the route does with it. The one thing not tested here is the
// seat claim itself, which is an atomic UPDATE in the route (only the database
// can make check-and-take indivisible); its arithmetic — capacity and
// seats-left — is here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import {
    SHAPES, shapeOf, isSlot, isExclusiveShape, shapeCue,
    generateSessions, sessionCapacity, seatsLeft,
    freeCancelDeadline, guestMayCancelFree, SLOT_HOLD_MINUTES,
} from '@/lib/serviceSlots';
import { exclusivePerDate } from '@/lib/serviceOrders';

test('shape resolves, and anything unknown is the safe request default', () => {
    assert.deepEqual(SHAPES, ['made_to_order', 'comes_to_you', 'slot']);
    assert.equal(shapeOf({ shape: 'slot' }), 'slot');
    assert.equal(shapeOf({ shape: 'comes_to_you' }), 'comes_to_you');
    assert.equal(shapeOf({ shape: 'nonsense' }), 'made_to_order');
    assert.equal(shapeOf({}), 'made_to_order');
    assert.equal(shapeOf(null), 'made_to_order');
});

test('only a slot is instant; only comes_to_you holds the date', () => {
    assert.equal(isSlot({ shape: 'slot' }), true);
    assert.equal(isSlot({ shape: 'made_to_order' }), false);
    assert.equal(isExclusiveShape({ shape: 'comes_to_you' }), true);
    assert.equal(isExclusiveShape({ shape: 'slot' }), false);
    assert.equal(isExclusiveShape({ shape: 'made_to_order' }), false);
});

test('exclusivePerDate now reads shape as the source of truth', () => {
    // A comes_to_you provider is exclusive whether or not the old flag was set.
    assert.equal(exclusivePerDate({ shape: 'comes_to_you' }), true);
    assert.equal(exclusivePerDate({ shape: 'comes_to_you', exclusive_per_date: false }), true);
    // A slot or a maker is not — a sauna's contention is capacity, not the date.
    assert.equal(exclusivePerDate({ shape: 'slot' }), false);
    assert.equal(exclusivePerDate({ shape: 'made_to_order' }), false);
    // A pre-shape row still resolves off the flag alone.
    assert.equal(exclusivePerDate({ exclusive_per_date: true }), true);
    assert.equal(exclusivePerDate({}), false);
});

test('each shape has its own guest-facing cue', () => {
    assert.equal(shapeCue('made_to_order'), 'Made for your dates');
    assert.equal(shapeCue('comes_to_you'), 'Comes to your cottage');
    assert.equal(shapeCue('slot'), 'Book a time');
});

// --- generating sessions from the weekly template ----------------------------

test('sessions step by length within opening hours', () => {
    const avail = [{ day_of_week: 0, open_time: '14:00', close_time: '16:00' }]; // Sunday
    // 2026-09-20 is a Sunday. 14:00 (→15:00) and 15:00 (→16:00) fit; 16:00 would end at 17:00 and does not.
    const s = generateSessions(avail, [], 60, '2026-09-20', '2026-09-20');
    assert.deepEqual(s, [{ date: '2026-09-20', time: '14:00' }, { date: '2026-09-20', time: '15:00' }]);
});

test('a blocked day drops its whole set, and the range is inclusive', () => {
    // Open every weekday for two morning slots, so the weekday maths can't skew it.
    const avail = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '11:00' }));
    const all = generateSessions(avail, [], 60, '2026-09-19', '2026-09-21'); // 3 days × 2 slots
    assert.equal(all.length, 6);
    const blocked = generateSessions(avail, ['2026-09-20'], 60, '2026-09-19', '2026-09-21');
    assert.equal(blocked.length, 4, 'the blocked day is gone');
    assert.ok(!blocked.some((x) => x.date === '2026-09-20'), 'nothing survives on the blocked day');
    assert.deepEqual(blocked[0], { date: '2026-09-19', time: '09:00' }, 'ordered by date then time');
});

test('no availability means no sessions, not an error', () => {
    assert.deepEqual(generateSessions([], [], 60, '2026-09-19', '2026-09-21'), []);
});

// --- capacity ---------------------------------------------------------------

test('a whole-slot price is one booking; a per-person price is the provider count', () => {
    assert.equal(sessionCapacity({ slot_capacity: 8 }, 'flat'), 1, 'a private hour is one booking');
    assert.equal(sessionCapacity({ slot_capacity: 8 }, 'person'), 8, 'a walk holds the set number of people');
    assert.equal(sessionCapacity({ slot_capacity: null }, 'person'), 1, 'a missing count is a safe one');
    assert.equal(sessionCapacity({}, 'person'), 1);
});

test('seats left never goes negative', () => {
    assert.equal(seatsLeft({ capacity: 6, seats_taken: 4 }), 2);
    assert.equal(seatsLeft({ capacity: 6, seats_taken: 6 }), 0);
    assert.equal(seatsLeft({ capacity: 6, seats_taken: 9 }), 0, 'over-full reads as full, not as -3');
});

// --- cancellation, shape-aware ----------------------------------------------

test('a slot counts the window from the session TIME', () => {
    // 4 hours before a 15:00 session on 2026-09-20 is 11:00 the same day.
    const deadline = freeCancelDeadline('slot', '2026-09-20', '15:00', 4);
    assert.equal(deadline.toISOString(), '2026-09-20T11:00:00.000Z');
    assert.equal(guestMayCancelFree('slot', '2026-09-20', '15:00', 4, new Date('2026-09-20T10:59:00Z')), true);
    assert.equal(guestMayCancelFree('slot', '2026-09-20', '15:00', 4, new Date('2026-09-20T11:01:00Z')), false,
        'past the cutoff the seat is perishable and it is the provider’s call');
});

test('a request shape counts the window in days from the start of the date', () => {
    // 72 hours (three days) before 2026-09-20 is 2026-09-17T00:00Z. Time is ignored.
    const deadline = freeCancelDeadline('made_to_order', '2026-09-20', null, 72);
    assert.equal(deadline.toISOString(), '2026-09-17T00:00:00.000Z');
    assert.equal(guestMayCancelFree('made_to_order', '2026-09-20', null, 72, new Date('2026-09-16T23:00:00Z')), true);
    assert.equal(guestMayCancelFree('made_to_order', '2026-09-20', null, 72, new Date('2026-09-18T00:00:00Z')), false);
});

test('an unreadable date is never a free cancel', () => {
    assert.equal(guestMayCancelFree('slot', 'not-a-date', '15:00', 4, new Date('2026-09-20T00:00:00Z')), false);
});

test('the seat hold lives as long as Stripe’s Checkout floor (30 min)', () => {
    // Stripe won't expire a Checkout Session in under 30 minutes, and the hold
    // must expire with it, so the hold is 30 — not the 15 first sketched.
    assert.equal(SLOT_HOLD_MINUTES, 30);
});
