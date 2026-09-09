// The listing renders a food provider's dietary ticks as chips. A key that has
// been retired from the catalogue (an old seed, or any future change to
// DIETARY_OPTIONS) must be dropped silently, never rendered as a raw string —
// so the page can trust what it's handed rather than what was stored.
//
// serviceProviders reaches other libs by the '@/' alias, so the alias is
// installed before it is required — the pattern the other lib tests use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { knownDietaryOptions, DIETARY_OPTIONS } = require('@/lib/serviceProviders');

test('a retired key is dropped, known keys survive', () => {
    // 'dairy_free', 'food_allergies' and 'nut_aware' have all been removed from
    // the catalogue over successive changes; only the live keys come through.
    const out = knownDietaryOptions(['dairy_free', 'vegan', 'food_allergies', 'gluten_free', 'nut_aware']);
    assert.deepEqual(out, ['vegan', 'gluten_free']);
});

test('unknown junk never comes through', () => {
    assert.deepEqual(knownDietaryOptions(['', 'not_a_key', '123']), []);
});

test('output is in catalogue order, whatever order it arrived in', () => {
    const reversed = DIETARY_OPTIONS.map((o: { key: string }) => o.key).reverse();
    assert.deepEqual(knownDietaryOptions(reversed), DIETARY_OPTIONS.map((o: { key: string }) => o.key));
});

test('an empty answer stays empty (so the listing shows "hasn\'t said")', () => {
    assert.deepEqual(knownDietaryOptions([]), []);
});
