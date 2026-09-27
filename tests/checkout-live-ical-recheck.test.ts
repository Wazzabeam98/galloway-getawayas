// Checkout must re-check availability LIVE against the iCal feed right before
// payment, not trust the cached listing_ical_feeds.events column — a starved
// sync leaves that column stale and a date sold on Airbnb after the last sync
// would otherwise stay bookable through payment. These prove the live fetch +
// parse the checkout route now relies on.
//
// The live fetch goes through lib/feedFetch (public-https-only, SSRF-guarded);
// those safety rules are tested in feed-url-safety.test.ts. Here we use a public
// IP-literal host so no DNS lookup is needed and the stubbed fetch decides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { parseIcsEvents, fetchLiveIcalEvents, blockedNightsFromEvents } = require('@/lib/availability');

const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261110',
    'DTEND;VALUE=DATE:20261113',
    'SUMMARY:Reserved (Airbnb)',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

// A public, non-blocked IPv4 literal — an IP host skips DNS in the safe fetch.
const PUBLIC = 'https://93.184.216.34/cal.ics';
const ok = (body: string) => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => body });

test('parseIcsEvents reads DATE-valued VEVENTs into {start,end}', () => {
    const events = parseIcsEvents(ICS);
    assert.deepEqual(events, [{ start: '2026-11-10', end: '2026-11-13' }]);
    const nights = blockedNightsFromEvents(events);
    assert.ok(nights.has('2026-11-10') && nights.has('2026-11-11') && nights.has('2026-11-12'));
    assert.ok(!nights.has('2026-11-13'), 'the checkout day is free again');
});

test('fetchLiveIcalEvents returns fresh events when the feed is reachable', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ok(ICS);
    try {
        const events = await fetchLiveIcalEvents(PUBLIC);
        assert.deepEqual(events, [{ start: '2026-11-10', end: '2026-11-13' }]);
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('fetchLiveIcalEvents returns null (not empty) when the feed cannot be read', async () => {
    // Null lets checkout fall back to the cached column rather than treating a
    // momentary outage as "no blocked dates" and letting a clash through.
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ status: 502, ok: false, headers: { get: () => null }, text: async () => '' });
    try {
        assert.equal(await fetchLiveIcalEvents(PUBLIC), null);
    } finally {
        (globalThis as any).fetch = realFetch;
    }

    (globalThis as any).fetch = async () => { throw new Error('network down'); };
    try {
        assert.equal(await fetchLiveIcalEvents(PUBLIC), null);
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('fetchLiveIcalEvents refuses a private/localhost feed without fetching', async () => {
    const realFetch = globalThis.fetch;
    let called = 0;
    (globalThis as any).fetch = async () => { called++; return ok(ICS); };
    try {
        assert.equal(await fetchLiveIcalEvents('https://127.0.0.1/cal.ics'), null);
        assert.equal(await fetchLiveIcalEvents('http://93.184.216.34/cal.ics'), null, 'http is refused');
        assert.equal(called, 0, 'an unsafe address is never fetched');
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});
