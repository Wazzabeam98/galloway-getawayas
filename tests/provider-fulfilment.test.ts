// The made-to-order fulfilment fork: does the provider deliver, does the guest
// collect, or both — and the safety that a returning provider's private
// collection address can't be blanked on save when it hasn't loaded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { submitProblems, collectionAddressForWrite } = require('@/lib/serviceProviders');

// Only the fields this fork owns; other unrelated problems (e.g. a short
// description) are irrelevant here, so assert on presence/absence of these.
const fieldsFor = (d: any) => submitProblems(d).map((p: any) => p.field);
const has = (d: any, f: string) => fieldsFor(d).includes(f);

const mto = (over: any) => ({ trade: 'guest', audience: 'guest', shape: 'made_to_order', ...over });

// --- what's required, by fulfilment ---------------------------------------

test('made-to-order with no fulfilment chosen asks only for the choice', () => {
    const d = mto({ fulfilment: '', areaCount: 0, hasCollectionAddress: false });
    assert.equal(has(d, 'fulfilment'), true, 'the fork must be answered');
    assert.equal(has(d, 'areas'), false, 'no area gate until they say they deliver');
    assert.equal(has(d, 'collection_address'), false, 'no address gate until they say they collect');
});

test('delivery requires an area, not an address', () => {
    assert.equal(has(mto({ fulfilment: 'delivery', areaCount: 0 }), 'areas'), true);
    assert.equal(has(mto({ fulfilment: 'delivery', areaCount: 0 }), 'collection_address'), false);
    const ok = mto({ fulfilment: 'delivery', areaCount: 1 });
    assert.equal(has(ok, 'areas'), false);
    assert.equal(has(ok, 'fulfilment'), false);
});

test('collection requires an address, not an area', () => {
    const missing = mto({ fulfilment: 'collection', areaCount: 0, hasCollectionAddress: false });
    assert.equal(has(missing, 'collection_address'), true);
    assert.equal(has(missing, 'areas'), false, 'a collection-only baker has no region to pick');
    const ok = mto({ fulfilment: 'collection', areaCount: 0, hasCollectionAddress: true });
    assert.equal(has(ok, 'collection_address'), false);
    assert.equal(has(ok, 'areas'), false);
});

test('both requires an area AND an address', () => {
    assert.equal(has(mto({ fulfilment: 'both', areaCount: 0, hasCollectionAddress: true }), 'areas'), true);
    assert.equal(has(mto({ fulfilment: 'both', areaCount: 1, hasCollectionAddress: false }), 'collection_address'), true);
    const ok = mto({ fulfilment: 'both', areaCount: 1, hasCollectionAddress: true });
    assert.equal(has(ok, 'areas'), false);
    assert.equal(has(ok, 'collection_address'), false);
});

test('a slot still requires an area (the fork is made-to-order only)', () => {
    assert.equal(has({ trade: 'guest', audience: 'guest', shape: 'slot', areaCount: 0 }, 'areas'), true);
});

// --- the overwrite safety (the case to prove, not reason about) ------------

test('a not-loaded, untouched collection address is OMITTED — it cannot blank a real one', () => {
    // The dangerous case: a returning collection provider re-opens the wizard,
    // their private address did NOT load (loaded:false), they type nothing, and
    // they save. The write must send NOTHING for collection_address so the stored
    // address stands — undefined omits the key from the PATCH.
    assert.equal(
        collectionAddressForWrite({ collects: true, loaded: false, value: '' }),
        undefined,
        'not loaded + empty must omit the column, never write null over a real address',
    );
    // Even if they had it loaded and cleared it, that IS authoritative → null.
    assert.equal(collectionAddressForWrite({ collects: true, loaded: true, value: '' }), null);
    // A typed value writes, loaded or not.
    assert.equal(collectionAddressForWrite({ collects: true, loaded: false, value: '  12 Shore Rd  ' }), '12 Shore Rd');
    assert.equal(collectionAddressForWrite({ collects: true, loaded: true, value: '12 Shore Rd' }), '12 Shore Rd');
    // Not collecting clears it — but only once we can safely touch it (loaded, or
    // they typed); a not-loaded delivery-only save still omits rather than nulls.
    assert.equal(collectionAddressForWrite({ collects: false, loaded: true, value: '' }), null);
    assert.equal(collectionAddressForWrite({ collects: false, loaded: false, value: '' }), undefined);
});
