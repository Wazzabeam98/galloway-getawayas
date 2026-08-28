// refundDue() — the one place a refund amount is worked out.
//
// The rule under test: the cleaning fee comes back in full whenever a booking
// is cancelled, because the clean does not happen, and the policy fraction
// applies to what is left. That is what /cancellation-policy has promised all
// along; until 28 August 2026 the code took a flat fraction of everything.
//
// These are the pure-function cases. tests/refund-amounts.test.ts follows the
// same rule through the two routes to the figure handed to Stripe, and
// tests/money.test.ts covers refundFraction() underneath it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundDue } from '../lib/cancellation';

const d = (iso: string) => new Date(iso + 'T12:00:00');
const CHECK_IN = '2026-10-01';

/** A £400 stay with a £60 clean, paid in full, unless said otherwise. */
function input(overrides: any = {}) {
    return {
        amountPaid: 400,
        alreadyRefunded: 0,
        cleaningFee: 60,
        checkIn: CHECK_IN,
        policy: 'Moderate',
        on: d('2026-09-27'),   // four days out — the 50% band
        ...overrides,
    };
}

test('in the 50% band the clean comes back whole and the rest is halved', () => {
    // £60 clean + half of the remaining £340 = £60 + £170.
    assert.equal(refundDue(input()), 230);
});

test('in the full-refund window everything comes back, as before', () => {
    // Nothing to distinguish: the fraction is 1, so the split does not matter.
    assert.equal(refundDue(input({ on: d('2026-09-20') })), 400);
});

test('inside the non-refundable window the clean STILL comes back', () => {
    // The change with the sharpest edge. "Whenever you cancel" is what is
    // published, so a Firm booking called off three days out returns £60 where
    // it used to return nothing at all.
    assert.equal(refundDue(input({ policy: 'Firm', on: d('2026-09-28') })), 60);
});

test('a deposit-only guest gets the clean whole, then the fraction on the rest', () => {
    // £100 deposit on a £400 stay, cancelled in the 50% band:
    // £60 + half of the remaining £40 = £80. Not £50, which is what the flat
    // fraction used to give. Accepted deliberately.
    assert.equal(refundDue(input({ amountPaid: 100 })), 80);
});

test('a deposit smaller than the clean returns the deposit, not the fee', () => {
    // £40 paid against a £60 clean. The guest cannot be given back more than
    // they handed over, whatever the policy promises.
    assert.equal(refundDue(input({ amountPaid: 40 })), 40);
});

test('a host cancelling returns everything and never touches the split', () => {
    assert.equal(
        refundDue(input({ policy: 'Firm', on: d('2026-09-28'), hostCancelling: true })),
        400
    );
});

test('the cleaning fee is returned once, not once per refund', () => {
    // £200 already given back on a £400 booking. That is more than the £60
    // clean, so it is treated as having covered it, and this refund is the
    // ordinary fraction of the £200 still held: £100.
    //
    // Without this the fee would be handed over a second time and the guest
    // would end up with £130 for a stay the policy says gives half back.
    assert.equal(refundDue(input({ alreadyRefunded: 200 })), 100);
});

test('a small earlier refund leaves the rest of the clean still owed', () => {
    // £10 back already, so £50 of the clean is still outstanding. £390 remains
    // held: £50 + half of £340 = £220.
    assert.equal(refundDue(input({ alreadyRefunded: 10 })), 220);
});

test('a booking with no cleaning fee behaves exactly as it always did', () => {
    // Half of £400. This is the case that must not move, and it is why hosts
    // who charge no cleaning fee see no change at all.
    assert.equal(refundDue(input({ cleaningFee: 0 })), 200);
});

test('a booking older than the column is treated as having no cleaning fee', () => {
    // Null means "we do not know what was charged", and inventing a number
    // from the listing would be inventing evidence. Same figure as today.
    assert.equal(refundDue(input({ cleaningFee: null })), 200);
});

test('nothing left to refund gives nothing, not a negative', () => {
    assert.equal(refundDue(input({ alreadyRefunded: 400 })), 0);
    assert.equal(refundDue(input({ amountPaid: 0 })), 0);
});

test('the refund can never exceed what is still held', () => {
    // A cleaning fee larger than the whole booking is a misconfiguration, not
    // a reason to send more money than was taken.
    assert.equal(refundDue(input({ cleaningFee: 900 })), 400);
});

test('pence do not drift', () => {
    // £33.33 clean on a £99.99 payment, halved: 33.33 + (66.66 / 2) = 66.66.
    assert.equal(refundDue(input({ amountPaid: 99.99, cleaningFee: 33.33 })), 66.66);
});
