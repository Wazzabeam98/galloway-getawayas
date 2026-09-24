// The money maths and state machine for "Change reservation" (stay).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    changeDelta, moneyDirection, refundForChange, nights, isRealChange,
    validateChange, guestMayAnswerChange, hostMayCancelChange, isChangeTerminal,
    type StaySnapshot,
} from '../lib/bookingChange';

const base: StaySnapshot = {
    checkIn: '2026-10-02', checkOut: '2026-10-09', guests: 2, children: 0, pets: 0, total: 980,
};

test('the delta is new minus old, and points the money the right way', () => {
    assert.equal(changeDelta(980, 1120), 140);
    assert.equal(changeDelta(980, 840), -140);
    assert.equal(changeDelta(980, 980), 0);
    assert.equal(moneyDirection(140), 'charge');
    assert.equal(moneyDirection(-140), 'refund');
    assert.equal(moneyDirection(0), 'none');
});

test('a refund on a change never exceeds what the guest paid net of refunds', () => {
    assert.equal(refundForChange(-140, 980), 140, 'the full decrease when they have paid enough');
    assert.equal(refundForChange(-500, 300), 300, 'capped at net paid');
    assert.equal(refundForChange(140, 980), 0, 'a charge refunds nothing');
    assert.equal(refundForChange(0, 980), 0);
});

test('nights are whole and half-open', () => {
    assert.equal(nights('2026-10-02', '2026-10-09'), 7);
    assert.equal(nights('2026-12-31', '2027-01-02'), 2, 'across the year boundary');
});

test('a change is only real if a lever actually moved', () => {
    assert.equal(isRealChange(base, base), false);
    assert.equal(isRealChange(base, { ...base, checkOut: '2026-10-10' }), true);
    assert.equal(isRealChange(base, { ...base, guests: 3 }), true);
    assert.equal(isRealChange(base, { ...base, total: 1000 }), true);
    assert.equal(isRealChange(base, { ...base, pets: 1 }), true);
});

test('validation guards dates, capacity, pets, price and no-op', () => {
    const limits = { maxGuests: 6, petsAllowed: false };
    const today = '2026-09-24';

    assert.equal(validateChange(base, { ...base, checkOut: '2026-10-10' }, limits, today).ok, true);

    assert.match(validateChange(base, { ...base, checkOut: '2026-10-01' }, limits, today).error || '', /after the check-in/);
    assert.match(validateChange(base, { ...base, checkIn: '2026-09-01', checkOut: '2026-09-05' }, limits, today).error || '', /past/);
    assert.match(validateChange(base, { ...base, guests: 8 }, limits, today).error || '', /sleeps up to 6/);
    assert.match(validateChange(base, { ...base, guests: 4, children: 5 }, limits, today).error || '', /more children than guests/);
    assert.match(validateChange(base, { ...base, pets: 1 }, limits, today).error || '', /doesn.t allow pets/);
    assert.match(validateChange(base, base, limits, today).error || '', /Nothing has changed/);

    // Pets allowed → a pet change validates.
    assert.equal(validateChange(base, { ...base, pets: 1 }, { maxGuests: 6, petsAllowed: true }, today).ok, true);
});

test('the state machine gates who can act from each status', () => {
    assert.equal(guestMayAnswerChange('pending'), true);
    assert.equal(guestMayAnswerChange('accepted'), false);
    assert.equal(hostMayCancelChange('pending'), true);
    assert.equal(hostMayCancelChange('accepted'), false);
    assert.equal(isChangeTerminal('pending'), false);
    assert.equal(isChangeTerminal('accepted'), true);
    assert.equal(isChangeTerminal('declined'), true);
    assert.equal(isChangeTerminal('cancelled'), true);
});
