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

test("Hazel's three at one spot cascade into a small centred fan", () => {
    const pt = { lat: 55.3978, lng: -3.7817 }; // Wanlockhead, identical approx coords
    const out = computePinOffsets([
        { id: 'a', ...pt },
        { id: 'b', ...pt },
        { id: 'c', ...pt },
    ]);
    const vecs = ['a', 'b', 'c'].map((id) => out[id]);
    // The fan is centred on the true point: the offsets sum to zero, so the
    // group never drifts off to look like it is outside the town.
    assert.deepEqual([vecs[0][0] + vecs[1][0] + vecs[2][0], vecs[0][1] + vecs[1][1] + vecs[2][1]], [0, 0]);
    // The middle pin sits exactly on the point.
    assert.deepEqual(vecs[1], [0, 0]);
    // Each extra pin steps ~11px up and to the side of the one before — small
    // enough that the pills overlap like a hand of cards (pill ≈ 55px wide).
    for (const [a, b] of [[vecs[0], vecs[1]], [vecs[1], vecs[2]]]) {
        const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
        assert.ok(step >= 10 && step <= 12, `step ${step}`);
    }
    // Consistent direction: right (+x) and up (−y), the card-fan look.
    assert.deepEqual([vecs[1][0] - vecs[0][0], vecs[1][1] - vecs[0][1]], [8, -8]);
    assert.deepEqual([vecs[2][0] - vecs[1][0], vecs[2][1] - vecs[1][1]], [8, -8]);
    // No two pins share an offset, so none completely hides another.
    assert.notDeepEqual(vecs[0], vecs[1]);
    assert.notDeepEqual(vecs[1], vecs[2]);
    assert.notDeepEqual(vecs[0], vecs[2]);
});

test('a pair at one spot straddles the point, ~11px apart', () => {
    const pt = { lat: 55.3978, lng: -3.7817 };
    const out = computePinOffsets([{ id: 'a', ...pt }, { id: 'b', ...pt }]);
    // Centred: the two offsets are opposite, so neither sits on the raw point
    // but their midpoint does.
    assert.deepEqual([out['a'][0] + out['b'][0], out['a'][1] + out['b'][1]], [0, 0]);
    assert.notDeepEqual(out['a'], [0, 0]);
    const step = Math.hypot(out['b'][0] - out['a'][0], out['b'][1] - out['a'][1]);
    assert.ok(step >= 10 && step <= 12, `step ${step}`);
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
