// Checkout must re-check availability LIVE against the iCal feed right before
// payment, not trust the cached listing_ical_feeds.events column — a starved
// sync leaves that column stale and a date sold on Airbnb after the last sync
// would otherwise stay bookable through payment. These prove the live fetch +
// parse the checkout route now relies on.
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

test('parseIcsEvents reads DATE-valued VEVENTs into {start,end}', () => {
    const events = parseIcsEvents(ICS);
    assert.deepEqual(events, [{ start: '2026-11-10', end: '2026-11-13' }]);
    // The nights taken are the 10th, 11th, 12th — the 13th is the checkout day.
    const nights = blockedNightsFromEvents(events);
    assert.ok(nights.has('2026-11-10') && nights.has('2026-11-11') && nights.has('2026-11-12'));
    assert.ok(!nights.has('2026-11-13'), 'the checkout day is free again');
});

test('fetchLiveIcalEvents returns fresh events when the feed is reachable', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ ok: true, text: async () => ICS });
    try {
        const events = await fetchLiveIcalEvents('https://example.invalid/cal.ics');
        assert.deepEqual(events, [{ start: '2026-11-10', end: '2026-11-13' }]);
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('fetchLiveIcalEvents returns null (not empty) when the feed cannot be read', async () => {
    // Null lets checkout fall back to the cached column rather than treating a
    // momentary outage as "no blocked dates" and letting a clash through.
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ ok: false, text: async () => '' });
    try {
        assert.equal(await fetchLiveIcalEvents('https://example.invalid/cal.ics'), null);
    } finally {
        (globalThis as any).fetch = realFetch;
    }

    (globalThis as any).fetch = async () => { throw new Error('network down'); };
    try {
        assert.equal(await fetchLiveIcalEvents('https://example.invalid/cal.ics'), null);
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});
