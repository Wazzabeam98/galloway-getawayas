// The Resend free plan stops sending at 100 emails a day and tells nobody.
// These pin the warning: it counts the right window, it fires once past 80,
// and it fires once a day — not every hour, not never.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSentSince, resendTime, shouldWarn, warnedDayFrom, heartbeatDetail, QUOTA_WARN_AT } from '../lib/resendQuota';

const NOW = new Date('2026-10-03T15:00:00Z');
const SINCE = new Date(NOW.getTime() - 24 * 3600 * 1000);

// Resend's list: newest first, 100 a page, has_more + an `after` cursor.
function fakeResend(createdAts: string[], status = 200) {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
        calls.push(url);
        if (status !== 200) return { ok: false, status, json: async () => ({}), text: async () => 'restricted_api_key' };
        const after = new URL(url).searchParams.get('after');
        const start = after ? Number(after.slice(1)) + 1 : 0;
        const page = createdAts.slice(start, start + 100).map((c, i) => ({ id: 'e' + (start + i), created_at: c }));
        return { ok: true, status: 200, json: async () => ({ data: page, has_more: start + 100 < createdAts.length }), text: async () => '' };
    };
    return { fetchImpl, calls };
}

function minutesAgo(n: number): string {
    // Resend's own format, as its API returns it: "2026-10-03 14:16:10.203000+00".
    return new Date(NOW.getTime() - n * 60000).toISOString().replace('T', ' ').replace('Z', '000+00');
}

test('counts only the last 24 hours, across pages', async () => {
    const inside = Array.from({ length: 130 }, (_, i) => minutesAgo(i * 10)); // up to ~21.5h ago
    const outside = Array.from({ length: 20 }, (_, i) => minutesAgo(25 * 60 + i));
    const { fetchImpl, calls } = fakeResend([...inside, ...outside]);
    const r = await countSentSince('key', SINCE, fetchImpl as any);
    assert.deepEqual(r, { ok: true, count: 130, complete: true });
    assert.equal(calls.length, 2, 'stops paging once past the window');
});

test("reads Resend's timestamp format", () => {
    assert.equal(resendTime('2026-10-03 14:16:10.203000+00'), Date.parse('2026-10-03T14:16:10.203Z'));
    assert.equal(resendTime('nonsense'), null);
});

test('a key that cannot list emails is reported, not read as zero', async () => {
    const { fetchImpl } = fakeResend([], 401);
    const r = await countSentSince('key', SINCE, fetchImpl as any);
    assert.equal(r.ok, false);
});

test('warns at 80, not before', () => {
    assert.equal(shouldWarn(QUOTA_WARN_AT - 1, null, '2026-10-03'), false);
    assert.equal(shouldWarn(QUOTA_WARN_AT, null, '2026-10-03'), true);
});

test('warns once a day: quiet for the rest of today, again tomorrow', () => {
    const detail = heartbeatDetail(85, '2026-10-03');
    assert.equal(warnedDayFrom(detail), '2026-10-03');
    assert.equal(shouldWarn(90, warnedDayFrom(detail), '2026-10-03'), false);
    assert.equal(shouldWarn(90, warnedDayFrom(detail), '2026-10-04'), true);
    assert.equal(warnedDayFrom(heartbeatDetail(12, null)), null);
    assert.equal(warnedDayFrom(null), null);
});
