// The money maths and state machine for "Change reservation" (stay).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    changeDelta, moneyDirection, refundForDecrease, balanceAfter, nights, isRealChange,
    validateChange, guestMayAnswerChange, hostMayCancelChange, guestMayPayChange,
    whoAnswers, isOpenChange, isChangeTerminal,
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

test('a decrease refunds only what is overpaid against the NEW total', () => {
    // Paid in full (£980), new total £840 → the £140 overpayment comes back.
    assert.equal(refundForDecrease(980, 840), 140);
    // Deposit only (£245) and the new total (£840) is still above it → nothing
    // back; the decrease just shrinks the balance left to pay.
    assert.equal(refundForDecrease(245, 840), 0);
    // Deposit (£500) now exceeds the new total (£420) → refund the £80 overpaid.
    assert.equal(refundForDecrease(500, 420), 80);
    // Never negative.
    assert.equal(refundForDecrease(0, 700), 0);
});

test('the balance is the new total less what is paid net of any refund', () => {
    // Full-paid decrease, £140 refunded → net paid 840, new total 840 → 0 owed.
    assert.equal(balanceAfter(840, 840), 0);
    // Deposit decrease, nothing refunded → still owe the rest.
    assert.equal(balanceAfter(840, 245), 595);
    // Increase, paid in full to the old total → the extra is owed until paid.
    assert.equal(balanceAfter(1120, 980), 140);
    assert.equal(balanceAfter(700, 900), 0, 'never negative');
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

test('validation guards dates, capacity, pets and no-op', () => {
    const limits = { maxGuests: 6, petsAllowed: false };
    const today = '2026-09-24';

    assert.equal(validateChange(base, { ...base, checkOut: '2026-10-10' }, limits, today).ok, true);

    assert.match(validateChange(base, { ...base, checkOut: '2026-10-01' }, limits, today).error || '', /after the check-in/);
    // Moving check-in to a NEW past date is refused.
    assert.match(validateChange(base, { ...base, checkIn: '2026-09-01' }, limits, today).error || '', /past/);
    assert.match(validateChange(base, { ...base, guests: 8 }, limits, today).error || '', /sleeps up to 6/);
    assert.match(validateChange(base, { ...base, guests: 4, children: 5 }, limits, today).error || '', /more children than guests/);
    assert.match(validateChange(base, { ...base, pets: 1 }, limits, today).error || '', /doesn.t allow pets/);
    assert.match(validateChange(base, base, limits, today).error || '', /Nothing has changed/);

    // Pets allowed → a pet change validates.
    assert.equal(validateChange(base, { ...base, pets: 1 }, { maxGuests: 6, petsAllowed: true }, today).ok, true);
});

test('a MID-STAY extension keeps the past check-in and extends check-out', () => {
    // The stay started on 2 Oct; today is 5 Oct. Extending the checkout is a real,
    // allowed change even though the (unchanged) check-in is now in the past.
    const midStay = { maxGuests: 6, petsAllowed: false };
    const today = '2026-10-05';
    assert.equal(
        validateChange(base, { ...base, checkOut: '2026-10-12' }, midStay, today).ok, true,
        'the arrival stays put, the departure moves out',
    );
    // A stay that is already over can't be changed — that's a money matter.
    assert.match(
        validateChange({ ...base, checkOut: '2026-10-03' }, { ...base, checkOut: '2026-10-04' }, midStay, '2026-10-20').error || '',
        /already over/,
    );
});

test('the state machine gates who can act from each status', () => {
    assert.equal(guestMayAnswerChange('pending'), true);
    assert.equal(guestMayAnswerChange('accepted'), false);
    assert.equal(hostMayCancelChange('pending'), true);
    assert.equal(hostMayCancelChange('awaiting_guest_payment'), true, 'still open, still withdrawable');
    assert.equal(hostMayCancelChange('accepted'), false);
    assert.equal(guestMayPayChange('awaiting_guest_payment'), true);
    assert.equal(guestMayPayChange('pending'), false);
    assert.equal(isChangeTerminal('pending'), false);
    assert.equal(isChangeTerminal('awaiting_guest_payment'), false);
    assert.equal(isChangeTerminal('accepted'), true);
    assert.equal(isChangeTerminal('declined'), true);
    assert.equal(isChangeTerminal('cancelled'), true);
});

test('who answers a proposal is the side that did NOT make it', () => {
    assert.equal(whoAnswers('host'), 'guest', 'a host proposal waits on the guest');
    assert.equal(whoAnswers('guest'), 'host', 'a guest proposal waits on the host');
    assert.equal(isOpenChange('pending'), true);
    assert.equal(isOpenChange('awaiting_guest_payment'), true);
    assert.equal(isOpenChange('accepted'), false);
});
