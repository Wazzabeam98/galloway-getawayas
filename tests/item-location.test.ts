// Per-item location resolution — a 'both' slot provider's item carries its own
// direction; a single-place provider's items inherit theirs. A 'delivery' item
// is a travelling item (always private).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { itemFulfilment, itemTravels } = require('@/lib/serviceProviders');

// --- itemFulfilment: item's own wins; else the provider's single answer --------

test('a both provider: the item carries its own direction', () => {
    assert.equal(itemFulfilment({ fulfilment: 'collection' }, 'both'), 'collection');
    assert.equal(itemFulfilment({ fulfilment: 'delivery' }, 'both'), 'delivery');
});

test('a both provider with an unanswered item is unresolved (null)', () => {
    assert.equal(itemFulfilment({ fulfilment: null }, 'both'), null);
    assert.equal(itemFulfilment({}, 'both'), null);
});

test('a single-place provider: every item inherits the provider answer', () => {
    assert.equal(itemFulfilment({ fulfilment: null }, 'collection'), 'collection');
    assert.equal(itemFulfilment({ fulfilment: null }, 'delivery'), 'delivery');
    // Even a stray item value is ignored when the provider isn't 'both'? No — the
    // item's own explicit answer still wins; but a single-place provider never
    // writes one, so in practice the item is null and inherits.
    assert.equal(itemFulfilment({ fulfilment: null }, 'delivery'), 'delivery');
});

// --- itemTravels: delivery ⇒ travelling (private, no cap) ----------------------

test('a delivery item travels; a collection item does not', () => {
    assert.equal(itemTravels({ fulfilment: 'delivery' }, 'both'), true);
    assert.equal(itemTravels({ fulfilment: 'collection' }, 'both'), false);
});

test('a whole-listing traveller: every item travels', () => {
    assert.equal(itemTravels({ fulfilment: null }, 'delivery'), true);
    assert.equal(itemTravels({ fulfilment: null }, 'collection'), false);
});

test('an unanswered both item does not yet travel', () => {
    assert.equal(itemTravels({ fulfilment: null }, 'both'), false);
});
