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
    generateSessions, sessionCapacity, hasSlotCapacity, seatsLeft,
    freeCancelDeadline, guestMayCancelFree, SLOT_HOLD_MINUTES,
    bookingIsPrivate, slotClaimKind,
    slotOfferingFromUnits, offeringHasShared, offeringHasPrivate,
    optionAvailability, sessionClosedToAll,
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

// The predicate the booking route uses to refuse a misconfigured per-person item
// up front. (The real guard is the scenario suite, which drives the route; this
// pins the pure rule the route depends on.)
test('hasSlotCapacity is true only for a real, whole, positive count', () => {
    assert.equal(hasSlotCapacity({ slot_capacity: 8 }), true);
    assert.equal(hasSlotCapacity({ slot_capacity: 1 }), true);
    assert.equal(hasSlotCapacity({ slot_capacity: null }), false, 'null is no capacity');
    assert.equal(hasSlotCapacity({ slot_capacity: 0 }), false, 'zero seats is no capacity');
    assert.equal(hasSlotCapacity({ slot_capacity: -3 }), false, 'negative is no capacity');
    assert.equal(hasSlotCapacity({}), false, 'absent is no capacity');
    assert.equal(hasSlotCapacity(null), false);
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

// --- private hire vs shared table: the mode rules the booking route enforces ---

test('a flat price is a private hire; anything per-unit is a shared seat', () => {
    assert.equal(bookingIsPrivate('flat'), true, 'a whole-session price hires the room');
    assert.equal(bookingIsPrivate('person'), false, 'a per-person price is a seat');
    assert.equal(bookingIsPrivate(null), false, 'a missing unit is not a private hire');
});

test('an empty session — fresh or reopened — is established by the next booking', () => {
    // No row yet.
    assert.equal(slotClaimKind(null, true), 'establish');
    assert.equal(slotClaimKind(null, false), 'establish');
    // A row sitting at zero seats has NO effective mode, whatever its stale flag
    // says, so a cancellation that empties a private time reopens it as EITHER.
    assert.equal(slotClaimKind({ seats_taken: 0, private: true }, false), 'establish',
        'a cancelled private time can be re-established as a shared table');
    assert.equal(slotClaimKind({ seats_taken: 0, private: false }, true), 'establish',
        'a cancelled shared time can be re-established as a private hire');
});

test('a booking of the same mode joins the session', () => {
    assert.equal(slotClaimKind({ seats_taken: 2, private: false }, false), 'join', 'another seat at a shared table');
    assert.equal(slotClaimKind({ seats_taken: 1, private: true }, true), 'join',
        'a second private booking is a join here — the capacity check then refuses it as full');
});

test('THE GUARD: a private hire on an occupied shared table is a mode-clash, not a seat', () => {
    // The bug. A flat booking on a shared session that already has someone in it
    // must be refused, never silently take a single seat.
    assert.equal(slotClaimKind({ seats_taken: 1, private: false }, true), 'mode-clash');
    assert.equal(slotClaimKind({ seats_taken: 8, private: false }, true), 'mode-clash');
});

test('a seat on a privately-hired room is also a mode-clash', () => {
    assert.equal(slotClaimKind({ seats_taken: 1, private: true }, false), 'mode-clash');
});

// --- the offering a slot provider makes, inferred from its item units ---

test('THE RETURNING HOST: one flat item reads as private, one per-person as shared', () => {
    // The quiet-break case — an existing single-item provider has no stored
    // offering, so the wizard infers it from the unit. They must see what they
    // set up, never be flipped to something else.
    assert.equal(slotOfferingFromUnits(['flat']), 'private', 'a private-hire host stays private');
    assert.equal(slotOfferingFromUnits(['person']), 'shared', 'a shared-table host stays shared');
});

test('two items of different units read as both; order does not matter', () => {
    assert.equal(slotOfferingFromUnits(['flat', 'person']), 'both');
    assert.equal(slotOfferingFromUnits(['person', 'flat']), 'both');
});

test('no items yet means no choice has been made (asked, not defaulted)', () => {
    assert.equal(slotOfferingFromUnits([]), null);
});

test('the minimum and the private gates read the offering', () => {
    assert.equal(offeringHasShared('shared'), true);
    assert.equal(offeringHasShared('both'), true);
    assert.equal(offeringHasShared('private'), false);
    assert.equal(offeringHasShared(null), false);
    assert.equal(offeringHasPrivate('private'), true);
    assert.equal(offeringHasPrivate('both'), true);
    assert.equal(offeringHasPrivate('shared'), false);
});

// --- per-option availability: the one truth the guest panel and host diary share ---

// A room of six that sells per-person, with a minimum group of two.
const P = { slot_capacity: 6, slot_min_people: 2 };

test('an empty time is possible for every option', () => {
    // No row yet: a per-person seat can take up to the whole room; a private hire
    // can take the empty room.
    const person = optionAvailability(null, 'person', P);
    assert.equal(person.possible, true);
    assert.equal(person.seatsLeft, 6, 'the whole room is open to the shared table');
    const priv = optionAvailability(null, 'flat', P);
    assert.equal(priv.possible, true);
});

test('a partly-filled shared table: per-person fits while it clears the minimum, private cannot', () => {
    // Two seats sold of six. Four left.
    const row = { capacity: 6, seats_taken: 2, private: false };
    const person = optionAvailability(row, 'person', P);
    assert.equal(person.possible, true);
    assert.equal(person.seatsLeft, 4, 'four seats remain sellable');
    // The private hire is refused — the room is no longer whole (mode-clash).
    const priv = optionAvailability(row, 'flat', P);
    assert.equal(priv.possible, false);
    assert.equal(priv.reason, 'other-mode');
});

test('a shared table with fewer seats than the minimum is closed to per-person', () => {
    // Five of six taken, minimum group two: one seat left, no group of two fits.
    const row = { capacity: 6, seats_taken: 5, private: false };
    const person = optionAvailability(row, 'person', P);
    assert.equal(person.possible, false);
    assert.equal(person.reason, 'too-small');
    assert.equal(person.seatsLeft, 1, 'one seat is left, but not a bookable group');
});

test('a full shared table is closed', () => {
    const row = { capacity: 6, seats_taken: 6, private: false };
    assert.equal(optionAvailability(row, 'person', P).possible, false);
    assert.equal(optionAvailability(row, 'person', P).reason, 'full');
});

test('a privately-hired time is closed to everything', () => {
    const row = { capacity: 1, seats_taken: 1, private: true };
    assert.equal(optionAvailability(row, 'flat', P).possible, false, 'no second private hire');
    assert.equal(optionAvailability(row, 'person', P).possible, false, 'no seat on a hired room');
    assert.equal(optionAvailability(row, 'person', P).reason, 'other-mode');
});

test('a per-person item with no capacity set is offered by nobody (matches the route refusal)', () => {
    const noCap = { slot_capacity: null, slot_min_people: 1 };
    assert.equal(optionAvailability(null, 'person', noCap).possible, false);
    assert.equal(optionAvailability(null, 'person', noCap).reason, 'misconfigured');
});

test('sessionClosedToAll reads the provider’s own units', () => {
    // A both-provider (flat + person). A two-of-six shared table is NOT closed:
    // per-person still fits, even though the private hire cannot.
    const partial = { capacity: 6, seats_taken: 2, private: false };
    assert.equal(sessionClosedToAll(partial, ['flat', 'person'], P), false);
    // Five of six, minimum two: per-person can't fit a group and private clashes.
    const nearlyFull = { capacity: 6, seats_taken: 5, private: false };
    assert.equal(sessionClosedToAll(nearlyFull, ['flat', 'person'], P), true);
    // A private hire closes a both-provider's time entirely.
    const hired = { capacity: 1, seats_taken: 1, private: true };
    assert.equal(sessionClosedToAll(hired, ['flat', 'person'], P), true);
    // An empty time is open.
    assert.equal(sessionClosedToAll(null, ['flat', 'person'], P), false);
});
