// Which charge a payout is drawn from.
//
// The bug this exists to prevent is not visible in test mode and is invisible
// in the code: a transfer with no source_transaction comes out of the
// platform's AVAILABLE balance, card money sits in PENDING for about a week,
// and the payout engine runs the day after check-in. A guest who paid days
// before arriving is therefore paid out of money that has not settled. It
// fails balance_insufficient, and the host is not paid when we said.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chargeToDrawOn } = require('../lib/payoutSource');

test('a stay paid in full is drawn from the charge that paid for it', () => {
    // £400 taken, £360 going out after 10%. The one charge covers it.
    assert.equal(chargeToDrawOn([{ id: 'ch_full', amount: 40000 }], 36000), 'ch_full');
});

test('the smallest charge that covers the payout is the one used', () => {
    // Any covering charge works. Taking the smallest leaves the larger ones
    // free for other bookings — a charge can only be drawn down to zero across
    // every transfer that names it.
    const charges = [
        { id: 'ch_big', amount: 90000 },
        { id: 'ch_just_enough', amount: 36000 },
        { id: 'ch_middling', amount: 50000 },
    ];
    assert.equal(chargeToDrawOn(charges, 36000), 'ch_just_enough');
});

test('a charge that cannot cover the payout is never named', () => {
    // Stripe refuses a transfer larger than the charge it names, and a refusal
    // here would stop the host being paid at all — worse than the untied
    // transfer this falls back to.
    assert.equal(chargeToDrawOn([{ id: 'ch_small', amount: 1000 }], 36000), null);
});

// THE CASE THAT FALLS BACK, AND WHY IT IS THE SAFE ONE.
//
// A deposit and then a balance is two charges, and one transfer may name only
// one of them. The host's 90% share is bigger than either half, so nothing
// covers it. That is fine: a balance is charged thirty days before check-in
// and a deposit earlier still, so both have settled long before payout. The
// pending problem belongs to late bookings paid in one go — which is exactly
// the shape a single charge can cover.
test('a deposit and a balance find nothing to name, and say so', () => {
    const charges = [
        { id: 'ch_deposit', amount: 10000 },
        { id: 'ch_balance', amount: 30000 },
    ];
    assert.equal(chargeToDrawOn(charges, 36000), null);
});

test('nothing is named when there are no charges to name', () => {
    assert.equal(chargeToDrawOn([], 36000), null);
    assert.equal(chargeToDrawOn([null, undefined], 36000), null);
    assert.equal(chargeToDrawOn(null as any, 36000), null);
});

test('a charge that exactly covers the payout is good enough', () => {
    // Stripe allows a transfer equal to the charge, so > would have been wrong
    // and would have sent an exactly-covered payout down the untied path.
    assert.equal(chargeToDrawOn([{ id: 'ch_exact', amount: 36000 }], 36000), 'ch_exact');
});

test('a payout of nothing draws on nothing', () => {
    // A fully withheld payout sends no transfer at all, so there is nothing to
    // tie — and naming a charge for a zero transfer would be a Stripe error
    // rather than a no-op.
    assert.equal(chargeToDrawOn([{ id: 'ch_full', amount: 40000 }], 0), null);
    assert.equal(chargeToDrawOn([{ id: 'ch_full', amount: 40000 }], -100), null);
});
