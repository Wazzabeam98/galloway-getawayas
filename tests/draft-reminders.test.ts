import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    planDraftReminders,
    draftReminderCopy,
    FIRST_REMINDER_HOURS,
    SECOND_REMINDER_DAYS,
    ReminderDraft,
} from '../lib/draftReminders';

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0); // 10 Nov 2026, noon
const hoursAgo = (h: number): string => new Date(NOW - h * 3600000).toISOString();
const daysAgo = (d: number): string => hoursAgo(d * 24);

const draft = (id: string, created_at: string): ReminderDraft => ({ id, created_at });

test('nothing before 48 hours', () => {
    const plan = planDraftReminders([draft('a', hoursAgo(20))], new Set(), NOW);
    assert.equal(plan.length, 0);
});

test('first reminder once past 48 hours', () => {
    const plan = planDraftReminders([draft('a', hoursAgo(FIRST_REMINDER_HOURS + 1))], new Set(), NOW);
    assert.deepEqual(plan, [{ listingId: 'a', kind: 'first' }]);
});

test('first is not sent twice', () => {
    const plan = planDraftReminders([draft('a', hoursAgo(50))], new Set(['a:first']), NOW);
    assert.equal(plan.length, 0);
});

test('past seven days sends the second and claims the first with it', () => {
    const plan = planDraftReminders([draft('a', daysAgo(SECOND_REMINDER_DAYS + 1))], new Set(), NOW);
    assert.deepEqual(plan, [{ listingId: 'a', kind: 'second', alsoClaim: 'first' }]);
});

test('past seven days when the first already went sends only the second', () => {
    const plan = planDraftReminders([draft('a', daysAgo(8))], new Set(['a:first']), NOW);
    assert.deepEqual(plan, [{ listingId: 'a', kind: 'second' }]);
});

test('second is not sent twice', () => {
    const plan = planDraftReminders([draft('a', daysAgo(30))], new Set(['a:first', 'a:second']), NOW);
    assert.equal(plan.length, 0);
});

test('a future or unparseable created_at is ignored', () => {
    const plan = planDraftReminders(
        [draft('a', new Date(NOW + 3600000).toISOString()), draft('b', 'not-a-date')],
        new Set(),
        NOW,
    );
    assert.equal(plan.length, 0);
});

test('copy falls back when the draft has no title', () => {
    const first = draftReminderCopy('first', '');
    assert.match(first.subject, /pick up where you left off/i);
    assert.ok(first.paragraphs.join(' ').includes('your holiday let'));

    const second = draftReminderCopy('second', 'Seaside Cottage');
    assert.match(second.subject, /Seaside Cottage/);
});
