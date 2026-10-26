// Guest-selectable paid extras on an experience/service order. The money rules,
// pinned:
//   * an extra is priced from the catalogue, per booking or per person;
//   * per person is charged once for each guest on the order;
//   * a selection can only ever buy a live extra, up to its cap;
//   * the VAT treatment rides on the frozen line;
//   * commission is taken on it exactly as on the experience (handled in the
//     payout cron, not here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveProviderSelection, priceProviderExtras, providerExtraProblem, parseFrozenExtras,
    type ProviderExtra,
} from '../lib/providerExtras';

const SAUNA: ProviderExtra = { id: 'sauna', label: 'Sauna pack', price: 15, unit: 'booking', vat_treatment: 'standard', active: true };
const CLUB: ProviderExtra = { id: 'club', label: 'Club hire', price: 5, unit: 'person', vat_treatment: 'standard', active: true };
const HAMPER: ProviderExtra = { id: 'hamper', label: 'Hamper', price: 20, unit: 'booking', vat_treatment: 'zero', active: true };
const CAPPED: ProviderExtra = { id: 'cap', label: 'Towel', price: 3, unit: 'booking', vat_treatment: 'standard', active: true, max_qty: 2 };

test('a per-booking extra is charged once, whatever the party size', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'sauna', qty: 1 }], [SAUNA]);
    const { lines, total } = priceProviderExtras(resolved, 4);
    assert.equal(total, 15);
    assert.equal(lines[0].units, 1);
    assert.equal(lines[0].lineTotal, 15);
});

test('a per-person extra is charged once for each guest on the order', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'club', qty: 1 }], [CLUB]);
    const { lines, total } = priceProviderExtras(resolved, 4); // £5 × 4 guests
    assert.equal(total, 20);
    assert.equal(lines[0].units, 4);
});

test('quantity multiplies a per-person line', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'club', qty: 3 }], [CLUB]);
    const { total } = priceProviderExtras(resolved, 2); // £5 × 2 guests × 3
    assert.equal(total, 30);
});

test('a party of one still pays for one on a per-person extra', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'club', qty: 1 }], [CLUB]);
    assert.equal(priceProviderExtras(resolved, 0).total, 5); // floors to 1 guest
    assert.equal(priceProviderExtras(resolved, 1).total, 5);
});

test('resolveProviderSelection never trusts a browser price, and drops anything not live', () => {
    const selection: any = [
        { extra_id: 'sauna', qty: 1, price: 1 }, // price ignored
        { extra_id: 'ghost', qty: 1 },           // unknown
        { extra_id: 'off', qty: 1 },             // inactive
        { extra_id: 'sauna', qty: 0 },           // zero qty
    ];
    const catalogue: ProviderExtra[] = [SAUNA, { id: 'off', label: 'Hidden', price: 99, unit: 'booking', vat_treatment: 'standard', active: false }];
    const resolved = resolveProviderSelection(selection, catalogue);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, 'sauna');
    assert.equal(resolved[0].unitPrice, 15);
});

test('a tampered quantity is clamped to the extra\'s cap', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'cap', qty: 99 }], [CAPPED]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].qty, 2);
});

test('the VAT treatment is preserved on the frozen line', () => {
    const resolved = resolveProviderSelection([{ extra_id: 'sauna', qty: 1 }, { extra_id: 'hamper', qty: 1 }], [SAUNA, HAMPER]);
    const { lines } = priceProviderExtras(resolved, 2);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    assert.equal(byId.sauna.vat_treatment, 'standard');
    assert.equal(byId.hamper.vat_treatment, 'zero');
});

test('the frozen metadata round-trips into the stamped breakdown', () => {
    // What the order route pricing produces → the compact string it freezes →
    // what requestOrder rebuilds. A per-person line (£8 × 4 guests) and a
    // per-booking line (£15 × 1), with the labels re-read from the catalogue.
    const resolved = resolveProviderSelection([{ extra_id: 'club', qty: 1 }, { extra_id: 'sauna', qty: 1 }], [CLUB, SAUNA]);
    const { lines } = priceProviderExtras(resolved, 4);
    const frozen = lines.map((l) => [l.id, l.qty, l.unit, l.units, l.unitPrice, l.vat_treatment].join(':')).join(',');

    const labels = { club: 'Club hire', sauna: 'Sauna pack' };
    const { breakdown, selection, total } = parseFrozenExtras(frozen, labels);

    assert.equal(total, 35); // £5×4 + £15
    const byId = Object.fromEntries(breakdown.map((l) => [l.id, l]));
    assert.equal(byId.club.label, 'Club hire');
    assert.equal(byId.club.unit, 'person');
    assert.equal(byId.club.units, 4);
    assert.equal(byId.club.lineTotal, 20);
    assert.equal(byId.sauna.lineTotal, 15);
    assert.deepEqual(selection, [{ extra_id: 'club', qty: 1 }, { extra_id: 'sauna', qty: 1 }]);
});

test('parseFrozenExtras falls back to "Extra" for a deleted catalogue row, and empty for none', () => {
    const { breakdown } = parseFrozenExtras('gone:1:booking:1:15:standard', {});
    assert.equal(breakdown[0].label, 'Extra');
    assert.equal(breakdown[0].lineTotal, 15);
    assert.deepEqual(parseFrozenExtras('', {}).breakdown, []);
    assert.deepEqual(parseFrozenExtras(null, {}).breakdown, []);
});

test('providerExtraProblem rejects the bad and passes the good', () => {
    assert.equal(providerExtraProblem({ label: 'Sauna pack', price: 15, unit: 'booking', vat_treatment: 'standard' }), null);
    assert.equal(providerExtraProblem({ label: 'Club hire', price: 5, unit: 'person', vat_treatment: 'standard', max_qty: 4 }), null);
    assert.ok(providerExtraProblem({ label: '', price: 15, unit: 'booking', vat_treatment: 'standard' }));
    assert.ok(providerExtraProblem({ label: 'x', price: 0, unit: 'booking', vat_treatment: 'standard' }));
    assert.ok(providerExtraProblem({ label: 'x', price: 10, unit: 'night', vat_treatment: 'standard' })); // no 'night' for providers
    assert.ok(providerExtraProblem({ label: 'x', price: 10, unit: 'booking', vat_treatment: 'standard', max_qty: 200 }));
});
