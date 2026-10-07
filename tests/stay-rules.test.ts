// The calendar's Availability settings are enforced when a guest books: the
// booking card and the checkout route both ask lib/stayRules, so a stay the
// card would grey out is one checkout refuses too — whatever dates the link
// carries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    stayProblem, minNightsFor, maxNightsFor, earliestCheckInKey, latestCheckOutKey,
    prepBufferNights, stayLengthNote, londonTodayKey, noticeDays, prepDays, windowMonths,
} from '../lib/stayRules';

const TODAY = '2026-10-05';
const ok = (listing: any, checkIn: string, checkOut: string, extra: any = {}) =>
    stayProblem({ listing, checkIn, checkOut, todayKey: TODAY, ...extra });

test('no minimum set means 1 night, as on Airbnb', () => {
    assert.equal(minNightsFor({}, null, '2026-11-01'), 1);
    assert.equal(minNightsFor({ min_nights: null }, null, null), 1);
    assert.equal(ok({}, '2026-11-01', '2026-11-02'), null);
});

test('a 3-night minimum refuses 1 and 2 nights and allows 3', () => {
    const l = { min_nights: 3 };
    assert.match(ok(l, '2026-11-01', '2026-11-02') || '', /3-night minimum/);
    assert.match(ok(l, '2026-11-01', '2026-11-03') || '', /3-night minimum/);
    assert.equal(ok(l, '2026-11-01', '2026-11-04'), null);
});

test('a date override on the calendar sets the minimum for a stay checking in that day', () => {
    const l = { min_nights: 2 };
    const minOverrides = { '2026-12-24': 4 };
    assert.equal(minNightsFor(l, minOverrides, '2026-12-24'), 4);
    assert.equal(minNightsFor(l, minOverrides, '2026-12-23'), 2);
    assert.match(ok(l, '2026-12-24', '2026-12-27', { minOverrides }) || '', /4-night minimum/);
    assert.equal(ok(l, '2026-12-23', '2026-12-25', { minOverrides }), null);
});

test('no maximum means no limit; a maximum refuses anything longer', () => {
    assert.equal(maxNightsFor({}), null);
    assert.equal(ok({}, '2026-11-01', '2027-01-30'), null);
    const l = { max_nights: 14 };
    assert.equal(ok(l, '2026-11-01', '2026-11-15'), null);
    assert.match(ok(l, '2026-11-01', '2026-11-16') || '', /14-night maximum/);
});

test('advance notice: same day allows today, 2 days pushes the first check-in out', () => {
    assert.equal(noticeDays({ advance_notice: 'Same day' }), 0);
    assert.equal(ok({ advance_notice: 'Same day' }, TODAY, '2026-10-06'), null);
    assert.match(ok({ advance_notice: 'Same day' }, '2026-10-04', '2026-10-06') || '', /passed/);
    const l = { advance_notice: '2 days' };
    assert.equal(earliestCheckInKey(l, TODAY), '2026-10-07');
    assert.match(ok(l, '2026-10-06', '2026-10-08') || '', /2 days’ notice/);
    assert.equal(ok(l, '2026-10-07', '2026-10-09'), null);
});

test('availability window: the checkout may not run past today + the window', () => {
    assert.equal(windowMonths({ availability_window: 'All future dates' }), null);
    const l = { availability_window: '3 months' };
    assert.equal(latestCheckOutKey(l, TODAY), '2027-01-05');
    assert.equal(ok(l, '2027-01-03', '2027-01-05'), null);
    assert.match(ok(l, '2027-01-04', '2027-01-06') || '', /availability window/);
});

test('preparation time keeps nights free either side of another stay', () => {
    assert.equal(prepDays({ preparation_time: 'None' }), 0);
    const other = [{ start: '2026-11-10', end: '2026-11-13' }];
    const buffer = prepBufferNights(other, 1);
    assert.deepEqual([...buffer].sort(), ['2026-11-09', '2026-11-13']);
    const l = { preparation_time: '1 day' };
    // Leaving the morning before the gap night is fine; using the gap night is not.
    assert.equal(ok(l, '2026-11-06', '2026-11-09', { prepBuffer: buffer }), null);
    assert.match(ok(l, '2026-11-07', '2026-11-10', { prepBuffer: buffer }) || '', /too close/);
    assert.match(ok(l, '2026-11-13', '2026-11-15', { prepBuffer: buffer }) || '', /too close/);
    assert.equal(ok(l, '2026-11-14', '2026-11-16', { prepBuffer: buffer }), null);
});

test('the calendar note', () => {
    assert.equal(stayLengthNote(1, null), '');
    assert.equal(stayLengthNote(3, null), '3-night minimum');
    assert.equal(stayLengthNote(3, 14), '3-night minimum · 14-night maximum');
});

test('today is the London calendar day', () => {
    // 23:30 UTC on 31 Oct 2026 is 23:30 GMT (clocks have gone back) — still the 31st.
    assert.equal(londonTodayKey(new Date('2026-10-31T23:30:00Z')), '2026-10-31');
    // 23:30 UTC on 1 Oct 2026 is 00:30 BST on the 2nd.
    assert.equal(londonTodayKey(new Date('2026-10-01T23:30:00Z')), '2026-10-02');
});

import { checkInPickable, checkoutPickable } from '../lib/stayRules';

test('a guest can check out on the morning another stay checks in', () => {
    // Another stay holds the nights of 10, 11, 12 Nov.
    const unavailable = new Set(['2026-11-10', '2026-11-11', '2026-11-12']);
    assert.equal(checkoutPickable('2026-11-07', '2026-11-10', unavailable, 1, null), true, 'out on the 10th');
    assert.equal(checkInPickable('2026-11-10', unavailable), false, 'but not in on the 10th');
    assert.equal(checkoutPickable('2026-11-07', '2026-11-11', unavailable, 1, null), false, 'a night overlaps');
    // And the server agrees: stayProblem has no objection to the same stay.
    assert.equal(stayProblem({ listing: {}, checkIn: '2026-11-07', checkOut: '2026-11-10', todayKey: TODAY }), null);
});

test('a guest can check out on a day kept free by preparation time', () => {
    const buffer = prepBufferNights([{ start: '2026-11-10', end: '2026-11-13' }], 1); // keeps the 9th free
    const unavailable = new Set(['2026-11-10', '2026-11-11', '2026-11-12', ...buffer]);
    assert.equal(checkoutPickable('2026-11-06', '2026-11-09', unavailable, 1, null), true, 'out on the 9th');
    assert.equal(checkInPickable('2026-11-09', unavailable), false, 'the 9th is no check-in');
    assert.equal(checkoutPickable('2026-11-06', '2026-11-10', unavailable, 1, null), false, 'staying the night of the 9th');
    assert.equal(stayProblem({ listing: { preparation_time: '1 day' }, checkIn: '2026-11-06', checkOut: '2026-11-09', todayKey: TODAY, prepBuffer: buffer }), null);
});

test('the minimum and maximum still apply to a checkout', () => {
    const none = new Set<string>();
    assert.equal(checkoutPickable('2026-11-01', '2026-11-03', none, 3, null), false);
    assert.equal(checkoutPickable('2026-11-01', '2026-11-04', none, 3, 14), true);
    assert.equal(checkoutPickable('2026-11-01', '2026-11-16', none, 3, 14), false);
});

import { fillsGapExactly, unsellableNights } from '../lib/stayRules';

// Two stays hold the nights of 10–12 Nov and 15–17 Nov, leaving a 2-night gap
// (the 13th and 14th) between them. The minimum is 3.
const GAP_UNAVAILABLE = new Set(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-15', '2026-11-16', '2026-11-17']);

test('a below-minimum stay is allowed only when it fills a gap exactly', () => {
    const l = { min_nights: 3 };
    const u = { minOverrides: null, prepBuffer: null, unavailable: GAP_UNAVAILABLE };
    // The 2-night stay that fills the gap exactly, 13th to 15th, is allowed
    // even though it is under the 3-night minimum.
    assert.equal(ok(l, '2026-11-13', '2026-11-15', u), null);
    // A single night inside the gap orphans the other — refused.
    assert.match(ok(l, '2026-11-13', '2026-11-14', u) || '', /3-night minimum/);
    assert.match(ok(l, '2026-11-14', '2026-11-15', u) || '', /3-night minimum/);
    // A short stay that is NOT up against taken nights on both sides is still
    // refused: this is a gap-fill, not a blanket exemption.
    assert.match(ok(l, '2026-11-20', '2026-11-22', u) || '', /3-night minimum/);
    // Without the unavailable set there is no exception at all (old behaviour).
    assert.match(ok(l, '2026-11-13', '2026-11-15') || '', /3-night minimum/);
});

test('fillsGapExactly needs a taken night on both sides and free nights between', () => {
    assert.equal(fillsGapExactly('2026-11-13', '2026-11-15', GAP_UNAVAILABLE), true);
    assert.equal(fillsGapExactly('2026-11-13', '2026-11-14', GAP_UNAVAILABLE), false, 'checkout night free');
    assert.equal(fillsGapExactly('2026-11-14', '2026-11-15', GAP_UNAVAILABLE), false, 'night before free');
    assert.equal(fillsGapExactly('2026-11-13', '2026-11-15', new Set()), false, 'no boundaries at all');
});

test('the checkout picker offers the exact gap fill, nothing shorter', () => {
    // Checking in on the 13th (the first free gap night).
    assert.equal(checkoutPickable('2026-11-13', '2026-11-15', GAP_UNAVAILABLE, 3, null), true, 'out on the 15th fills the gap');
    assert.equal(checkoutPickable('2026-11-13', '2026-11-14', GAP_UNAVAILABLE, 3, null), false, 'one night orphans the 14th');
});

test('unsellableNights marks orphan runs and leaves fillable gaps alone', () => {
    // Every night from the 8th to the 25th, in order.
    const nights: string[] = [];
    for (let d = 8; d <= 25; d++) nights.push('2026-11-' + String(d).padStart(2, '0'));
    const out = unsellableNights(nights, GAP_UNAVAILABLE, () => 3);

    // The 8th–9th are a 2-night run open on the left (nothing taken before the
    // 8th in this window) and bounded by the stay on the right — too short for
    // the 3-night minimum and not fillable, so unsellable.
    assert.equal(out.has('2026-11-08'), true);
    assert.equal(out.has('2026-11-09'), true);
    // The 13th–14th gap is closed on both sides, so it CAN be filled exactly —
    // it is sellable and must not be marked.
    assert.equal(out.has('2026-11-13'), false);
    assert.equal(out.has('2026-11-14'), false);
    // The long open run after the second stay is sellable.
    assert.equal(out.has('2026-11-20'), false);
});
