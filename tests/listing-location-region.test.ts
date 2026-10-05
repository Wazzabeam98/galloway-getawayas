// The Region box is gone: every listing is in Dumfries and Galloway, and
// `location` is always "Town, Dumfries and Galloway" — what every page reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingLocation, splitLocation } from '../lib/places';

test('the region is always Dumfries and Galloway', () => {
    assert.equal(listingLocation('Kirkcudbright'), 'Kirkcudbright, Dumfries and Galloway');
    assert.equal(listingLocation('  Castle Douglas '), 'Castle Douglas, Dumfries and Galloway');
});

test('no town means no location, so the publish rule still asks for one', () => {
    assert.equal(listingLocation(''), '');
    assert.equal(listingLocation(null), '');
});

test('the save route normalises whatever region arrives', () => {
    // What /api/listings/save does with a patched location.
    const norm = (loc: string) => listingLocation(splitLocation(loc).town);
    assert.equal(norm('Kirkcudbright, Dumfries & Galloway'), 'Kirkcudbright, Dumfries and Galloway');
    assert.equal(norm('Kirkcudbright, United Kingdom, DG6 4JS, United Kingdom'), 'Kirkcudbright, Dumfries and Galloway');
    assert.equal(norm('Kirkcudbright, Kirkcudbrightshire'), 'Kirkcudbright, Dumfries and Galloway');
    assert.equal(norm('Kirkcudbright, Dumfries and Galloway'), 'Kirkcudbright, Dumfries and Galloway');
});
