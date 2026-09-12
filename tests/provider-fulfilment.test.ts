// The made-to-order fulfilment fork: does the provider deliver, does the guest
// collect, or both — and the safety that a returning provider's private
// collection address can't be blanked on save when it hasn't loaded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { submitProblems, collectionFieldsForWrite } = require('@/lib/serviceProviders');

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

// A slot uses the fulfilment fork now, the same as made-to-order: a come-to-me
// slot (collection) needs an ADDRESS and no region; a travelling slot (delivery)
// needs a region and no address. So "a slot always requires an area" is no
// longer true — it depends on the fork.
test('a come-to-me slot requires an address, not a region', () => {
    const slot = (over: any) => ({ trade: 'guest', audience: 'guest', shape: 'slot', scheduleCount: 1, pricedItemCount: 1, ...over });
    const missing = slot({ fulfilment: 'collection', areaCount: 0, hasCollectionAddress: false });
    assert.equal(has(missing, 'collection_address'), true, 'come-to-me needs its address');
    assert.equal(has(missing, 'areas'), false, 'come-to-me has no region to pick');
    const ok = slot({ fulfilment: 'collection', areaCount: 0, hasCollectionAddress: true });
    assert.equal(has(ok, 'collection_address'), false);
    assert.equal(has(ok, 'areas'), false);
});

test('a travelling slot requires a region, not an address', () => {
    const slot = (over: any) => ({ trade: 'guest', audience: 'guest', shape: 'slot', scheduleCount: 1, pricedItemCount: 1, ...over });
    assert.equal(has(slot({ fulfilment: 'delivery', areaCount: 0 }), 'areas'), true);
    assert.equal(has(slot({ fulfilment: 'delivery', areaCount: 0 }), 'collection_address'), false);
    const ok = slot({ fulfilment: 'delivery', areaCount: 1 });
    assert.equal(has(ok, 'areas'), false);
});

// --- the per-person slot minimum ≤ capacity --------------------------------
//
// The wizard's stepper caps the minimum at the capacity, but the rule is
// enforced in submitProblems too, so a crafted/edited draft can't send a
// minimum a session could never satisfy. Only a per-person slot has a minimum
// (a shared table); a private hire is one booking whatever
// the head count, so the rule never applies to it. A minimum of 1 is no minimum.
const slot = (over: any) => ({ trade: 'guest', audience: 'guest', shape: 'slot', slotOffer: 'shared', areaCount: 1, scheduleCount: 1, pricedItemCount: 1, ...over });

test('a per-person minimum above the capacity is a problem', () => {
    assert.equal(has(slot({ slotCapacity: 4, slotMinPeople: 6 }), 'slot_min'), true, 'min 6 with room for 4 is unbookable');
    // At or below the ceiling is fine.
    assert.equal(has(slot({ slotCapacity: 6, slotMinPeople: 6 }), 'slot_min'), false, 'min equal to capacity is allowed');
    assert.equal(has(slot({ slotCapacity: 8, slotMinPeople: 4 }), 'slot_min'), false, 'min below capacity is allowed');
});

test('a minimum of 1 (or blank) is no minimum and never trips the rule', () => {
    assert.equal(has(slot({ slotCapacity: 4, slotMinPeople: 1 }), 'slot_min'), false);
    assert.equal(has(slot({ slotCapacity: 4, slotMinPeople: '' }), 'slot_min'), false);
    assert.equal(has(slot({ slotCapacity: 4 }), 'slot_min'), false, 'no minimum set at all');
});

test('the minimum rule applies only to a per-person slot', () => {
    // A private/whole-group slot: one booking whatever the head count, so a
    // stray high slotMinPeople must not be treated as a rule.
    assert.equal(has(slot({ slotOffer: 'private', slotCapacity: 2, slotMinPeople: 6 }), 'slot_min'), false, 'private slot has no minimum rule');
    // A made-to-order product isn't a slot at all.
    assert.equal(has({ trade: 'guest', audience: 'guest', shape: 'made_to_order', slotOffer: 'shared', slotCapacity: 2, slotMinPeople: 6, fulfilment: 'delivery', areaCount: 1, pricedItemCount: 1 }, 'slot_min'), false, 'made-to-order has no minimum rule');
});

// --- the overwrite safety (the case to prove, not reason about) ------------

const NOTHING = { street: '', town: '', postcode: '' };
const ADDR = { street: '4 Shore Road', town: 'Kirkcudbright', postcode: 'DG6 4JT' };

test('a not-loaded, untouched collection address is OMITTED — it cannot blank a real one', () => {
    // The dangerous case: a returning collection provider re-opens the wizard,
    // their private address did NOT load (loaded:false), they type nothing, and
    // they save. The write must send NOTHING for the collection fields so the
    // stored address stands — undefined omits every key from the PATCH.
    assert.equal(
        collectionFieldsForWrite({ collects: true, loaded: false, ...NOTHING }),
        undefined,
        'not loaded + all empty must omit the columns, never write null over a real address',
    );
    // A not-loaded delivery-only save (not collecting) still omits rather than
    // nulling — same protection.
    assert.equal(collectionFieldsForWrite({ collects: false, loaded: false, ...NOTHING }), undefined);
});

test('collecting writes the three fields and derives based_line from the town (town alone)', () => {
    const out = collectionFieldsForWrite({ collects: true, loaded: true, ...ADDR });
    assert.deepEqual(out, {
        collection_street: '4 Shore Road',
        collection_town: 'Kirkcudbright',
        collection_postcode: 'DG6 4JT',
        based_line: 'Kirkcudbright',  // the town alone — everything is in D&G, so no region
    });
    // A typed value writes even when the private read hadn't loaded (it isn't the
    // all-empty case, so the safety doesn't apply).
    const typedUnloaded = collectionFieldsForWrite({ collects: true, loaded: false, ...ADDR });
    assert.equal(typedUnloaded && typedUnloaded.collection_street, '4 Shore Road');
    assert.equal(typedUnloaded && typedUnloaded.based_line, 'Kirkcudbright');
});

test('not collecting clears the private fields and the public based_line with them', () => {
    // Loaded (or typed) so it is safe to touch: a delivery-only save nulls all
    // four, so a provider who stops collecting loses the collection address and
    // its public location together.
    assert.deepEqual(collectionFieldsForWrite({ collects: false, loaded: true, ...NOTHING }), {
        collection_street: null, collection_town: null, collection_postcode: null, based_line: null,
    });
});

test('based_line is the town only, never the town plus a region', () => {
    const out = collectionFieldsForWrite({ collects: true, loaded: true, street: '1 High St', town: 'Dumfries', postcode: 'DG1 1AA' });
    assert.equal(out && out.based_line, 'Dumfries');
});
