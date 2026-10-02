// lib/dayKey — the one implementation of calendar day keys.
//
// These cases are the ones the old `toISOString().split('T')[0]` idiom got
// wrong: a London day read late in the evening in summer, and day arithmetic
// across both DST transitions. They pass whatever zone the runner is in, which
// is the point — the zone is named, not inherited. Run under TZ=Europe/London
// and TZ=UTC and the answers are identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { londonDayKey, shiftDayKey, daysBetweenKeys, ukLongDate, ukDateTime } from '../lib/dayKey';

test('londonDayKey reads the London day, not the UTC day, late on a summer evening', () => {
    // 2026-07-01 23:30 UTC is already 2 July in London (BST, +1). toISOString
    // would have said 1 July — the money crons' original bug.
    assert.equal(londonDayKey(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
});

test('londonDayKey and UTC agree in winter', () => {
    // GMT: no offset, so the old idiom happened to be right here.
    assert.equal(londonDayKey(new Date('2026-01-15T23:30:00Z')), '2026-01-15');
});

test('londonDayKey midday is stable both seasons', () => {
    assert.equal(londonDayKey(new Date('2026-07-01T11:00:00Z')), '2026-07-01');
    assert.equal(londonDayKey(new Date('2026-01-01T11:00:00Z')), '2026-01-01');
});

test('shiftDayKey adds a calendar day across the spring-forward Sunday', () => {
    // 29 March 2026 is the spring-forward day; the day after is the 30th.
    // Adding a day to the instant would have produced the 29th again.
    assert.equal(shiftDayKey('2026-03-29', 1), '2026-03-30');
});

test('shiftDayKey adds a calendar day across the autumn fall-back Sunday', () => {
    // 25 October 2026 is the fall-back day; the day after is the 26th.
    assert.equal(shiftDayKey('2026-10-25', 1), '2026-10-26');
});

test('shiftDayKey subtracts, and crosses month and year ends', () => {
    assert.equal(shiftDayKey('2026-07-02', -1), '2026-07-01');
    assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
    assert.equal(shiftDayKey('2027-01-01', -1), '2026-12-31');
});

test('daysBetweenKeys counts whole days across a DST transition', () => {
    // The clocks change in this span; it is still seven calendar days.
    assert.equal(daysBetweenKeys('2026-03-26', '2026-04-02'), 7);
    assert.equal(daysBetweenKeys('2026-10-01', '2026-10-01'), 0);
    assert.equal(daysBetweenKeys('2026-10-06', '2026-10-01'), -5);
});

test('ukLongDate reads a key back as the site writes dates', () => {
    assert.equal(ukLongDate('2026-10-01'), '1 October 2026');
    assert.equal(ukLongDate('2026-03-09'), '9 March 2026');
});

// ukDateTime — the one message-timestamp format: DD/MM/YYYY, HH:MM, 24-hour,
// always Europe/London. These are the cases the thread/inbox's old zone-less
// (or zone-named-but-"24 Sep") toLocaleString got wrong.
test('ukDateTime formats a timestamp as DD/MM/YYYY, HH:MM (24-hour)', () => {
    // 09:05 London in winter (GMT): zero-padded hour and minute.
    assert.equal(ukDateTime('2026-01-15T09:05:00Z'), '15/01/2026, 09:05');
});

test('ukDateTime reads the London wall clock in summer, so the day can roll', () => {
    // 2026-07-01 23:30 UTC is 00:30 on 2 July in London (BST, +1). The inbox's
    // old zone-less toLocaleString would read the runner's zone — on a UTC
    // server, "01/07/2026, 23:30", the wrong day AND hour.
    assert.equal(ukDateTime('2026-07-01T23:30:00Z'), '02/07/2026, 00:30');
});

test('ukDateTime is 24-hour, not am/pm', () => {
    // 18:45 London in winter.
    assert.equal(ukDateTime('2026-02-10T18:45:00Z'), '10/02/2026, 18:45');
});

test('ukDateTime tolerates a Date, and empty/invalid input gives an empty string', () => {
    assert.equal(ukDateTime(new Date('2026-01-15T09:05:00Z')), '15/01/2026, 09:05');
    assert.equal(ukDateTime(null), '');
    assert.equal(ukDateTime(undefined), '');
    assert.equal(ukDateTime(''), '');
    assert.equal(ukDateTime('not a date'), '');
});
