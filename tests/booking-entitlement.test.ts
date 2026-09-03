// The single entitlement rule, and the surfaces that must obey it.
//
// This guards the fix for the arrival/PII leak of 2026-09-03: four readers
// released private data (host PII, door code, address, phone) on the strength
// of a booking row EXISTING, when any signed-in account can plant an unpaid
// `pending_payment` row for free. The rule is now one function —
// bookingReleasesPrivateData — and a booking releases only when it is
// status='confirmed' AND paid ('paid' or 'deposit_paid'). status alone is not
// enough: a host can self-confirm a booking on their own listing without payment.
//
// A regression here is a real guest locked out (if it over-tightens — a DEPOSIT
// guest especially) or the leak reopened (if it loosens), so every combination
// is pinned explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bookingReleasesPrivateData } = require('../lib/bookingEntitlement');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contactNumberVisible } = require('../lib/stayWindow');

test('only a confirmed AND paid booking releases private data', () => {
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'paid' }), true, 'confirmed + paid releases');
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'deposit_paid' }), true, 'a DEPOSIT guest is a real guest — must not be locked out');
    // confirmed but not paid — the host-self-confirmed edge — must NOT release
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'unpaid' }), false, 'confirmed but UNPAID must not release');
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed', payment_status: 'refunded' }), false, 'confirmed but refunded must not release');
    assert.equal(bookingReleasesPrivateData({ status: 'confirmed' }), false, 'confirmed with no payment_status must not release (fail closed)');
    // paid but not confirmed, and every other status
    assert.equal(bookingReleasesPrivateData({ status: 'pending', payment_status: 'paid' }), false, 'paid but not confirmed (awaiting host acceptance) must not release');
    for (const status of ['pending_payment', 'pending', 'cancelled', 'declined', 'refunded', 'expired', 'completed']) {
        assert.equal(bookingReleasesPrivateData({ status, payment_status: 'paid' }), false, status + ' must not release even if paid');
    }
});

test('a missing or empty status never releases (fail closed)', () => {
    assert.equal(bookingReleasesPrivateData(null), false);
    assert.equal(bookingReleasesPrivateData(undefined), false);
    assert.equal(bookingReleasesPrivateData({}), false);
    assert.equal(bookingReleasesPrivateData({ status: null }), false);
    assert.equal(bookingReleasesPrivateData({ payment_status: 'paid' }), false, 'paid with no status must not release');
});

// The exact planted-booking shape from the proof: unpaid, tomorrow's check-in.
// Before the fix contactNumberVisible excluded only cancelled/declined, so this
// row (near arrival, not cancelled) surfaced the counterparty's phone.
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
const inThree = (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); })();

test('contactNumberVisible refuses a planted pending_payment booking near arrival', () => {
    assert.equal(
        contactNumberVisible({ check_in: tomorrow, check_out: inThree, status: 'pending_payment' }, '11:00:00'),
        false,
        'an unpaid planted row must not surface the phone even though arrival is near',
    );
});

test('contactNumberVisible refuses a paid-but-unaccepted pending request', () => {
    assert.equal(
        contactNumberVisible({ check_in: tomorrow, check_out: inThree, status: 'pending' }, '11:00:00'),
        false,
    );
});

test('contactNumberVisible refuses a confirmed-but-UNPAID booking near arrival', () => {
    assert.equal(
        contactNumberVisible({ check_in: tomorrow, check_out: inThree, status: 'confirmed', payment_status: 'unpaid' }, '11:00:00'),
        false,
        'a host-self-confirmed unpaid booking must not surface the phone',
    );
});

test('contactNumberVisible still shows a real confirmed+paid guest the number near arrival', () => {
    assert.equal(
        contactNumberVisible({ check_in: tomorrow, check_out: inThree, status: 'confirmed', payment_status: 'paid' }, '11:00:00'),
        true,
        'the legitimate guest must NOT be locked out of the arrival contact',
    );
    assert.equal(
        contactNumberVisible({ check_in: tomorrow, check_out: inThree, status: 'confirmed', payment_status: 'deposit_paid' }, '11:00:00'),
        true,
        'a deposit guest must NOT be locked out either',
    );
});

test('even confirmed+paid, the number stays hidden until arrival is near', () => {
    const farOff = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
    const farOut = (() => { const d = new Date(); d.setDate(d.getDate() + 33); return d.toISOString().slice(0, 10); })();
    assert.equal(
        contactNumberVisible({ check_in: farOff, check_out: farOut, status: 'confirmed', payment_status: 'paid' }, '11:00:00'),
        false,
        'the confirmed+paid gate does not replace the near-arrival window; both apply',
    );
});
