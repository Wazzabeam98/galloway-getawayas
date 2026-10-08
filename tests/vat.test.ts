// A host's or provider's VAT number — the one rule the settings form and the
// save route share (lib/vat.ts). What matters: a real UK number in any of the
// ways people type it is accepted and stored one way; a typo is caught before
// it is printed on a guest's receipt; and someone not VAT registered stores
// nothing, so their receipts show nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    vatNumberProblem, normaliseVatNumber, formatVatNumber, checkVatSettings, supplierFromSnapshot,
    vatBreakdown,
} from '../lib/vat';

test('vatBreakdown splits a VAT-inclusive gross into net + VAT that add back to it', () => {
    const b = vatBreakdown(120);
    assert.deepEqual(b, { net: 100, vat: 20, gross: 120 });
    const odd = vatBreakdown(99.99);
    assert.equal(Math.round((odd.net + odd.vat) * 100) / 100, 99.99, 'net + VAT is exactly the price paid');
    assert.equal(vatBreakdown(0).gross, 0);
});

test('a valid number is accepted however it is typed, and stored one way', () => {
    for (const typed of ['GB999999973', 'gb 999 9999 73', '999 9999 73', 'GB-999.9999.73']) {
        assert.equal(vatNumberProblem(typed), null, typed);
        assert.equal(normaliseVatNumber(typed), 'GB999999973', typed);
    }
    assert.equal(formatVatNumber('GB999999973'), 'GB 999 9999 73');
});

test('the newer "+55" check series and Northern Ireland XI numbers pass', () => {
    // 100000034 → weighted 8 + 34 = 42; (42 + 55) % 97 === 0
    assert.equal(vatNumberProblem('GB100000034'), null);
    assert.equal(vatNumberProblem('XI 999 9999 73'), null);
});

test('branch, government and health-authority numbers follow HMRC', () => {
    assert.equal(vatNumberProblem('GB999999973001'), null);
    assert.equal(formatVatNumber('GB999999973001'), 'GB 999 9999 73 001');
    assert.equal(vatNumberProblem('GBGD001'), null);
    assert.notEqual(vatNumberProblem('GBGD600'), null);
    assert.equal(vatNumberProblem('GBHA599'), null);
    assert.notEqual(vatNumberProblem('GBHA100'), null);
});

test('a mistyped digit, a wrong length or a foreign prefix is refused', () => {
    assert.notEqual(vatNumberProblem('GB999999974'), null); // one digit off
    assert.notEqual(vatNumberProblem('GB99999997'), null);  // eight digits
    assert.notEqual(vatNumberProblem('DE123456789'), null);
    assert.notEqual(vatNumberProblem(''), null);
});

test('not registered stores nothing, whatever was left in the boxes', () => {
    const r = checkVatSettings({ registered: false, number: 'GB999999973', name: 'Millburn Ltd' });
    assert.deepEqual(r, { ok: true, value: { registered: false, number: null, name: null } });
});

test('registered needs both a valid number and a business name', () => {
    assert.equal(checkVatSettings({ registered: true, number: 'GB999999974', name: 'X' }).ok, false);
    const noName = checkVatSettings({ registered: true, number: 'GB999999973', name: '  ' });
    assert.equal(noName.ok, false);
    assert.equal(!noName.ok && noName.field, 'name');
    const ok = checkVatSettings({ registered: true, number: '999 9999 73', name: ' Millburn Ltd ' });
    assert.deepEqual(ok, { ok: true, value: { registered: true, number: 'GB999999973', name: 'Millburn Ltd' } });
});

test('a receipt shows a supplier only when the snapshot has both halves', () => {
    assert.equal(supplierFromSnapshot(null), null);
    assert.equal(supplierFromSnapshot({ supplier_vat_number: null, supplier_vat_name: null }), null);
    assert.deepEqual(
        supplierFromSnapshot({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Millburn Ltd' }),
        { name: 'Millburn Ltd', vatNumber: 'GB 999 9999 73', noSplit: null },
    );
});

test('the receipt-email line is empty for a non-registered supplier and escapes the name', () => {
    const { supplierVatHtml } = require('../lib/vat');
    assert.equal(supplierVatHtml({ supplier_vat_number: null, supplier_vat_name: null }, 120), '');
    const html = supplierVatHtml({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Burns & <Co>' }, 120);
    assert.ok(html.includes('Burns &amp; &lt;Co&gt;'));
    assert.ok(html.includes('GB 999 9999 73'));
});

test('the receipt-email line breaks the gross into net + VAT @20% + total', () => {
    const { supplierVatHtml } = require('../lib/vat');
    const html = supplierVatHtml({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Millburn Ltd' }, 120);
    assert.ok(html.includes('VAT at 20%'));
    assert.ok(html.includes('&pound;100.00'), 'net');
    assert.ok(html.includes('&pound;20.00'), 'VAT');
    assert.ok(html.includes('&pound;120.00'), 'total equals the price paid');
});

test('zero-rated, exempt or mixed orders name the supplier and number but print no 20% split', () => {
    const { supplierVatHtml } = require('../lib/vat');
    for (const [treatment, words] of [['zero', 'Zero-rated'], ['exempt', 'Exempt from VAT'], ['mixed', 'mixes VAT rates']]) {
        const html = supplierVatHtml({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Millburn Bakes', supplier_vat_treatment: treatment }, 42);
        assert.ok(html.includes('GB 999 9999 73'), treatment);
        assert.ok(html.includes(words), treatment);
        assert.ok(!html.includes('VAT (20%)'), treatment + ' has no 20% split');
    }
    const std = supplierVatHtml({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Millburn Bakes', supplier_vat_treatment: 'standard' }, 42);
    assert.ok(std.includes('VAT (20%)'), 'standard keeps the split');
    assert.ok(std.includes('&pound;42.00'), 'the total is the price paid, nothing added');
});

test('an offering is standard unless the provider says zero or exempt', () => {
    const { normaliseVatTreatment } = require('../lib/vat');
    assert.equal(normaliseVatTreatment(undefined), 'standard');
    assert.equal(normaliseVatTreatment('reduced'), 'standard');
    assert.equal(normaliseVatTreatment('zero'), 'zero');
    assert.equal(normaliseVatTreatment('exempt'), 'exempt');
});

test('nothing kept (a full refund) prints no split', () => {
    const { supplierVatHtml } = require('../lib/vat');
    const html = supplierVatHtml({ supplier_vat_number: 'GB999999973', supplier_vat_name: 'Millburn Ltd' }, 0);
    assert.ok(html.includes('Millburn Ltd'));
    assert.ok(!html.includes('VAT (20%)'));
});
