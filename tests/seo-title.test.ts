import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingSeoTitle, TITLE_MAX } from '../lib/seoTitle';

// Intent: a listing's search title is never cut off by Google (<= 60 chars),
// keeps the host's own words, and names the town whenever there is room.

test('a short title keeps the full form with the brand', () => {
    assert.equal(listingSeoTitle('Mains of Greenlaw', 'Castle Douglas'), 'Mains of Greenlaw | Self Catering in Castle Douglas');
});

test('drops the brand before it drops the town', () => {
    const t = listingSeoTitle('Mains of Greenlaw Cottage', 'Castle Douglas');
    assert.ok(t.length <= TITLE_MAX);
    assert.match(t, /Castle Douglas/);
});

test('a long title still names its town when it fits', () => {
    const t = listingSeoTitle('Modern Cottage, with Hot Tub', 'Kirkcudbright');
    assert.ok(t.length <= TITLE_MAX);
    assert.match(t, /Kirkcudbright/);
});

test('does not repeat a town the title already names', () => {
    assert.equal(listingSeoTitle('4 bedroom Townhouse, Kirkcudbright with garden and sea views', 'Kirkcudbright'),
        '4 bedroom Townhouse, Kirkcudbright with garden and sea views');
});

test('a title too long for anything is clamped, never over the limit', () => {
    const t = listingSeoTitle('Coastal Retreat with Private Sauna and Spectacular Seaviews over the Solway', 'Castle Douglas');
    assert.ok(t.length <= TITLE_MAX, t);
    assert.ok(t.startsWith('Coastal Retreat with Private Sauna'));
});
