// The way in (door code, wifi password) shows from three days before check-in
// until the end of checkout day — and only on a paid, confirmed stay.
//
// Both halves were missing on 29 Sep 2026, found by walking a stay end to end:
// the arrival page and the message thread kept the code on a former guest's
// screen for ever after checkout, and the message thread handed it to an
// UNPAID booking (which the booking panel creates straight from the browser)
// whose check-in was close. The window is now one function every surface reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalSecretsWindowOpen, ARRIVAL_SECRETS_LEAD_DAYS } from '../lib/bookingWindows';
import { bookingReleasesPrivateData } from '../lib/bookingEntitlement';

// Noon on 29/09/2026 in London (BST, so 11:00 UTC).
const NOW = new Date('2026-09-29T11:00:00Z');
const stay = (checkIn: string, checkOut: string) => ({ check_in: checkIn, check_out: checkOut });

test('the lead is three days', () => {
    assert.equal(ARRIVAL_SECRETS_LEAD_DAYS, 3);
});

test('closed more than three days out, open from three days out', () => {
    assert.equal(arrivalSecretsWindowOpen(stay('2026-10-03', '2026-10-06'), NOW), false, 'four days out');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-10-02', '2026-10-05'), NOW), true, 'three days out');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-29', '2026-10-02'), NOW), true, 'check-in day');
});

test('open through checkout day, closed from the day after', () => {
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-26', '2026-09-29'), NOW), true, 'checkout day');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-25', '2026-09-28'), NOW), false, 'the day after checkout');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-08-20', '2026-08-23'), NOW), false, 'a month after');
});

test('checkout day is the London day, not the UTC one', () => {
    // 00:30 BST on 30/09 is still 29/09 in UTC. The stay that checked out on
    // the 29th is over in London, so the code has gone.
    const justAfterMidnight = new Date('2026-09-29T23:30:00Z');
    assert.equal(arrivalSecretsWindowOpen(stay('2026-09-26', '2026-09-29'), justAfterMidnight), false);
});

test('the window is never enough on its own — an unpaid or unaccepted booking gets nothing', () => {
    const inWindow = stay('2026-10-01', '2026-10-04');
    assert.equal(arrivalSecretsWindowOpen(inWindow, NOW), true);
    assert.equal(bookingReleasesPrivateData({ status: 'pending_payment', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'pending', payment_status: 'paid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'unpaid' }), false);
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'paid' }), true);
});
