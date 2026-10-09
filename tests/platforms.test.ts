import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { PLATFORMS, platformFromUrl } = require('@/lib/platforms');

// The calendar draws a booking's colour by looking PLATFORMS up by the KEY that
// platformFromUrl returns — so a feed only shows its own colour when its key is
// in the list. Hospitable had no entry, so it fell through to `other` (grey).
// These lock in that every platform we claim to colour actually keeps its own,
// which is what went wrong when Hospitable lost its one.

test('every listed platform keeps its own colour, by key', () => {
    assert.equal(PLATFORMS.airbnb.colour, '#FF5A5F');
    assert.equal(PLATFORMS.booking.colour, '#003580');
    assert.equal(PLATFORMS.vrbo.colour, '#DB2777');
    assert.equal(PLATFORMS.google.colour, '#FBBC04');
    assert.equal(PLATFORMS.hospitable.colour, '#7C3AED');
    assert.equal(PLATFORMS.other.colour, '#475569');

    // Every colour is distinct — no two platforms share one (the three blues
    // used to be so close after softening they read as the same colour).
    const colours = Object.values(PLATFORMS).map((p: any) => p.colour);
    assert.equal(new Set(colours).size, colours.length, 'platform colours must all differ');
});

test('platformFromUrl maps each feed to its own platform (not grey "other")', () => {
    assert.equal(platformFromUrl('https://www.airbnb.co.uk/calendar/ical/123.ics').key, 'airbnb');
    assert.equal(platformFromUrl('https://admin.booking.com/hotel/ical.html?t=abc').key, 'booking');
    assert.equal(platformFromUrl('https://www.vrbo.com/icalendar/xyz.ics').key, 'vrbo');
    assert.equal(platformFromUrl('https://calendar.google.com/calendar/ical/x/basic.ics').key, 'google');
    // Hospitable — recognised by URL or by the host's own label.
    assert.equal(platformFromUrl('https://my.hospitable.com/calendar/abc.ics').key, 'hospitable');
    assert.equal(platformFromUrl('https://feeds.example.com/abc.ics', 'Hospitable').key, 'hospitable');
    assert.equal(platformFromUrl('https://my.hospitable.com/calendar/abc.ics').colour, '#7C3AED');
});

test('an unknown feed is the only one that falls back to other/grey', () => {
    const p = platformFromUrl('https://feeds.example.com/mystery.ics');
    assert.equal(p.key, 'other');
    assert.equal(p.colour, '#475569');
});
