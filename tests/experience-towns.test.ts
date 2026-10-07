// Which experiences a town page shows (lib/experienceTowns): all of D&G on every
// town; a region's providers on that region's towns only; a provider based at a
// place on that town's page; nothing for a radius label. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();
const { servesTown, regionKeysOf, REGION_FOR_AREA } = require('../lib/experienceTowns');
const { AREAS } = require('../config/areas');

const area = (slug: string) => AREAS.find((a: any) => a.slug === slug);

test('every town page has a region', () => {
    for (const a of AREAS) assert.ok(REGION_FOR_AREA[a.slug], a.slug + ' has no region');
});

test('covers all of Dumfries & Galloway → on every town page', () => {
    const chef = { shape: 'comes_to_you', areas: ['All of Dumfries & Galloway'], based_line: 'Kirkcudbright' };
    for (const a of AREAS) assert.equal(servesTown(chef, a), true, a.slug);
});

test('covers certain regions → only on those regions’ towns', () => {
    const chef = { shape: 'comes_to_you', areas: ['The Stewartry', 'The Rhins'], based_line: 'Castle Douglas' };
    const on = AREAS.filter((a: any) => servesTown(chef, a)).map((a: any) => a.slug).sort();
    assert.deepEqual(on, ['castle-douglas', 'dalbeattie', 'gatehouse-of-fleet', 'kirkcudbright', 'portpatrick', 'stranraer']);
});

test('based in one place → on that town’s page only', () => {
    const sauna = { shape: 'slot', fulfilment: 'collection', areas: ['Kirkcudbright'], based_line: 'Kirkcudbright' };
    const on = AREAS.filter((a: any) => servesTown(sauna, a)).map((a: any) => a.slug);
    assert.deepEqual(on, ['kirkcudbright']);
    // Spelling and case don't matter: townKey is the same rule the listings use.
    assert.equal(servesTown({ shape: 'slot', based_line: 'gatehouse of fleet' }, area('gatehouse-of-fleet')), true);
});

test('a provider who only travels is placed by where they go, not their base', () => {
    const baker = { shape: 'made_to_order', fulfilment: 'delivery', areas: ['The Machars'], based_line: 'Kirkcudbright' };
    assert.equal(servesTown(baker, area('kirkcudbright')), false);
    assert.equal(servesTown(baker, area('wigtown')), true);
    // Studio and travels ("Both"): their town AND their regions.
    const both = { shape: 'slot', fulfilment: 'both', areas: ['Dumfries & Nithsdale'], based_line: 'Moffat' };
    assert.equal(servesTown(both, area('moffat')), true);
    assert.equal(servesTown(both, area('dumfries')), true);
    assert.equal(servesTown(both, area('stranraer')), false);
});

test('a legacy radius label or nothing at all puts a provider nowhere', () => {
    assert.deepEqual(regionKeysOf(['Kirkcudbright and 25 miles']), []);
    const legacy = { shape: 'comes_to_you', areas: ['Kirkcudbright and 25 miles'], based_line: null };
    for (const a of AREAS) assert.equal(servesTown(legacy, a), false, a.slug);
});

test('a property page uses its town’s rule — or, in a village, the nearest town’s region', () => {
    const { experienceAreaForListing } = require('../lib/experienceTowns');
    // In a town: that town page's area, exactly.
    const inTown = experienceAreaForListing('Castle Douglas, Dumfries and Galloway', 54.94, -3.93);
    assert.equal(inTown.slug, 'castle-douglas');
    // In a village (Borgue, ~5 miles from Kirkcudbright): Kirkcudbright's region,
    // and a provider based in Borgue itself still counts as based there.
    const village = experienceAreaForListing('Borgue, Dumfries and Galloway', 54.80, -4.13);
    assert.equal(village.slug, 'kirkcudbright');
    assert.equal(servesTown({ shape: 'comes_to_you', areas: ['The Stewartry'] }, village), true);
    assert.equal(servesTown({ shape: 'comes_to_you', areas: ['The Rhins'] }, village), false);
    assert.equal(servesTown({ shape: 'slot', based_line: 'Borgue' }, village), true);
    assert.equal(servesTown({ shape: 'slot', based_line: 'Castle Douglas' }, village), false);
    // No town and no point: nothing to match against.
    assert.equal(experienceAreaForListing('Somewhere', null, null), null);
});
