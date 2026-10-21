// The home search's "Where" dropdown lists exactly the "Holiday Lets by town"
// areas, A to Z after "Anywhere", and searching one uses the area's own rule
// (21 Oct 2026). A hard-coded town list let a guest pick a town with nothing in
// it, and left Galloway Forest — a region matched by map circle — out entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { AREAS, listingInArea, areaBySlug } = require('../config/areas');

test('the dropdown is "Anywhere" then the tiles\' areas, sorted — no list of its own', () => {
    const hero = read('components/base/Hero.tsx');
    assert.match(hero, /const LOCATIONS = \[ANYWHERE, \.\.\.places\]/);
    assert.doesNotMatch(hero, /value: 'kirkcudbright'/, 'no hard-coded towns in the hero');
    const page = read('app/page.tsx');
    assert.match(page, /const wherePlaces = areaLinks\s*\.map/, 'built from the tiles\' own list');
    assert.match(page, /localeCompare/, 'alphabetical');
    assert.match(page, /<Hero places=\{wherePlaces\} \/>/);
});

test('searching an area uses listingInArea, so Galloway Forest finds its cottages', () => {
    assert.match(read('components/HomeShop.tsx'), /listingInArea\(area, /);
    const forest = areaBySlug('galloway-forest');
    assert.ok(forest, 'Galloway Forest is an area');
    // The Dark Sky Dome's approximate point (Straiton), inside the forest circle.
    assert.equal(listingInArea(forest, { location: 'Straiton, Dumfries and Galloway', approx_latitude: 55.26, approx_longitude: -4.53 }), true);
    assert.ok(AREAS.length > 0);
});
