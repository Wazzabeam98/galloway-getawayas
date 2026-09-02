// The free-cancellation deadline: computed live, on the calendar parts, so it
// names the same day in every zone — and inclusive of the last free day.
//
// Two bugs pinned down here:
//   * freeCancelUntilKey used to floor to local midnight and (in the checkout
//     store) go through toISOString, landing a day early under BST: check-in
//     6 Oct on Moderate stored 30 September when it should be 1 October.
//   * cancellationPosition used a strict `>` on the last free day, flipping the
//     card's state to "partial" — telling a guest a cancellation would cost them
//     on a day it was still free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeCancelUntilKey } from '../lib/cancellation';
import { cancellationPosition } from '../lib/cancellationView';

const d = (iso: string) => new Date(iso + 'T12:00:00');

test('the reported case: check-in 6 Oct, Moderate → 1 Oct (not 30 Sept)', () => {
    assert.equal(freeCancelUntilKey('2026-10-06', 'Moderate'), '2026-10-01');
});

test('the key is the same day in summer and winter check-ins', () => {
    // Firm subtracts 30 days; both sides land on the calendar day, no drift.
    assert.equal(freeCancelUntilKey('2026-07-31', 'Firm'), '2026-07-01');
    assert.equal(freeCancelUntilKey('2026-01-31', 'Firm'), '2026-01-01');
});

test('the deadline crosses a DST boundary without slipping', () => {
    // Full-refund window spanning the spring-forward Sunday (29 Mar 2026).
    assert.equal(freeCancelUntilKey('2026-04-05', 'Limited'), '2026-03-22'); // -14 days
});

test('E1: the last free day is still free', () => {
    // Moderate, check-in 6 Oct → last free day 1 Oct. On 1 Oct it is still free.
    const on = cancellationPosition({ checkIn: '2026-10-06', policy: 'Moderate', on: d('2026-10-01') });
    assert.equal(on.kind, 'free');
    assert.equal(on.freeUntilKey, '2026-10-01');
});

test('the day after the last free day is no longer free', () => {
    const after = cancellationPosition({ checkIn: '2026-10-06', policy: 'Moderate', on: d('2026-10-02') });
    assert.notEqual(after.kind, 'free');
    assert.equal(after.freeUntilKey, null);
});
