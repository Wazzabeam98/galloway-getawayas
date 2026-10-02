// A partial block removes the covered starts from the generated grid — the same
// span the database exclusion measures, so the guest never sees a start the claim
// would refuse. The database is the authority (a block is a slot_sessions row in
// the no-overlap exclusion); this proves the grid mirrors it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { generateSessions } = require('@/lib/serviceSlots');

// Open every weekday 09:00–17:00 so a single-date generation is dow-independent.
const OPEN_ALL = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '17:00' }));
const DAY = '2026-10-06';
const times = (opts: any) => opts.map((s: any) => s.time);
// 60-min slots back to back: 09:00 … 16:00 (16:00 + 60 = 17:00 == close).
const gen = (partial?: any) => generateSessions(OPEN_ALL, [], 60, DAY, DAY, 60, partial);

test('no partial blocks: the full grid', () => {
    assert.deepEqual(times(gen()), ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('a one-hour block drops exactly the covered start', () => {
    const out = times(gen([{ date: DAY, startMin: 12 * 60, endMin: 13 * 60 }]));
    assert.ok(!out.includes('12:00'), '12:00 is blocked');
    assert.ok(out.includes('11:00') && out.includes('13:00'), 'the hours either side stay open');
    assert.equal(out.length, 7);
});

test('a start whose interval RUNS INTO a block is dropped, not just a start inside it', () => {
    // Block 12:00–12:30. An 11:30 booking would run [11:30,12:30) into it — but the
    // grid steps hourly, so test with a block that a whole-hour start runs into:
    // block 12:30–13:30 → the 12:00 start occupies [12:00,13:00) and overlaps.
    const out = times(gen([{ date: DAY, startMin: 12 * 60 + 30, endMin: 13 * 60 + 30 }]));
    assert.ok(!out.includes('12:00'), '12:00 runs into the block and is dropped');
    assert.ok(!out.includes('13:00'), '13:00 starts inside the block and is dropped');
    assert.ok(out.includes('11:00') && out.includes('14:00'), 'clear hours stay');
});

test('a two-hour block drops both covered starts', () => {
    const out = times(gen([{ date: DAY, startMin: 12 * 60, endMin: 14 * 60 }]));
    assert.ok(!out.includes('12:00') && !out.includes('13:00'));
    assert.ok(out.includes('11:00') && out.includes('14:00'));
    assert.equal(out.length, 6);
});

test('a block on another date leaves this date whole', () => {
    const out = times(gen([{ date: '2026-10-07', startMin: 12 * 60, endMin: 13 * 60 }]));
    assert.equal(out.length, 8, 'nothing dropped — the block is a different day');
});
