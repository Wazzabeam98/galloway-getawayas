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
    CODE_RELEASE_CHOICES,
    normaliseReleaseHours,
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

test('an off-list release value falls back to the default', () => {
    assert.equal(normaliseReleaseHours(999), DEFAULT_CODE_RELEASE_HOURS);
    assert.equal(normaliseReleaseHours('48'), 48);
    assert.equal(normaliseReleaseHours(null), DEFAULT_CODE_RELEASE_HOURS);
    assert.equal(normaliseReleaseHours(undefined), DEFAULT_CODE_RELEASE_HOURS);
    assert.ok(CODE_RELEASE_CHOICES.some((c) => c.hours === DEFAULT_CODE_RELEASE_HOURS));
});

test('the window is never enough on its own — an unpaid or unaccepted booking gets nothing', () => {
    const inWindow = stay('2026-09-29', '2026-10-02');
    assert.equal(arrivalSecretsWindowOpen(inWindow, NOW), true);
    assert.equal(bookingReleasesPrivateData({ status: 'pending_payment', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'pending', payment_status: 'paid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'paid' }), true);
});
