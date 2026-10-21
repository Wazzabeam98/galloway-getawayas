// Money must be grouped with commas everywhere — £10,550.12, not £10550.12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { formatGBP, formatGBPAmount, formatPrice } = require('@/lib/formatMoney');

test('formatGBP groups thousands and keeps two decimals', () => {
    assert.equal(formatGBP(10550.12), '£10,550.12');
    assert.equal(formatGBP(1000), '£1,000.00');
    assert.equal(formatGBP(999.5), '£999.50');
    assert.equal(formatGBP(0), '£0.00');
    assert.equal(formatGBP(1234567.899), '£1,234,567.90'); // rounds to 2dp
});

test('formatGBP handles negatives, strings and nullish safely', () => {
    assert.equal(formatGBP(-5), '-£5.00');
    assert.equal(formatGBP('480'), '£480.00');
    assert.equal(formatGBP(null), '£0.00');
    assert.equal(formatGBP(undefined), '£0.00');
    assert.equal(formatGBP(NaN), '£0.00');
});

test('formatGBPAmount is the same number without the £ glyph, for emails', () => {
    assert.equal(formatGBPAmount(10550.12), '10,550.12');
    assert.equal(formatGBPAmount(336), '336.00');
    assert.equal(formatGBPAmount(0), '0.00');
});

test('formatPrice groups thousands but shows pence only when not whole', () => {
    assert.equal(formatPrice(2040), '£2,040');      // the comma, no .00
    assert.equal(formatPrice(180), '£180');
    assert.equal(formatPrice(2040.5), '£2,040.50'); // pence kept when present
    assert.equal(formatPrice(12.5), '£12.50');
    assert.equal(formatPrice('1200'), '£1,200');
    assert.equal(formatPrice(999), '£999');
    assert.equal(formatPrice(-2040), '-£2,040');
    assert.equal(formatPrice(null), '£0');
});
