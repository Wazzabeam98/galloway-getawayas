// Fanning out search-map pins that share a spot (lib/pinOffsets + PriceMap).
// The feed is the ~110m-rounded approx coords, so listings at one place stack
// into what looks like one pin; we give each a small fixed pixel offset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { computePinOffsets } = require('@/lib/pinOffsets');

test('a lone pin is not moved — it sits exactly on its point', () => {
    const out = computePinOffsets([{ id: 'a', lat: 55.2, lng: -3.9 }]);
    assert.deepEqual(out['a'], [0, 0]);
});

test('pins far apart are each left on their point', () => {
    const out = computePinOffsets([
        { id: 'a', lat: 55.0, lng: -4.0 },
        { id: 'b', lat: 55.5, lng: -3.5 },
    ]);
    assert.deepEqual(out['a'], [0, 0]);
    assert.deepEqual(out['b'], [0, 0]);
});

test("Hazel's three at one spot are fanned onto a ring, none left on the point", () => {
    const pt = { lat: 55.3978, lng: -3.7817 }; // Wanlockhead, identical approx coords
    const out = computePinOffsets([
        { id: 'a', ...pt },
        { id: 'b', ...pt },
        { id: 'c', ...pt },
    ]);
    const vecs = ['a', 'b', 'c'].map((id) => out[id]);
    // Every pin is moved off the point...
    for (const v of vecs) assert.ok(Math.hypot(v[0], v[1]) > 10, `moved: ${v}`);
    // ...but kept close to it (small, readable fan).
    for (const v of vecs) assert.ok(Math.hypot(v[0], v[1]) <= 44, `close: ${v}`);
    // ...and no two share an offset, so none hides behind another.
    assert.notDeepEqual(vecs[0], vecs[1]);
    assert.notDeepEqual(vecs[1], vecs[2]);
    assert.notDeepEqual(vecs[0], vecs[2]);
    // First of a cluster sits at the top (dx≈0, dy negative = up).
    assert.equal(vecs[0][0], 0);
    assert.ok(vecs[0][1] < 0);
});

test('near-but-not-identical points within ~150m still fan (overlap on screen)', () => {
    // ~90m apart.
    const out = computePinOffsets([
        { id: 'a', lat: 55.3978, lng: -3.7817 },
        { id: 'b', lat: 55.3986, lng: -3.7817 },
    ]);
    assert.notDeepEqual(out['a'], [0, 0]);
    assert.notDeepEqual(out['b'], [0, 0]);
});

test('clustering compares to the first member only — no runaway chain', () => {
    // a–b within 150m, b–c within 150m, but a–c well over 150m: c must NOT be
    // pulled into a's cluster, so three strung-out pins do not collapse to one fan.
    const out = computePinOffsets([
        { id: 'a', lat: 55.4000, lng: -3.9 },
        { id: 'b', lat: 55.4012, lng: -3.9 }, // ~133m from a
        { id: 'c', lat: 55.4024, lng: -3.9 }, // ~133m from b, ~266m from a
    ]);
    // a and b fan; c is far enough from a (the rep) to stand alone.
    assert.notDeepEqual(out['a'], [0, 0]);
    assert.notDeepEqual(out['b'], [0, 0]);
    assert.deepEqual(out['c'], [0, 0]);
});
