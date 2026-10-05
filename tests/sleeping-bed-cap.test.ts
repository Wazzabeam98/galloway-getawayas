// The listing's total bed count caps how many beds the host places across
// rooms in the editor's sleeping arrangements: 3 beds, exactly 3 placed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedsLeftToPlace, bedLabel, BED_TYPES, type Room } from '../lib/sleeping';

const rooms: Room[] = [
    { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }] },
    { label: 'Bedroom 2', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }] },
];

test('beds left to place counts down from the total', () => {
    assert.equal(bedsLeftToPlace(3, []), 3);
    assert.equal(bedsLeftToPlace(3, rooms), 1);
});

test('once every bed is placed there is nothing left — the + buttons grey out', () => {
    const full: Room[] = [...rooms, { label: 'Living room', kind: 'common', beds: [{ type: 'Sofa bed', count: 1 }] }];
    assert.equal(bedsLeftToPlace(3, full), 0);
});

test('an older listing already over its total never goes negative', () => {
    assert.equal(bedsLeftToPlace(1, rooms), 0);
});

test('the counters offer the bed types Liam named', () => {
    for (const t of ['Single bed', 'Double bed', 'Small double bed', 'King bed', 'Bunk bed', 'Sofa bed', 'Sofa', 'Floor mattress', 'Cot', 'Toddler bed']) {
        assert.ok(BED_TYPES.includes(t), t);
    }
});

test('mattresses pluralise properly', () => {
    assert.equal(bedLabel({ type: 'Floor mattress', count: 2 }), '2 floor mattresses');
    assert.equal(bedLabel({ type: 'Double bed', count: 2 }), '2 double beds');
    assert.equal(bedLabel({ type: 'Sofa', count: 1 }), '1 sofa');
});
