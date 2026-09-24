// The diff-based money for a reservation change: added nights at today's rate,
// removed nights refunded at what was paid, extra-guest fee only for its own
// nights and guests — so an extension or extra guest is never a refund.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeMoney } from '../lib/changeMoney';

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

test('pets: the per-stay fee is gained when they appear, refunded when they go', () => {
    const nights = ['2026-11-01', '2026-11-02'];
    const paid: Record<string, number> = { '2026-11-01': 100, '2026-11-02': 100 };
    const add = changeMoney({ oldNightKeys: nights, newNightKeys: nights, paidRate: paid, currentRate: {}, oldChargeableGuests: 0, newChargeableGuests: 0, extraGuestFee: 0, perNightGuestFee: true, oldPets: 0, newPets: 1, petFee: 40, oldTotal: 200 });
    assert.equal(add.delta, 40, 'a pet arrives → the £40 fee is charged once');
    const remove = changeMoney({ oldNightKeys: nights, newNightKeys: nights, paidRate: paid, currentRate: {}, oldChargeableGuests: 0, newChargeableGuests: 0, extraGuestFee: 0, perNightGuestFee: true, oldPets: 2, newPets: 0, petFee: 40, oldTotal: 240 });
    assert.equal(remove.delta, -40, 'pets go → the £40 fee comes back');
});
