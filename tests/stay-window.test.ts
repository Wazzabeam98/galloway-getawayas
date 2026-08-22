// When a stay starts and when it is over.
//
// This decided a launch blocker: the upcoming/past split compared `check_in`,
// a date-only string, against `new Date()` — midnight against the current
// time — so a booking made for tonight read as already past, and the Confirm
// button went to Past with it. A host could not accept a same-day booking at
// all.
//
// It had no tests. Making `stayHasEnded` return false always — a stay that
// never ends, putting every finished booking back under Upcoming — passed the
// whole suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

// stayWindow imports '@/lib/pricing' for the local-date parsing, and that
// alias is resolved at runtime — so it has to be installed before the module
// is required, even though nothing here is stubbed.
installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stayEnd, stayHasEnded, stayHasStarted } = require('../lib/stayWindow');

const CHECK_IN = '2026-08-22';
const CHECK_OUT = '2026-08-23';
const at = (s: string) => new Date(s);

test('a stay ends at the listing check-out time, not at midnight', () => {
    const end = stayEnd(CHECK_OUT, '11:00:00');
    assert.equal(end.getHours(), 11, 'local hours, because a host reads a local clock');
    assert.equal(end.getMinutes(), 0);
    assert.equal(end.getDate(), 23);
});

// The exact booking that could not be accepted: made in the evening for that
// same night.
test('a booking made for tonight has not ended', () => {
    assert.equal(
        stayHasEnded(CHECK_OUT, '11:00:00', at('2026-08-22T19:00:00')),
        false,
        'this is the case that sent a same-day booking to Past and hid Confirm'
    );
});

test('a stay is not over on its check-out morning', () => {
    assert.equal(stayHasEnded(CHECK_OUT, '11:00:00', at('2026-08-23T09:00:00')), false);
});

test('a stay is over from the check-out time onwards', () => {
    assert.equal(stayHasEnded(CHECK_OUT, '11:00:00', at('2026-08-23T11:00:00')), true, 'on the hour');
    assert.equal(stayHasEnded(CHECK_OUT, '11:00:00', at('2026-08-23T14:00:00')), true);
});

test('a missing check-out time falls back to 11am, never to midnight', () => {
    // Midnight would put the end of the stay a whole day early and quietly
    // reintroduce the bug this file exists to prevent.
    assert.equal(stayHasEnded(CHECK_OUT, null, at('2026-08-23T09:00:00')), false);
    assert.equal(stayHasEnded(CHECK_OUT, undefined, at('2026-08-23T09:00:00')), false);
    assert.equal(stayHasEnded(CHECK_OUT, 'not a time', at('2026-08-23T09:00:00')), false);
    assert.equal(stayHasEnded(CHECK_OUT, '99:99', at('2026-08-23T09:00:00')), false);
    assert.equal(stayHasEnded(CHECK_OUT, null, at('2026-08-23T12:00:00')), true, 'but it does end');
});

test('a stay has not started on its arrival day', () => {
    // The host keeps the whole of arrival day to call it off; arrival time is
    // the guest's business, not something we know.
    assert.equal(stayHasStarted(CHECK_IN, at('2026-08-22T00:01:00')), false);
    assert.equal(stayHasStarted(CHECK_IN, at('2026-08-22T23:59:00')), false);
});

test('a stay has started the day after arrival', () => {
    assert.equal(stayHasStarted(CHECK_IN, at('2026-08-23T00:01:00')), true);
});

test('a stay in the future has not started', () => {
    assert.equal(stayHasStarted(CHECK_IN, at('2026-08-21T23:00:00')), false);
});

// A date-only string parsed as UTC is midnight UTC, which is the previous day
// for anyone behind Greenwich and shifts the answer by a day. Everything here
// must work off the local calendar date.
test('the comparison never leaks a timezone', () => {
    assert.equal(
        stayHasStarted('2026-08-22', at('2026-08-22T00:30:00')),
        false,
        'half past midnight on arrival day is still arrival day'
    );
    assert.equal(
        stayHasEnded('2026-08-23', '11:00:00', at('2026-08-23T00:30:00')),
        false,
        'and half past midnight on check-out day is not check-out time'
    );
});
