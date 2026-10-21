// The Location editor's town nudge (lib/townNudge) and the Earnings pages'
// default period (lib/earningsPeriod), 21 Oct 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { townNudge } = require('../lib/townNudge');
const { defaultEarningsPeriod } = require('../lib/earningsPeriod');

const TOWNS = [
    { key: 'kirkcudbright', label: 'Kirkcudbright', lat: 54.8362, lng: -4.0530 },
    { key: 'castle-douglas', label: 'Castle Douglas', lat: 54.9375, lng: -3.9319 },
    { key: 'gatehouse-of-fleet', label: 'Gatehouse of Fleet', lat: 54.8797, lng: -4.1836 },
];

test('a post town fifteen miles off is nudged to the nearer town (the Coastal Retreat case)', () => {
    // DG7 2HB: Royal Mail says Castle Douglas; the cottage is by Gatehouse.
    const n = townNudge('Castle Douglas', 54.851493, -4.280025, TOWNS);
    assert.ok(n, 'a nudge');
    assert.equal(n.suggest, 'Gatehouse of Fleet');
    assert.equal(n.typed, 'Castle Douglas');
    assert.ok(n.typedMiles > 10 && n.suggestMiles < 6);
});

test('no nudge for a cottage in or at the edge of its own town, or a town we do not know', () => {
    assert.equal(townNudge('Gatehouse of Fleet', 54.851493, -4.280025, TOWNS), null, 'already the nearest');
    assert.equal(townNudge('Castle Douglas', 54.93, -3.95, TOWNS), null, 'in Castle Douglas');
    assert.equal(townNudge('Wanlockhead', 55.398, -3.78, TOWNS), null, 'not one of our towns — nothing to compare');
    assert.equal(townNudge('Castle Douglas', null, null, TOWNS), null, 'no postcode point yet');
});

test('Earnings opens on this year, from the month the account was made', () => {
    assert.deepEqual(defaultEarningsPeriod('2026-10-21T09:00:00Z', '2026-10-21'), { from: '2026-10-01', to: '2026-12-31' },
        'joined today: October onwards');
    assert.deepEqual(defaultEarningsPeriod('2025-03-02T09:00:00Z', '2026-10-21'), { from: '2026-01-01', to: '2026-12-31' },
        'joined last year: the whole year');
    assert.deepEqual(defaultEarningsPeriod('2026-10-21T09:00:00Z', '2027-02-01'), { from: '2027-01-01', to: '2027-12-31' },
        'the January after: the whole year');
    assert.deepEqual(defaultEarningsPeriod(null, '2026-10-21'), { from: '2026-01-01', to: '2026-12-31' }, 'unknown: the whole year');
});
