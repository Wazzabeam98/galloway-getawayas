// Payout-setup reminders (lib/payoutReminders): once on a host's FIRST booking,
// once again before that guest checks in — and never twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { planReminders, reminderCopy, BEFORE_CHECK_IN_DAYS } = require('../lib/payoutReminders');

const b = (id: string, host: string, checkIn: string, created: string) => ({ id, host_id: host, check_in: checkIn, created_at: created });
const TODAY = '2026-10-01';

test('the first booking gets the booking reminder; a later one does not', () => {
    const plan = planReminders([
        b('late', 'h1', '2026-12-01', '2026-09-20T10:00:00Z'),
        b('first', 'h1', '2026-11-01', '2026-09-10T10:00:00Z'),
    ], new Set(), TODAY);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].booking.id, 'first');
    assert.equal(plan[0].kind, 'booking');
});

test('each reminder is sent once', () => {
    const plan = planReminders([b('first', 'h1', '2026-11-01', '2026-09-10T10:00:00Z')], new Set(['first:booking']), TODAY);
    assert.deepEqual(plan, [], 'booking reminder already sent, check-in not yet close');
});

test('before check-in, the second reminder goes — within the window only', () => {
    const soon = '2026-10-0' + (1 + BEFORE_CHECK_IN_DAYS);
    const plan = planReminders([b('first', 'h1', soon, '2026-09-10T10:00:00Z')], new Set(['first:booking']), TODAY);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].kind, 'before_check_in');
    const none = planReminders([b('first', 'h1', soon, '2026-09-10T10:00:00Z')], new Set(['first:booking', 'first:before_check_in']), TODAY);
    assert.deepEqual(none, []);
});

test('a first booking made inside the window gets ONE email that covers both', () => {
    const plan = planReminders([b('first', 'h1', '2026-10-02', '2026-09-30T10:00:00Z')], new Set(), TODAY);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].kind, 'booking');
    assert.equal(plan[0].alsoClaim, 'before_check_in');
});

test('nothing once the first stay has begun', () => {
    const plan = planReminders([b('first', 'h1', '2026-09-28', '2026-09-01T10:00:00Z')], new Set(), TODAY);
    assert.deepEqual(plan, []);
});

test('hosts are planned independently', () => {
    const plan = planReminders([
        b('a', 'h1', '2026-11-01', '2026-09-10T10:00:00Z'),
        b('c', 'h2', '2026-11-05', '2026-09-11T10:00:00Z'),
    ], new Set(), TODAY);
    assert.deepEqual(plan.map((p: any) => p.booking.id).sort(), ['a', 'c']);
});

test('the copy says the money is held, not lost, and never promises a date it cannot keep', () => {
    for (const kind of ['booking', 'before_check_in']) {
        const c = reminderCopy(kind, 'Heron Cottage', 'on Fri 2 October');
        const text = c.paragraphs.join(' ');
        assert.match(text, /hold/);
        assert.match(text, /day after/);
    }
});
