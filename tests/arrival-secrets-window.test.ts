// The way in (door code, wifi password) shows from the host's chosen window
// before check-in until the end of checkout day — and only on a paid, confirmed
// stay. The window used to be a single hard-coded three days for everyone;
// it is now per listing, hours before the check-in INSTANT, defaulting to 24.
//
// Both halves of the gate were missing on 29 Sep 2026, found by walking a stay
// end to end: the arrival page and message thread kept the code on a former
// guest's screen for ever after checkout, and the thread handed it to an UNPAID
// booking whose check-in was close. The window is one function every surface
// reads, so the card and the scheduled message can never disagree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    arrivalSecretsWindowOpen,
    DEFAULT_CODE_RELEASE_HOURS,
    MAX_CODE_RELEASE_HOURS,
    CODE_RELEASE_CHOICES,
    normaliseReleaseHours,
    normaliseReleaseAtTime,
    normaliseReleaseSetting,
    codeRevealWhenPhrase,
    templateCodeHeldFor,
} from '../lib/bookingWindows';
import { bookingReleasesPrivateData } from '../lib/bookingEntitlement';

// Noon on 29/09/2026 in London (BST, so 11:00 UTC).
const NOW = new Date('2026-09-29T11:00:00Z');
const stay = (checkIn: string, checkOut: string) => ({ check_in: checkIn, check_out: checkOut });

test('the default is 24 hours', () => {
    assert.equal(DEFAULT_CODE_RELEASE_HOURS, 24);
});

test('default 24h: opens 24 hours before the check-in time, not before', () => {
    // Check-in 30/09 at the default 3pm. 24h before is 3pm on 29/09 (14:00 UTC
    // in BST). At noon on the 29th the window is not open yet; at 3pm it is.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-30', '2026-10-03'), NOW), false, 'noon, before the release');
    const atRelease = new Date('2026-09-29T14:00:00Z'); // 15:00 BST
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-30', '2026-10-03'), atRelease), true, 'at 24h before');
    // Check-in today is comfortably inside 24h.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-29', '2026-10-02'), NOW), true, 'check-in day');
});

test('a wider host window opens earlier, a tighter one later', () => {
    // 72h before a 3pm check-in on 02/10 is 3pm on 29/09 — not yet at noon.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-10-02', '2026-10-05'), NOW, 72), false, '72h, just before');
    const atRelease72 = new Date('2026-09-29T14:00:00Z');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-10-02', '2026-10-05'), atRelease72, 72), true, '72h at release');
    // A 12h window on a check-in tomorrow is nowhere near open at noon today.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-30', '2026-10-03'), NOW, 12), false, '12h window');
});

test('the listing check-in time moves the window', () => {
    // 9am check-in on 30/09: 24h before is 9am on 29/09 (08:00 UTC). Noon is past it.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-30', '2026-10-03'), NOW, 24, '09:00:00'), true, '9am check-in');
    // Same stay at a 3pm check-in: 24h before is 3pm the day before — not yet.
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-30', '2026-10-03'), NOW, 24, '15:00:00'), false, '3pm check-in');
});

test('open through checkout day, closed from the day after', () => {
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-26', '2026-09-29'), NOW), true, 'checkout day');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-25', '2026-09-28'), NOW), false, 'the day after checkout');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-08-20', '2026-08-23'), NOW), false, 'a month after');
});

test('checkout day is the London day, not the UTC one', () => {
    // 00:30 BST on 30/09 is still 29/09 in UTC. The stay that checked out on the
    // 29th is over in London, so the code has gone.
    const justAfterMidnight = new Date('2026-09-29T23:30:00Z');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-26', '2026-09-29'), justAfterMidnight), false);
});

test('release hours: any whole number in [0, 336], else the default', () => {
    // Out of range falls back; in range (now including custom values and 0) is
    // kept as-is, so a host can type "6 hours" or "at check-in time".
    assert.equal(normaliseReleaseHours(999), DEFAULT_CODE_RELEASE_HOURS, 'above the ceiling falls back');
    assert.equal(normaliseReleaseHours(-1), DEFAULT_CODE_RELEASE_HOURS, 'below zero falls back');
    assert.equal(normaliseReleaseHours('48'), 48);
    assert.equal(normaliseReleaseHours(6), 6, 'a custom in-range value is kept, not forced to a preset');
    assert.equal(normaliseReleaseHours(0), 0, '0 is valid — at check-in time');
    assert.equal(normaliseReleaseHours(MAX_CODE_RELEASE_HOURS), MAX_CODE_RELEASE_HOURS);
    assert.equal(normaliseReleaseHours(null), DEFAULT_CODE_RELEASE_HOURS);
    assert.equal(normaliseReleaseHours(undefined), DEFAULT_CODE_RELEASE_HOURS);
    assert.ok(CODE_RELEASE_CHOICES.some((c) => c.hours === DEFAULT_CODE_RELEASE_HOURS));
});

test('release_at_time parses HH:MM and HH:MM:SS, rejects nonsense', () => {
    assert.equal(normaliseReleaseAtTime('08:00'), '08:00:00');
    assert.equal(normaliseReleaseAtTime('8:5'), null, 'minutes must be two digits');
    assert.equal(normaliseReleaseAtTime('09:30:00'), '09:30:00');
    assert.equal(normaliseReleaseAtTime('24:00'), null, 'hour out of range');
    assert.equal(normaliseReleaseAtTime('12:60'), null, 'minute out of range');
    assert.equal(normaliseReleaseAtTime(''), null);
    assert.equal(normaliseReleaseAtTime(null), null);
    assert.equal(normaliseReleaseAtTime('not a time'), null);
});

test('at check-in time (0 hours) opens exactly at the check-in instant', () => {
    // 3pm check-in on 30/09 is 14:00 UTC (BST). At 0 hours the window opens then.
    const stay30 = stay('2026-09-30', '2026-10-03');
    const atCheckIn = new Date('2026-09-30T14:00:00Z');
    const justBefore = new Date('2026-09-30T13:59:00Z');
    assert.equal(arrivalSecretsWindowOpen(stay30, justBefore, 0, '15:00:00'), false, 'a minute before check-in: not yet');
    assert.equal(arrivalSecretsWindowOpen(stay30, atCheckIn, 0, '15:00:00'), true, 'at check-in: open');
    // Also accepts the object form.
    assert.equal(arrivalSecretsWindowOpen(stay30, atCheckIn, { releaseHours: 0, releaseAtTime: null }, '15:00:00'), true);
});

test('an absolute reveal time opens at that clock time on the check-in day, ignoring hours', () => {
    // Reveal at 08:00 on the check-in day (30/09), whatever the 3pm check-in is.
    const stay30 = stay('2026-09-30', '2026-10-03');
    const setting = normaliseReleaseSetting(168, '08:00'); // hours should be ignored
    const at8 = new Date('2026-09-30T07:00:00Z'); // 08:00 BST
    const before8 = new Date('2026-09-30T06:30:00Z'); // 07:30 BST
    assert.equal(arrivalSecretsWindowOpen(stay30, before8, setting, '15:00:00'), false, 'before 8am on the day');
    assert.equal(arrivalSecretsWindowOpen(stay30, at8, setting, '15:00:00'), true, 'from 8am on the day');
    // The absolute time wins even though release_hours is a wide week.
    const weekBefore = new Date('2026-09-23T07:00:00Z');
    assert.equal(arrivalSecretsWindowOpen(stay30, weekBefore, setting, '15:00:00'), false, 'the 168h hours value is ignored');
});

test('the guest-facing phrase reads right for all three shapes', () => {
    assert.equal(codeRevealWhenPhrase(24), '24 hours before you arrive');
    assert.equal(codeRevealWhenPhrase(48), '2 days before you arrive');
    assert.equal(codeRevealWhenPhrase(168), 'a week before you arrive');
    assert.equal(codeRevealWhenPhrase(0), 'when you check in');
    assert.equal(codeRevealWhenPhrase({ releaseHours: 0, releaseAtTime: '08:00:00' }), 'from 8am on the day you arrive');
    assert.equal(codeRevealWhenPhrase({ releaseHours: 0, releaseAtTime: '14:30:00' }), 'from 2.30pm on the day you arrive');
});

test('templateCodeHeldFor: a message timed before the release is flagged, one timed within it is not', () => {
    const codeListing = { title: 'Harbour Cottage', release_hours: 24, release_at_time: null, check_in_time: '15:00:00', check_out_time: '11:00:00' };
    // 3 days before check-in, carrying the code, against a 24h release → held.
    const threeDaysOut = { anchor: 'check_in', days_offset: 3, send_hour: 10, minutes_after: 0, hours_after: 0, hours_before: 0, body: 'The code is {lockbox_code}.' };
    assert.deepEqual(templateCodeHeldFor(threeDaysOut, [codeListing]), ['Harbour Cottage']);

    // The same message with no lockbox token is never held.
    const noCode = { ...threeDaysOut, body: 'See you soon!' };
    assert.deepEqual(templateCodeHeldFor(noCode, [codeListing]), []);

    // After check-in, against an hours-before release, is within the window.
    const afterCheckIn = { anchor: 'after_check_in', days_offset: 0, send_hour: 9, minutes_after: 0, hours_after: 1, hours_before: 0, body: 'Settled in? Code: {lockbox_code}.' };
    assert.deepEqual(templateCodeHeldFor(afterCheckIn, [codeListing]), []);

    // But an absolute release LATE on the check-in day holds even an
    // after-check-in message that lands before it.
    const lateReveal = { title: 'Harbour Cottage', release_hours: 24, release_at_time: '20:00:00', check_in_time: '15:00:00', check_out_time: '11:00:00' };
    assert.deepEqual(templateCodeHeldFor(afterCheckIn, [lateReveal]), ['Harbour Cottage']);
});

test('the window is never enough on its own — an unpaid or unaccepted booking gets nothing', () => {
    const inWindow = stay('2026-09-29', '2026-10-02');
    assert.equal(arrivalSecretsWindowOpen(inWindow, NOW), true);
    assert.equal(bookingReleasesPrivateData({ status: 'pending_payment', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'pending', payment_status: 'paid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'paid' }), true);
});
