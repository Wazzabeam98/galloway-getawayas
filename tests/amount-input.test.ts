// The editor's money and number boxes: "£0" typed over must never become
// "£030", an empty box saves as nothing, and a stored 0 shows as an empty box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAmountInput, amountForBox, amountOrNull, amountOrZero } from '../lib/amountInput';

test('a leading zero never survives in front of another digit', () => {
    assert.equal(cleanAmountInput('030'), '30');
    assert.equal(cleanAmountInput('0030'), '30');
    assert.equal(cleanAmountInput('00'), '0');
    assert.equal(cleanAmountInput('0'), '0');
    assert.equal(cleanAmountInput('0.5'), '0.5');
    assert.equal(cleanAmountInput('.5'), '0.5');
});

test('money keeps one point and two pence digits; whole numbers keep none', () => {
    assert.equal(cleanAmountInput('12.345'), '12.34');
    assert.equal(cleanAmountInput('1.2.3'), '1.23');
    assert.equal(cleanAmountInput('£30'), '30');
    assert.equal(cleanAmountInput('4.5', false), '45');
    assert.equal(cleanAmountInput('04', false), '4');
});

test('a stored 0 or nothing shows as an empty box', () => {
    assert.equal(amountForBox(0), '');
    assert.equal(amountForBox('0'), '');
    assert.equal(amountForBox(null), '');
    assert.equal(amountForBox(undefined), '');
    assert.equal(amountForBox(30), '30');
    assert.equal(amountForBox('12.5'), '12.5');
});

test('an empty, zero or unreadable box saves as nothing', () => {
    assert.equal(amountOrNull(''), null);
    assert.equal(amountOrNull('0'), null);
    assert.equal(amountOrNull('.'), null);
    assert.equal(amountOrNull('030'), 30);
    assert.equal(amountOrNull('12.50'), 12.5);
});

test('a fee column (NOT NULL) saves an emptied box as 0, never null', () => {
    assert.equal(amountOrZero(''), 0);
    assert.equal(amountOrZero('0'), 0);
    assert.equal(amountOrZero('30'), 30);
    // ...and 0 reopens as an empty box.
    assert.equal(amountForBox(amountOrZero('')), '');
});
