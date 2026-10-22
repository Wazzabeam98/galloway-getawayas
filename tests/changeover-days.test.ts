// Changeover days — Airbnb's "Restrict check-in days" / "Restrict checkout
// days". James at Silver Birch (syncs from SuperControl) runs Monday and Friday
// changeovers and would not publish without them (22/10/2026). The guest's
// calendar, the checkout route and the change-request routes all ask
// lib/stayRules, so a day the card greys out is one the server refuses too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const {
    stayProblem, changeoverProblem, arrivalAllowed, departureAllowed, cleanWeekdays,
    weekdayOfKey, weekdayList, changeoverNote, checkInPickable, checkoutPickable,
} = require('../lib/stayRules');

const TODAY = '2026-10-05';
// Mon & Fri only, both ways. 2026-11-02 is a Monday, 11-06 a Friday.
const MON_FRI = { checkin_days: [1, 5], checkout_days: [1, 5] };

test('weekdays are read from the day key, Sunday = 0, with no time zone slip', () => {
    assert.equal(weekdayOfKey('2026-11-01'), 0);
    assert.equal(weekdayOfKey('2026-11-02'), 1);
    assert.equal(weekdayOfKey('2026-11-07'), 6);
    assert.equal(weekdayOfKey('2027-03-28'), 0, 'the day the clocks go forward is still a Sunday');
});

test('existing listings — nothing stored, or all seven — allow every day', () => {
    for (const listing of [{}, { checkin_days: null, checkout_days: null }, { checkin_days: [0, 1, 2, 3, 4, 5, 6] }]) {
        for (let d = 1; d <= 7; d++) {
            const key = '2026-11-0' + d;
            assert.equal(arrivalAllowed(listing, key), true);
            assert.equal(departureAllowed(listing, key), true);
        }
        assert.equal(changeoverNote(listing), '');
    }
});

test('a Monday/Friday changeover: arrive and leave only on those days', () => {
    assert.equal(stayProblem({ listing: MON_FRI, checkIn: '2026-11-02', checkOut: '2026-11-06', todayKey: TODAY }), null, 'Mon → Fri');
    assert.equal(stayProblem({ listing: MON_FRI, checkIn: '2026-11-06', checkOut: '2026-11-09', todayKey: TODAY }), null, 'Fri → Mon');
    assert.match(stayProblem({ listing: MON_FRI, checkIn: '2026-11-03', checkOut: '2026-11-06', todayKey: TODAY }), /Check-in is only on Monday or Friday/);
    assert.match(stayProblem({ listing: MON_FRI, checkIn: '2026-11-02', checkOut: '2026-11-05', todayKey: TODAY }), /Checkout is only on Monday or Friday/);
    assert.equal(changeoverNote(MON_FRI), 'Check-in Monday or Friday · Checkout Monday or Friday');
    assert.equal(weekdayList([0, 6, 1]), 'Monday, Saturday or Sunday', 'Monday-first order');
});

test('filling a gap exactly does not lift a changeover day', () => {
    // Wed→Thu fills a one-night gap between two taken nights, which the minimum
    // would allow — but neither is a changeover day.
    const unavailable = new Set(['2026-11-03', '2026-11-05']);
    assert.match(stayProblem({ listing: { ...MON_FRI, min_nights: 3 }, checkIn: '2026-11-04', checkOut: '2026-11-05', todayKey: TODAY, unavailable }), /Check-in is only/);
});

test('the guest calendar greys out the same days', () => {
    const none = new Set<string>();
    assert.equal(checkInPickable('2026-11-03', none, MON_FRI), false);
    assert.equal(checkInPickable('2026-11-02', none, MON_FRI), true);
    assert.equal(checkInPickable('2026-11-03', none), true, 'callers that pass no rules are unchanged');
    assert.equal(checkoutPickable('2026-11-02', '2026-11-05', none, 1, null, MON_FRI), false);
    assert.equal(checkoutPickable('2026-11-02', '2026-11-06', none, 1, null, MON_FRI), true);
});

test('a change request is checked only on the end that moves', () => {
    // A Wednesday→Saturday stay booked before the host restricted the days.
    assert.equal(changeoverProblem(MON_FRI, '2026-11-04', '2026-11-07', { checkIn: false, checkOut: false }), null, 'guest count only');
    assert.match(changeoverProblem(MON_FRI, '2026-11-04', '2026-11-08', { checkIn: false, checkOut: true }), /Checkout is only/);
    assert.equal(changeoverProblem(MON_FRI, '2026-11-04', '2026-11-09', { checkIn: false, checkOut: true }), null, 'moved to a Monday');
});

test('the save check: a non-empty list of 0–6', () => {
    assert.deepEqual(cleanWeekdays([5, 1, 1]), [1, 5]);
    assert.deepEqual(cleanWeekdays(['1', 5]), [1, 5]);
    for (const bad of [[], [7], [-1], [1.5], 'Mon', null, undefined]) assert.equal(cleanWeekdays(bad), null, JSON.stringify(bad));
});

test('every server path asks the rule, before any money moves', () => {
    const checkout = read('app/api/stripe/checkout/route.ts');
    assert.match(checkout, /checkin_days, checkout_days/, 'checkout reads the changeover days, so stayProblem can refuse');
    assert.match(read('app/api/bookings/change/route.ts'), /changeoverProblem\(/);
    assert.match(read('app/api/listings/search-availability/route.ts'), /changeoverProblem\(/, 'date search leaves out a place those dates cannot be booked at');
    const respond = read('app/api/bookings/change/respond/route.ts');
    const at = respond.indexOf('changeoverProblem(');
    assert.ok(at > 0 && at < respond.indexOf('guestCheckout(admin, chg'), 'checked before the guest is sent to pay');
    const save = read('app/api/listings/save/route.ts');
    assert.match(save, /cleanWeekdays\(safe\[key\]\)/);
    assert.match(read('supabase/migrations/20261022150607_listing_changeover_days.sql'), /default '\{0,1,2,3,4,5,6\}'/, 'existing listings default to every day');
});
