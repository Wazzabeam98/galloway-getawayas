// The property types: one list read by the picker, the editor, the card line,
// the listing title line, the search filter and admin (lib/propertyTypes.ts).
//
// What matters most is that a type already stored on a live listing keeps
// working. listings.property_type is plain text holding the old plural names
// ('Cottages', 'Cabins & Pods'), so renaming one would quietly turn a live
// cottage into a type nothing recognises.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROPERTY_TYPES,
    pickerTypes,
    propertyTypeLabel,
    describePlace,
    isSiteType,
    addressLineLabel,
} from '../lib/propertyTypes';

const OLD_SIX = ['Cottages', 'Farmhouses', 'Coastal Stays', 'Cabins & Pods', 'Townhouses', 'Luxury Stays'];

test('every type stored before 5 Oct 2026 is still a known type', () => {
    for (const name of OLD_SIX) {
        assert.ok(PROPERTY_TYPES.some((t) => t.name === name), name + ' must stay valid');
    }
});

test('no two types store the same value', () => {
    const names = PROPERTY_TYPES.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
});

test('Airbnb’s list in UK wording, plus the UK holiday types, are all offered', () => {
    const { common, unique } = pickerTypes('');
    const labels = common.concat(unique).map((t) => t.label);
    for (const want of ['Flat/apartment', 'Boat', 'Houseboat', 'Campervan/motorhome', 'Dome', 'Tent', 'Treehouse',
        'Cabin', 'Barn', 'Castle', 'Farm', 'Shepherd’s hut', 'Tiny home', 'Yurt', 'Tower',
        'Static caravan', 'Lodge', 'Glamping pod']) {
        assert.ok(labels.includes(want), want + ' is offered');
    }
    // The rarer ones sit under "Unique stays", not among the everyday types.
    assert.ok(unique.some((t) => t.label === 'Treehouse'));
    assert.ok(!common.some((t) => t.label === 'Treehouse'));
});

test('a legacy type is offered only to the listing that already has it', () => {
    assert.ok(!pickerTypes('').common.some((t) => t.name === 'Coastal Stays'), 'not offered to a new listing');
    assert.equal(pickerTypes('Coastal Stays').common[0].name, 'Coastal Stays', 'shown, selected, on its own listing');
});

test('the card line and the title line read like Airbnb’s', () => {
    assert.equal(propertyTypeLabel('Flat/apartment'), 'Flat');
    assert.equal(propertyTypeLabel('Cottages'), 'Cottage');
    assert.equal(propertyTypeLabel('Farm'), 'Farm stay');
    assert.equal(describePlace('Entire place', 'Flat/apartment'), 'Entire flat');
    assert.equal(describePlace('A private room', 'Static caravan'), 'Private room in a static caravan');
    // Nothing picked, or something unrecognised: the honest generic word.
    assert.equal(describePlace('Entire place', null), 'Entire place');
    assert.equal(propertyTypeLabel(null), null);
    // Every type has every word a surface asks for.
    for (const t of PROPERTY_TYPES) {
        assert.ok(t.label && t.card && t.noun && t.icon, t.name + ' has every word');
    }
});

test('a boat, campervan, tent or pod is asked for its pitch, berth or site name', () => {
    for (const name of ['Boat', 'Houseboat', 'Campervan/motorhome', 'Tent', 'Glamping pod']) {
        assert.ok(isSiteType(name), name + ' is a site type');
        assert.equal(addressLineLabel(name).label, 'Pitch, berth or site name');
    }
    assert.equal(isSiteType('Cottages'), false);
    assert.equal(addressLineLabel('Cottages').label, 'Street address');
});
