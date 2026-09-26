// The diff-based money for a reservation change: added nights at today's rate,
// removed nights refunded at what was paid, extra-guest fee only for its own
// nights and guests — so an extension or extra guest is never a refund.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeMoney, applyChangePolicy, shorteningNotice } from '../lib/changeMoney';

const noGuestFee = { extraGuestFee: 0, perNightGuestFee: true, oldChargeableGuests: 0, newChargeableGuests: 0, oldPets: 0, newPets: 0, petFee: 0 };

test('adding a night is a CHARGE even when today’s rate is below what was paid', () => {
    // Booked 5 nights at £200 (paid £1000). Add one night; today's rate is £100.
    // A whole-stay re-quote (6 x £100 = £600) would have "refunded" £400 — wrong.
    const paidRate: Record<string, number> = { '2026-11-01': 200, '2026-11-02': 200, '2026-11-03': 200, '2026-11-04': 200, '2026-11-05': 200 };
    const r = changeMoney({
        ...noGuestFee,
        oldNightKeys: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'],
        newNightKeys: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
        paidRate,
        currentRate: { '2026-11-06': 100 },
        oldTotal: 1000,
    });
    assert.equal(r.delta, 100, 'the one added night, at today’s rate — a charge');
    assert.equal(r.newTotal, 1100);
    assert.equal(r.addedNights, 1);
});

test('removing a night refunds what was PAID for that night', () => {
    const paidRate: Record<string, number> = { '2026-11-01': 150, '2026-11-02': 150, '2026-11-03': 150 };
    const r = changeMoney({
        ...noGuestFee,
        oldNightKeys: ['2026-11-01', '2026-11-02', '2026-11-03'],
        newNightKeys: ['2026-11-01', '2026-11-02'],
        paidRate,
        currentRate: {},
        oldTotal: 450,
    });
    assert.equal(r.delta, -150, 'the dropped night comes back at what was paid');
    assert.equal(r.newTotal, 300);
    assert.equal(r.removedNights, 1);
    // The pieces the policy reasons about: a £150 night refund, no fee change.
    assert.equal(r.nightNet, -150);
    assert.equal(r.feeNet, 0);
    assert.equal(r.removedNightsValue, 150, 'what was paid for the dropped night');
});

test('nightNet / feeNet split a date shift and always sum to the delta', () => {
    const paidRate: Record<string, number> = { '2026-11-01': 300, '2026-11-02': 300, '2026-11-03': 300 };
    const r = changeMoney({
        ...noGuestFee,
        oldNightKeys: ['2026-11-01', '2026-11-02', '2026-11-03'], // 3 nights paid £900
        newNightKeys: ['2026-11-10', '2026-11-11'],               // 2 new nights at £110
        paidRate,
        currentRate: { '2026-11-10': 110, '2026-11-11': 110 },
        oldTotal: 900,
    });
    // Added £220, dropped £900 → nightNet −£680; no fee change.
    assert.equal(r.nightNet, -680, 'added nights at today’s rate minus removed at what was paid');
    assert.equal(r.feeNet, 0);
    assert.equal(r.removedNightsValue, 900, 'three removed nights at what was paid');
    assert.equal(r.delta, r.nightNet + r.feeNet, 'nightNet + feeNet === delta');
});

test('kept nights don’t move, whatever today’s rate is', () => {
    const paidRate: Record<string, number> = { '2026-11-01': 120, '2026-11-02': 120 };
    const r = changeMoney({
        ...noGuestFee,
        oldNightKeys: ['2026-11-01', '2026-11-02'],
        newNightKeys: ['2026-11-01', '2026-11-02'],
        paidRate,
        currentRate: { '2026-11-01': 999, '2026-11-02': 999 },
        oldTotal: 240,
    });
    assert.equal(r.delta, 0, 'same nights → no money either way');
    assert.equal(r.newTotal, 240);
});

test('an extra guest is a charge, per night, and never a refund', () => {
    // 3 nights, extra-guest fee £25/night, 2 included → adding a 3rd guest costs
    // £25 x 3 nights.
    const nights = ['2026-11-01', '2026-11-02', '2026-11-03'];
    const paidRate: Record<string, number> = { '2026-11-01': 100, '2026-11-02': 100, '2026-11-03': 100 };
    const r = changeMoney({
        oldNightKeys: nights, newNightKeys: nights, paidRate, currentRate: {},
        oldChargeableGuests: 0, newChargeableGuests: 1,
        extraGuestFee: 25, perNightGuestFee: true, oldPets: 0, newPets: 0, petFee: 0, oldTotal: 300,
    });
    assert.equal(r.delta, 75, '£25 x 1 guest x 3 nights');
    assert.equal(r.newTotal, 375);
});

test('extension AND an extra guest together — still only a charge', () => {
    const paidRate: Record<string, number> = { '2026-11-01': 100, '2026-11-02': 100 };
    const r = changeMoney({
        oldNightKeys: ['2026-11-01', '2026-11-02'],
        newNightKeys: ['2026-11-01', '2026-11-02', '2026-11-03'],
        paidRate, currentRate: { '2026-11-03': 100 },
        oldChargeableGuests: 0, newChargeableGuests: 1,
        extraGuestFee: 25, perNightGuestFee: true, oldPets: 0, newPets: 0, petFee: 0, oldTotal: 200,
    });
    // +£100 for the added night, +£25 x 3 nights for the extra guest.
    assert.equal(r.delta, 175);
    assert.equal(r.newTotal, 375);
    assert.ok(r.delta > 0, 'never a refund');
});

test('a date SHIFT to cheaper nights can still net a refund (correctly)', () => {
    const paidRate: Record<string, number> = { '2026-11-01': 300, '2026-11-02': 300 };
    const r = changeMoney({
        ...noGuestFee,
        oldNightKeys: ['2026-11-01', '2026-11-02'],
        newNightKeys: ['2026-11-10', '2026-11-11'],
        paidRate,
        currentRate: { '2026-11-10': 100, '2026-11-11': 100 },
        oldTotal: 600,
    });
    // Refund both £300 nights, charge two £100 nights → −£400.
    assert.equal(r.delta, -400);
    assert.equal(r.newTotal, 200);
});

// The cancellation policy folded into a change's money. It touches ONLY a net
// loss of nights: a date move (same or more nights) settles in full, and only
// nights given back on net are scaled by `fraction`.
const drop1 = { nightNet: -150, feeNet: 0, addedNights: 0, removedNights: 1 };
const drop300 = { nightNet: -300, feeNet: 0, addedNights: 0, removedNights: 1 };

test('applyChangePolicy at fraction 1 is the plain diff', () => {
    // Pure shortening, full refund.
    assert.deepEqual(applyChangePolicy(450, drop1, 1), { delta: -150, newTotal: 300 });
    // Free window / host-proposed on a £900 stay dropped to £600.
    assert.deepEqual(applyChangePolicy(900, drop300, 1), { delta: -300, newTotal: 600 });
});

test('applyChangePolicy at 50% refunds half the net-lost nights, host keeps the rest', () => {
    // £900 stay, £300 of nights dropped on net, Limited within its window (0.5):
    // the guest gets £150 back and the booking total settles at £750.
    assert.deepEqual(applyChangePolicy(900, drop300, 0.5), { delta: -150, newTotal: 750 });
});

test('applyChangePolicy at 0 refunds nothing (Firm/Moderate past the window)', () => {
    assert.deepEqual(applyChangePolicy(900, drop300, 0), { delta: 0, newTotal: 900 });
});

test('applyChangePolicy leaves an increase alone (nothing to scale)', () => {
    // Pure extension: £100 charged, no nights lost — fraction is irrelevant.
    assert.deepEqual(
        applyChangePolicy(1000, { nightNet: 100, feeNet: 0, addedNights: 1, removedNights: 0 }, 0),
        { delta: 100, newTotal: 1100 },
    );
});

test('a date MOVE never carries a cancellation penalty, whatever the fraction', () => {
    // Same night count moved onto PRICIER nights: charge the difference, in full.
    assert.deepEqual(
        applyChangePolicy(320, { nightNet: 40, feeNet: 0, addedNights: 2, removedNights: 2 }, 0),
        { delta: 40, newTotal: 360 },
    );
    // Same count moved onto CHEAPER nights: refund the difference IN FULL — the
    // old code (scaling every removed night) wrongly charged the guest here.
    assert.deepEqual(
        applyChangePolicy(600, { nightNet: -40, feeNet: 0, addedNights: 2, removedNights: 2 }, 0),
        { delta: -40, newTotal: 560 },
    );
    // Lengthening onto cheaper nights (more nights, lower net): still a move, full.
    assert.deepEqual(
        applyChangePolicy(600, { nightNet: -40, feeNet: 0, addedNights: 3, removedNights: 2 }, 0),
        { delta: -40, newTotal: 560 },
    );
});

test('applyChangePolicy scales only the NET-lost nights of a mixed shift', () => {
    // Add £100 of nights, drop £300 of nights (net loss of nights, net refund
    // £200), refunded at 50%: the added night nets one dropped night at par, and
    // only the £200 net loss is scaled → £100 back. delta = −£100.
    assert.deepEqual(
        applyChangePolicy(900, { nightNet: -200, feeNet: 0, addedNights: 1, removedNights: 3 }, 0.5),
        { delta: -100, newTotal: 800 },
    );
    // At fraction 0 the net loss forfeits entirely, so the move nets to zero — the
    // guest neither pays for the added night nor is refunded the dropped ones.
    assert.deepEqual(
        applyChangePolicy(900, { nightNet: -200, feeNet: 0, addedNights: 1, removedNights: 3 }, 0),
        { delta: 0, newTotal: 900 },
    );
});

test('dropping nights but paying MORE overall is a charge, never penalised', () => {
    // Drop 3 cheap nights, add 1 dear one: fewer nights but nightNet is +£110.
    // Nothing to refund, so the policy has nothing to bite on.
    assert.deepEqual(
        applyChangePolicy(500, { nightNet: 110, feeNet: 0, addedNights: 1, removedNights: 3 }, 0),
        { delta: 110, newTotal: 610 },
    );
});

test('fees settle in full — a fee change is not a loss of nights', () => {
    // Pet dropped, no night change: the £40 fee comes back whole even at 0.
    assert.deepEqual(
        applyChangePolicy(240, { nightNet: 0, feeNet: -40, addedNights: 0, removedNights: 0 }, 0),
        { delta: -40, newTotal: 200 },
    );
});

// The plain-language warning shown before a guest sends a shortening.
test('shorteningNotice warns only a guest losing nights for less than full', () => {
    const netLoss = { nightNet: -300, addedNights: 0, removedNights: 2 };
    assert.equal(
        shorteningNotice(netLoss, 0, 'Firm'),
        'Under the Firm policy you won’t get a refund for the nights you drop.',
    );
    assert.equal(
        shorteningNotice(netLoss, 0.5, 'Limited'),
        'Under the Limited policy you’ll only get 50% back on the nights you drop — you forfeit £150.00.',
    );
    // Full refund (free window / host-proposed) → nothing to warn about.
    assert.equal(shorteningNotice(netLoss, 1, 'Firm'), null);
    // A move (no net loss of nights) → nothing to warn about.
    assert.equal(shorteningNotice({ nightNet: -40, addedNights: 2, removedNights: 2 }, 0, 'Firm'), null);
    // An increase → nothing to warn about.
    assert.equal(shorteningNotice({ nightNet: 120, addedNights: 1, removedNights: 0 }, 0, 'Firm'), null);
});

test('pets: the per-stay fee is gained when they appear, refunded when they go', () => {
    const nights = ['2026-11-01', '2026-11-02'];
    const paid: Record<string, number> = { '2026-11-01': 100, '2026-11-02': 100 };
    const add = changeMoney({ oldNightKeys: nights, newNightKeys: nights, paidRate: paid, currentRate: {}, oldChargeableGuests: 0, newChargeableGuests: 0, extraGuestFee: 0, perNightGuestFee: true, oldPets: 0, newPets: 1, petFee: 40, oldTotal: 200 });
    assert.equal(add.delta, 40, 'a pet arrives → the £40 fee is charged once');
    const remove = changeMoney({ oldNightKeys: nights, newNightKeys: nights, paidRate: paid, currentRate: {}, oldChargeableGuests: 0, newChargeableGuests: 0, extraGuestFee: 0, perNightGuestFee: true, oldPets: 2, newPets: 0, petFee: 40, oldTotal: 240 });
    assert.equal(remove.delta, -40, 'pets go → the £40 fee comes back');
});
