// What the listing editor stores when the host saves the rooms. The bug this
// guards: a host who removed the last bed saw it save, then watched the old
// layout come back on reload, because the save wrote the PREVIOUS arrangements
// back whenever no beds were left. sleepingPatch must store the emptied layout
// as-is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleepingPatch, type Room } from '../lib/sleeping';

test('removing the last bed from the only bedroom stores the empty room, not the old one', () => {
    const rooms: Room[] = [{ label: 'Bedroom 1', kind: 'bedroom', beds: [] }];
    const patch = sleepingPatch(rooms);
    // The bedroom is kept (a bedroom with no beds is still a room)…
    assert.deepEqual(patch.rooms, [{ label: 'Bedroom 1', kind: 'bedroom', beds: [] }]);
    // …and the count derives from it, so reload rebuilds this, not a bed.
    assert.equal(patch.bedrooms, 1);
});

test('clearing every room stores an empty layout and zero bedrooms', () => {
    assert.deepEqual(sleepingPatch([]), { rooms: [], bedrooms: 0 });
});

test('a bed set to zero is dropped from its room', () => {
    const rooms: Room[] = [
        { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'Double bed', count: 0 }, { type: 'Single bed', count: 1 }] },
    ];
    assert.deepEqual(sleepingPatch(rooms).rooms, [
        { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'Single bed', count: 1 }] },
    ]);
});

test('a common space emptied of beds is dropped; an emptied bedroom is not', () => {
    const rooms: Room[] = [
        { label: 'Bedroom 1', kind: 'bedroom', beds: [] },
        { label: 'Living room', kind: 'common', beds: [{ type: 'Sofa bed', count: 0 }] },
    ];
    const patch = sleepingPatch(rooms);
    assert.deepEqual(patch.rooms, [{ label: 'Bedroom 1', kind: 'bedroom', beds: [] }]);
    assert.equal(patch.bedrooms, 1);
});

test('a studio — a bed in a common space, no bedrooms — stores zero bedrooms', () => {
    const rooms: Room[] = [{ label: 'Studio', kind: 'common', beds: [{ type: 'Double bed', count: 1 }] }];
    const patch = sleepingPatch(rooms);
    assert.deepEqual(patch.rooms, [{ label: 'Studio', kind: 'common', beds: [{ type: 'Double bed', count: 1 }] }]);
    assert.equal(patch.bedrooms, 0);
});

test('a full layout is stored unchanged with its derived bedroom count', () => {
    const rooms: Room[] = [
        { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }] },
        { label: 'Bedroom 2', kind: 'bedroom', beds: [{ type: 'Single bed', count: 2 }] },
    ];
    const patch = sleepingPatch(rooms);
    assert.deepEqual(patch.rooms, rooms);
    assert.equal(patch.bedrooms, 2);
});
