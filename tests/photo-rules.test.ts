// The listing-photo quality rule: a photo must be at least 1024 × 683 px, in
// either orientation, or it risks looking soft once it fills a gallery. One
// shared rule behind the wizard and the edit screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    photoDimensionProblem,
    MIN_PHOTO_LONG_EDGE,
    MIN_PHOTO_SHORT_EDGE,
    GALLERY_CROP_ASPECT,
    CARD_CROP_ASPECT,
} = require('@/lib/photoRules');

test('the Airbnb floor is 1024 × 683', () => {
    assert.equal(MIN_PHOTO_LONG_EDGE, 1024);
    assert.equal(MIN_PHOTO_SHORT_EDGE, 683);
});

test('a photo at or above the floor passes, landscape or portrait', () => {
    assert.equal(photoDimensionProblem(1024, 683), null);        // exactly the floor
    assert.equal(photoDimensionProblem(683, 1024), null);        // same, portrait
    assert.equal(photoDimensionProblem(4032, 3024), null);       // a phone photo
    assert.equal(photoDimensionProblem(3024, 4032), null);       // portrait phone photo
    assert.equal(photoDimensionProblem(1440, 960), null);        // Airbnb's recommended
});

test('a photo below the floor is refused on either edge', () => {
    // Long edge too short.
    assert.match(photoDimensionProblem(1000, 800) || '', /at least 1024 × 683/);
    // Long edge fine, short edge too short (a thin panorama).
    assert.match(photoDimensionProblem(2000, 600) || '', /at least 1024 × 683/);
    // Both too short.
    assert.match(photoDimensionProblem(640, 480) || '', /at least 1024 × 683/);
});

test('the message names the size they gave, so the fix is obvious', () => {
    const msg = photoDimensionProblem(800, 600) || '';
    assert.match(msg, /800 × 600/);
    assert.match(msg, /too small/);
});

test('the crop aspects are landscape (what a guest actually sees)', () => {
    // Given as CSS aspect-ratio strings; both wider than tall.
    const ratio = (s: string) => { const [w, h] = s.split('/').map((n) => Number(n.trim())); return w / h; };
    assert.ok(ratio(GALLERY_CROP_ASPECT) > 1, 'gallery crop is landscape');
    assert.ok(ratio(CARD_CROP_ASPECT) > 1, 'card crop is landscape');
});
