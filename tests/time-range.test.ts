// The phone "Select a time" sheet lists each session as a 24-hour range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeRange24 } from '../lib/timeRange';

test('a start and a length make a 24-hour range', () => {
    assert.equal(timeRange24('10:00', 120), '10:00–12:00');
    assert.equal(timeRange24('09:30:00', 45), '09:30–10:15');
    assert.equal(timeRange24('14:00', 90), '14:00–15:30');
});

test('no length shows the start alone', () => {
    assert.equal(timeRange24('7:05', null), '07:05');
    assert.equal(timeRange24('18:00', 0), '18:00');
});

test('past midnight wraps rather than reading 25:00', () => {
    assert.equal(timeRange24('23:00', 120), '23:00–01:00');
});
