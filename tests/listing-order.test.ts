// The one order every public grid uses (lib/listingOrder). If this drifts, the
// home page, the search/area pages and the experiences grid stop agreeing with
// the admin arrange tool — the whole point of the column.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDisplayOrder, orderPublishedListings, DISPLAY_ORDER_COLUMN } from '../lib/listingOrder';

type Row = { id: string; display_order?: number | null; name?: string };

test('placed rows come first, in ascending display_order', () => {
    const rows: Row[] = [
        { id: 'c', display_order: 3 },
        { id: 'a', display_order: 1 },
        { id: 'b', display_order: 2 },
    ];
    const sorted = [...rows].sort(byDisplayOrder(() => 0));
    assert.deepEqual(sorted.map((r) => r.id), ['a', 'b', 'c']);
});

test('un-placed rows (null/undefined) sort to the bottom', () => {
    const rows: Row[] = [
        { id: 'new1', display_order: null },
        { id: 'p2', display_order: 2 },
        { id: 'new2' }, // undefined
        { id: 'p1', display_order: 1 },
    ];
    const sorted = [...rows].sort(byDisplayOrder(() => 0));
    assert.deepEqual(sorted.slice(0, 2).map((r) => r.id), ['p1', 'p2']);
    // the two un-placed ones are last (order between them decided by the tie-break)
    assert.deepEqual(sorted.slice(2).map((r) => r.id).sort(), ['new1', 'new2']);
});

test('the caller tie-break only decides order WITHIN the un-placed group', () => {
    const rows: Row[] = [
        { id: 'z', display_order: null, name: 'Zoe' },
        { id: 'a', display_order: null, name: 'Ava' },
        { id: 'p', display_order: 5, name: 'Placed' },
    ];
    const byName = byDisplayOrder<Row>((x, y) => (x.name || '').localeCompare(y.name || ''));
    const sorted = [...rows].sort(byName);
    assert.deepEqual(sorted.map((r) => r.id), ['p', 'a', 'z']); // placed first, then Ava < Zoe
});

test('orderPublishedListings applies display_order asc nulls-last, then created_at desc', () => {
    const calls: { column: string; opts: any }[] = [];
    const query: any = {
        order(column: string, opts: any) { calls.push({ column, opts }); return this; },
    };
    const returned = orderPublishedListings(query);
    assert.equal(returned, query, 'returns the same builder for chaining');
    assert.deepEqual(calls, [
        { column: DISPLAY_ORDER_COLUMN, opts: { ascending: true, nullsFirst: false } },
        { column: 'created_at', opts: { ascending: false } },
    ]);
});
