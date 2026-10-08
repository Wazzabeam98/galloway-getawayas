// Host-sold optional extras on a stay (Stage 1). The money rules, pinned:
//   * an extra is priced from the catalogue, per stay or per night;
//   * it is added to the total but never discounted;
//   * it carries NO commission (the payout's commissionable base excludes it);
//   * a selection can only ever buy a live extra on the listing;
//   * the VAT treatment rides on the frozen line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteBooking, dateFromKey } from '../lib/pricing';
import { commissionableCollected, feeAmount } from '../lib/fees';
import { resolveSelection, extraProblem, type ListingExtra } from '../lib/listingExtras';

const CHECK_IN = dateFromKey('2026-06-01');   // Mon
const CHECK_OUT = dateFromKey('2026-06-04');  // Thu — 3 nights, no weekend

const BASE: any = {
    price_per_night: 100,
    cleaning_fee: 0,
    pet_fee: 0,
    extra_guest_fee: 0,
    extra_guest_after: 1,
};

const SAUNA: ListingExtra = { id: 'sauna', label: 'Sauna pack', price: 40, unit: 'stay', vat_treatment: 'standard', active: true };
const LOGS: ListingExtra = { id: 'logs', label: 'Log delivery', price: 10, unit: 'night', vat_treatment: 'standard', active: true };
const HAMPER: ListingExtra = { id: 'hamper', label: 'Welcome hamper', price: 25, unit: 'stay', vat_treatment: 'zero', active: true };

function quote(extras: any[]) {
    return quoteBooking(BASE, {}, CHECK_IN, CHECK_OUT, 1, 0, 0, {}, extras);
}

test('no extras leaves the total and the extras fields untouched', () => {
    const q = quote([]);
    assert.equal(q.total, 300);
    assert.equal(q.extrasTotal, 0);
    assert.deepEqual(q.extras, []);
});

test('a per-stay extra is charged once, whatever the nights', () => {
    const q = quote(resolveSelection([{ extra_id: 'sauna', qty: 1 }], [SAUNA]));
    assert.equal(q.extrasTotal, 40);
    assert.equal(q.total, 340);
    assert.equal(q.extras.length, 1);
    assert.equal(q.extras[0].lineTotal, 40);
    assert.equal(q.extras[0].units, 1);
});

test('a per-night extra is charged once per night', () => {
    const q = quote(resolveSelection([{ extra_id: 'logs', qty: 1 }], [LOGS]));
    assert.equal(q.extrasTotal, 30);   // £10 × 3 nights
    assert.equal(q.total, 330);
    assert.equal(q.extras[0].units, 3);
});

test('quantity multiplies the line', () => {
    const q = quote(resolveSelection([{ extra_id: 'logs', qty: 2 }], [LOGS]));
    assert.equal(q.extrasTotal, 60);   // £10 × 3 nights × 2
    assert.equal(q.extras[0].qty, 2);
});

test('extras are added AFTER the discount — a weekly discount never comes off them', () => {
    const q = quoteBooking(
        { ...BASE, weekly_discount: true },
        {},
        dateFromKey('2026-06-01'),
        dateFromKey('2026-06-08'), // 7 nights → 10% weekly on nights only
        1, 0, 0, {},
        resolveSelection([{ extra_id: 'sauna', qty: 1 }], [SAUNA]),
    );
    // nights 700, less 10% = 630; plus the £40 sauna in full.
    assert.ok(q.discount && q.discount.amount === 70);
    assert.equal(q.extrasTotal, 40);
    assert.equal(q.total, 630 + 40);
});

test('the VAT treatment is preserved on the frozen line', () => {
    const q = quote(resolveSelection([{ extra_id: 'sauna', qty: 1 }, { extra_id: 'hamper', qty: 1 }], [SAUNA, HAMPER]));
    const byId = Object.fromEntries(q.extras.map((e) => [e.id, e]));
    assert.equal(byId.sauna.vat_treatment, 'standard');
    assert.equal(byId.hamper.vat_treatment, 'zero');
});

test('resolveSelection never trusts a browser price, and drops anything not live', () => {
    const selection: any = [
        { extra_id: 'sauna', qty: 1, price: 5 },   // price here is ignored
        { extra_id: 'ghost', qty: 1 },             // unknown id
        { extra_id: 'off', qty: 1 },               // inactive
        { extra_id: 'sauna', qty: 0 },             // zero quantity
    ];
    const catalogue: ListingExtra[] = [SAUNA, { id: 'off', label: 'Hidden', price: 99, unit: 'stay', vat_treatment: 'standard', active: false }];
    const resolved = resolveSelection(selection, catalogue);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, 'sauna');
    assert.equal(resolved[0].unitPrice, 40); // the catalogue's price, not 5
});

test('commission is taken on the stay only, never on an extra', () => {
    // £340 collected: £300 stay + £40 extra, at 10%. Commission is 10% of the
    // £300 stay (= £30), not of the £340. The host keeps £310.
    const base = commissionableCollected(340, 340, 40);
    assert.equal(base, 300);
    assert.equal(feeAmount(base, 10), 30);
});

test('commissionableCollected returns the whole figure when there are no extras', () => {
    assert.equal(commissionableCollected(300, 300, 0), 300);
    assert.equal(commissionableCollected(150, 300, 0), 150); // a part-paid booking
});

test('the extras-free share holds under a partial refund, in proportion', () => {
    // £170 collected of a £340 total (half). The extras are still 40/340 of it,
    // so the commissionable part is half of £300 = £150.
    assert.equal(commissionableCollected(170, 340, 40), 150);
});

test('extraProblem rejects the bad and passes the good', () => {
    assert.equal(extraProblem({ label: 'Sauna pack', price: 40, unit: 'stay', vat_treatment: 'standard' }), null);
    assert.ok(extraProblem({ label: '', price: 40, unit: 'stay', vat_treatment: 'standard' }));
    assert.ok(extraProblem({ label: 'x', price: 0, unit: 'stay', vat_treatment: 'standard' }));
    assert.ok(extraProblem({ label: 'x', price: 999999, unit: 'stay', vat_treatment: 'standard' }));
    assert.ok(extraProblem({ label: 'x', price: 10, unit: 'week', vat_treatment: 'standard' }));
    assert.ok(extraProblem({ label: 'x', price: 10, unit: 'stay', vat_treatment: 'reduced' }));
});
