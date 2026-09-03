// The iCal export joins blocked days into runs with an EXCLUSIVE end. The bug
// this pins down: the day-after was computed by adding a day to an instant
// (new Date(runEnd); setDate(+1); toISOString()), which on the spring-forward
// Sunday lands back on the same calendar day — so DTEND equalled DTSTART, the
// event was zero-length, and the run came out a night short. A night another
// platform could then sell over the top of. blockedRuns does the arithmetic on
// the calendar parts, so it holds across both DST transitions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedRuns } from '../lib/icalRuns';

test('a single blocked night on the spring-forward Sunday keeps its night', () => {
    // 29 March 2026 is spring forward. DTEND must be the 30th (exclusive), not
    // the 29th, or the night vanishes.
    assert.deepEqual(blockedRuns(['2026-03-29']), [
        { start: '2026-03-29', endExclusive: '2026-03-30' },
    ]);
});

test('a single blocked night on the autumn fall-back Sunday keeps its night', () => {
    assert.deepEqual(blockedRuns(['2026-10-25']), [
        { start: '2026-10-25', endExclusive: '2026-10-26' },
    ]);
});

test('a run straddling the spring-forward day stays one run, ending the day after', () => {
    assert.deepEqual(blockedRuns(['2026-03-28', '2026-03-29', '2026-03-30']), [
        { start: '2026-03-28', endExclusive: '2026-03-31' },
    ]);
});

test('gaps break runs; each run ends the day after its last night', () => {
    assert.deepEqual(
        blockedRuns(['2026-07-01', '2026-07-02', '2026-07-05']),
        [
            { start: '2026-07-01', endExclusive: '2026-07-03' },
            { start: '2026-07-05', endExclusive: '2026-07-06' },
        ],
    );
});

test('unsorted and duplicate days are handled', () => {
    assert.deepEqual(
        blockedRuns(['2026-07-02', '2026-07-01', '2026-07-02']),
        [{ start: '2026-07-01', endExclusive: '2026-07-03' }],
    );
});

test('no blocked days, no runs', () => {
    assert.deepEqual(blockedRuns([]), []);
});
