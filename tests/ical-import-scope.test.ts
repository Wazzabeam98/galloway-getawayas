// What a stranger may learn from the availability feed.
//
// /api/ical-import tells the booking widget which dates other platforms have
// taken. It has to answer a signed-out visitor: a guest must be able to see
// that the 12th is gone before they try to book it. So the audit's suggested
// fix — a secret token, like its sibling /api/ical/[id] — would not close a
// leak, it would stop anyone booking. The two routes point in opposite
// directions: that one EXPORTS our bookings and is rightly secret.
//
// The leak was never the dates. It was three other things:
//
//   any listing      including drafts and ones awaiting review, so occupancy
//                    for a not-yet-public property was readable by anyone who
//                    could guess an id
//   which platform   "the 12th went on Airbnb" is a fact about the host's
//                    business, not something a guest needs
//   the feed id      an internal id
//
// So the rule is: answer only for listings a stranger may see at all, and say
// less to a stranger than to the host.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
    read(rel).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const ROUTE = 'app/api/ical-import/route.ts';

test('it still answers a signed-out visitor', () => {
    // The regression that would break booking for everyone. If this route ever
    // starts requiring a session, the calendar on every public listing page
    // silently stops blocking dates that are taken elsewhere — and the first
    // symptom is a double booking.
    const body = code(ROUTE);
    assert.ok(!/status:\s*401/.test(body), 'a guest must not be turned away');
    assert.ok(!/Not signed in/.test(body));
});

test('an unpublished listing is not readable by a stranger', () => {
    const body = code(ROUTE);
    assert.match(body, /PUBLICLY_VISIBLE/,
        'a draft or pending listing must not hand out its occupancy');
    assert.match(body, /'published'/);
    assert.match(body, /'hidden'/);
});

test('a listing a stranger may not see is a 404, not a 403', () => {
    // 403 would confirm the id exists, which turns this into a way to find out
    // which listing ids are real.
    const body = code(ROUTE);
    assert.match(body, /status:\s*404/);
    assert.ok(!/status:\s*403/.test(body));
});

test('the platform is only computed when it will be sent', () => {
    // platformFromUrl reads the feed URL, which is the host's private export
    // link on the other site. Not something to touch on a guest's request.
    const body = code(ROUTE);
    assert.match(body, /detail \? platformFromUrl/,
        'the platform lookup should be behind the detail check, not filtered afterwards');
});

test('a stranger gets dates and nothing else', () => {
    const body = code(ROUTE);
    assert.match(body, /const base = \{ start: e\.start, end: e\.end \}/,
        'the anonymous shape has to be exactly the two dates');
    assert.match(body, /detail\s*\n?\s*\?/, 'and the extra fields have to be conditional on detail');
});

test('who counts as the host comes from the shared access rule', () => {
    // checkListing is what the dashboard uses, and it counts co-hosts. A
    // second copy of "is this yours" here would drift from what the calendar
    // page actually lets somebody open.
    const body = code(ROUTE);
    assert.match(body, /checkListing/);
    assert.match(body, /'can_calendar'/);
});

test('it verifies the caller rather than decoding their cookie', () => {
    const body = code(ROUTE);
    assert.match(body, /getUser\(\)/);
    assert.ok(!/getSession\(\)/.test(body),
        'getSession would hand the host-only detail to anyone who wrote their own cookie');
});

test('the booking widget only ever used the two dates', () => {
    // Which is why narrowing the anonymous response is safe. If this stops
    // being true the widget needs updating in the same change.
    const widget = read('components/BookingWidget.tsx');
    const call = widget.slice(widget.indexOf('/api/ical-import'), widget.indexOf('/api/ical-import') + 400);
    assert.match(call, /ev\.start/);
    assert.match(call, /ev\.end/);
    assert.ok(!/ev\.platform|ev\.feedId/.test(call),
        'the public widget now reads a field a stranger is no longer given');
});

test('the host calendar still asks for and uses the detail', () => {
    const cal = read('app/dashboard/calendar/page.tsx');
    assert.match(cal, /ev\.platform/);
    assert.match(cal, /ev\.platformName/);
});
