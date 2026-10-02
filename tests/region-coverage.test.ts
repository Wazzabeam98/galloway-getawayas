// A trade's coverage is read from the ticked regions ("The Stewartry", "All of
// Dumfries & Galloway"), never the legacy "town and N miles" radius, and never the
// same region twice. regionCoverageLine is the one reader shared by the marketplace
// card and the public trade profile, so this guards both at once. The public
// profile was showing "Wigtown and 25 miles" twice — a radius, duplicated — which
// this rules out. Decision of 30 September 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { regionCoverageLine, namedRegions } = require('@/components/marketplace/present');

test('lists the ticked regions, joined for reading', () => {
    assert.equal(regionCoverageLine(['The Machars', 'The Stewartry']), 'The Machars & The Stewartry');
    assert.equal(
        regionCoverageLine(['The Rhins', 'The Machars', 'The Stewartry']),
        'The Rhins, The Machars & The Stewartry',
    );
    assert.equal(regionCoverageLine(['All of Dumfries & Galloway']), 'All of Dumfries & Galloway');
});

test('drops a legacy "town and N miles" radius label entirely', () => {
    assert.equal(regionCoverageLine(['Wigtown and 25 miles']), null);
    assert.equal(regionCoverageLine(['Wigtown and 25 miles', 'The Machars']), 'The Machars');
});

test('never shows the same region twice, even when the rows are duplicated', () => {
    assert.equal(regionCoverageLine(['Wigtown and 25 miles', 'Wigtown and 25 miles']), null);
    assert.equal(regionCoverageLine(['The Stewartry', 'The Stewartry']), 'The Stewartry');
});

test('empty or blank labels leave no coverage line', () => {
    assert.equal(regionCoverageLine([]), null);
    assert.equal(regionCoverageLine(['', '   ', null, undefined]), null);
});

test('namedRegions reads the same way off a provider', () => {
    assert.equal(namedRegions({ areas: ['The Stewartry', 'The Stewartry'] }), 'The Stewartry');
});
