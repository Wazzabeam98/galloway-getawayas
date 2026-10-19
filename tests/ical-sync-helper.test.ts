// lib/icalSync is the one place a feed URL becomes cached events + a status on
// its row — shared by the every-15-minutes cron and the host's "Sync now" button
// so the two can never write a sync two different ways. These prove the two
// outcomes that matter: a good sync replaces the events and clears the failure
// ladder, and a failed one records the failure WITHOUT touching the cached
// events (a calendar we can't reach is not a calendar with no bookings).
//
// The fetch goes through lib/feedFetch (public-https-only, SSRF-guarded, tested
// in feed-url-safety.test.ts); here a public IP-literal host skips DNS so the
// stubbed fetch decides the outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { syncOneFeed, mapWithConcurrency } = require('@/lib/icalSync');

const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261110',
    'DTEND;VALUE=DATE:20261113',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

const PUBLIC = 'https://93.184.216.34/cal.ics';
const ok = (body: string) => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => body });

// Records every update written to listing_ical_feeds so a test can assert what a
// sync persisted.
function fakeAdmin(captures: any[]) {
    return {
        from(_table: string) {
            return {
                update(payload: any) {
                    return {
                        eq(_col: string, val: string) {
                            captures.push({ payload, id: val });
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            };
        },
    };
}

test('a reachable feed writes fresh events, ok status and a cleared failure ladder', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ok(ICS);
    const captures: any[] = [];
    try {
        const res = await syncOneFeed(fakeAdmin(captures), { id: 'f1', url: PUBLIC, failure_count: 2 }, '2026-10-19T00:00:00.000Z');
        assert.deepEqual(res, { ok: true, failureCount: 0 });
        assert.equal(captures.length, 1);
        const p = captures[0].payload;
        assert.equal(captures[0].id, 'f1');
        assert.deepEqual(p.events, [{ start: '2026-11-10', end: '2026-11-13' }]);
        assert.equal(p.last_status, 'ok');
        assert.equal(p.last_error, null);
        assert.equal(p.failure_count, 0);
        assert.equal(p.alerted_at, null);
        assert.equal(p.last_synced_at, '2026-10-19T00:00:00.000Z');
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('an unreachable feed records the failure and the incremented count, leaving cached events alone', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { throw new Error('network down'); };
    const captures: any[] = [];
    try {
        const res = await syncOneFeed(fakeAdmin(captures), { id: 'f2', url: PUBLIC, failure_count: 2 }, '2026-10-19T00:00:00.000Z');
        assert.equal(res.ok, false);
        assert.equal(res.failureCount, 3);
        const p = captures[0].payload;
        assert.equal(p.last_status, 'failed');
        assert.ok(p.last_error, 'an error message is recorded');
        assert.equal(p.failure_count, 3);
        // The cache-preserving half: a failed sync must NEVER write events, or it
        // would free up dates that are actually taken elsewhere.
        assert.ok(!('events' in p), 'a failed sync does not overwrite the cached events');
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('a link that is reachable but not a calendar is treated as failed', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ok('<html>not a calendar</html>');
    const captures: any[] = [];
    try {
        const res = await syncOneFeed(fakeAdmin(captures), { id: 'f3', url: PUBLIC, failure_count: 0 }, 'now');
        assert.equal(res.ok, false);
        assert.equal(res.failureCount, 1);
        assert.equal(captures[0].payload.last_status, 'failed');
        assert.ok(!('events' in captures[0].payload));
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('mapWithConcurrency keeps order and never exceeds the cap', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapWithConcurrency(items, 3, async (x: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        return x * 2;
    });
    assert.deepEqual(out, items.map((x) => x * 2));
    assert.ok(maxInFlight <= 3, 'at most 3 in flight at once (was ' + maxInFlight + ')');
    assert.ok(maxInFlight >= 2, 'actually ran concurrently');
});

test('mapWithConcurrency handles an empty list', async () => {
    const out = await mapWithConcurrency([], 8, async () => 1);
    assert.deepEqual(out, []);
});
