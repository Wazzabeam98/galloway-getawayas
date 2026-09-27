import test from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

// experienceMove pulls in lib/email, which imports siblings via the '@/' alias;
// install the runtime resolver before that import is evaluated.
installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { whenLabel, moveProviderEmail, moveTargetEligibility } = require('@/lib/experienceMove');

// A far-future session start so cutoff never bites unless a test wants it to.
const FUTURE = '2099-01-01';
const baseSession = (over: any = {}) => ({
    id: 's-target', session_date: FUTURE, session_time: '10:00',
    capacity: 6, seats_taken: 2, private: false, declared: true, blocked: false,
    duration_minutes: 60, ...over,
});
const NOW = new Date('2026-09-20T00:00:00Z');

test('a session with room, right mode and past no cutoff is offered', () => {
    const e = moveTargetEligibility({ seats: 3, private: false }, baseSession(), 12, NOW, 's-current');
    assert.deepEqual(e, { available: true });
});

test('the family’s current session is marked, never offered', () => {
    const e = moveTargetEligibility({ seats: 3, private: false }, baseSession({ id: 's-current' }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'current' });
});

test('a session without room for the WHOLE family is full', () => {
    // 4 taken + a family of 3 > capacity 6.
    const e = moveTargetEligibility({ seats: 3, private: false }, baseSession({ seats_taken: 4 }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'full' });
});

test('a session inside its own cutoff is refused', () => {
    // Starts 6h from NOW, window 12h → already past the deadline.
    const soon = new Date(NOW.getTime() + 6 * 3600 * 1000);
    const date = soon.toISOString().slice(0, 10);
    const time = soon.toISOString().slice(11, 16);
    const e = moveTargetEligibility({ seats: 1, private: false }, baseSession({ session_date: date, session_time: time }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'cutoff' });
});

test('a mode mismatch (shared family, private session) is refused', () => {
    const e = moveTargetEligibility({ seats: 1, private: false }, baseSession({ private: true }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'mode' });
});

test('an empty non-declared session with no length is not a valid target', () => {
    const e = moveTargetEligibility({ seats: 1, private: false }, baseSession({ seats_taken: 0, declared: false, duration_minutes: null }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'not-ready' });
});

test('an empty non-declared session takes the family’s mode (no mode-clash)', () => {
    // Empty + not declared + has a length → establishable; family is private, so
    // the session's own private=false is not a clash.
    const e = moveTargetEligibility({ seats: 1, private: true }, baseSession({ seats_taken: 0, declared: false, private: false }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: true });
});

test('a blocked session is never offered', () => {
    const e = moveTargetEligibility({ seats: 1, private: false }, baseSession({ blocked: true }), 12, NOW, 's-current');
    assert.deepEqual(e, { available: false, reason: 'blocked' });
});

// whenLabel is presentation only — the RPC hands back a YYYY-MM-DD date and an
// HH:MM time, and this renders them the human way the booking emails do (no raw
// database value leaks into an email).
test('whenLabel formats a date and time, and degrades gracefully', () => {
    const dt = whenLabel('2026-10-05', '14:00');
    assert.match(dt, /October 2026 at 2pm/);
    assert.doesNotMatch(dt, /2026-10-05/, 'no raw ISO date');
    assert.doesNotMatch(dt, /14:00/, 'no raw 24h time');
    assert.match(whenLabel('2026-10-05', '14:00:00'), /October 2026 at 2pm/, 'trims seconds');
    const dateOnly = whenLabel('2026-10-05', null);
    assert.match(dateOnly, /October 2026/, 'a date with no time is just the formatted date');
    assert.doesNotMatch(dateOnly, / at /, 'no time, so no "at"');
    assert.equal(whenLabel(null, '14:00'), 'the booked time', 'no date is unusable');
});

// The whole point of the provider notice is the CHANGE, so both the old and the
// new time must be named — in the subject and in the body.
test('the provider move email names BOTH the old and the new time', () => {
    const mail = moveProviderEmail({
        business: 'Loch Sauna',
        itemName: 'Evening sauna session',
        fromDate: '2026-10-05', fromTime: '18:00',
        toDate: '2026-10-12', toTime: '20:00',
        seats: 2,
    });

    // Subject carries the change, formatted the human way (not raw ISO).
    assert.match(mail.subject, /October 2026 at 6pm/);
    assert.match(mail.subject, /October 2026 at 8pm/);
    assert.doesNotMatch(mail.subject, /2026-10-05|18:00/, 'no raw date/time in subject');

    // Body names both, labelled Was / Now, and the item and party size.
    assert.match(mail.html, /October 2026 at 6pm/, 'old time in body');
    assert.match(mail.html, /October 2026 at 8pm/, 'new time in body');
    assert.match(mail.html, /Was/);
    assert.match(mail.html, /Now/);
    assert.match(mail.html, /Evening sauna session/);
    assert.match(mail.html, /2 places/);
});

test('a single-place move reads "1 place", not "1 places"', () => {
    const mail = moveProviderEmail({
        business: 'Loch Sauna', itemName: 'Private hour',
        fromDate: '2026-10-05', fromTime: '18:00',
        toDate: '2026-10-06', toTime: '18:00',
        seats: 1,
    });
    assert.match(mail.html, /1 place\b/);
    assert.doesNotMatch(mail.html, /1 places/);
});
