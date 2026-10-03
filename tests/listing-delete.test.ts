// Deleting a listing (/api/listings/delete, lib/listingRemoval).
//
// What these hold:
//   * a listing with ANY booking or experience order is never deleted — the
//     route refuses with mustHide, and the dashboard offers Hide, not Delete;
//   * a listing that never had one is deleted, by its owner only, and its
//     photos go with it — except a path another listing still uses;
//   * a booking landing between the check and the delete (the foreign key's
//     23503) is the same refusal, and no photo is touched;
//   * the dashboard and the route read the one rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const R = require('../lib/listingRemoval');
const ROUTE = '@/app/api/listings/delete/route';
const HOST = 'host-1';

interface World {
    listings: any[];
    bookings: any[];
    service_orders: any[];
    message_templates: any[];
    deleteError?: any;
}

function fakeAdmin(world: World) {
    const removed: string[][] = [];
    const deletes: string[] = [];
    const from = (table: keyof World) => {
        const filters: Array<(r: any) => boolean> = [];
        let op: 'select' | 'delete' | 'update' = 'select';
        let patch: any = null;
        const rows = () => ((world as any)[table] as any[]).filter((r) => filters.every((f) => f(r)));
        const run = () => {
            if (op === 'delete') {
                if (world.deleteError) return { data: null, error: world.deleteError };
                const hit = rows();
                (world as any)[table] = (world as any)[table].filter((r: any) => hit.indexOf(r) === -1);
                hit.forEach((r) => deletes.push(r.id));
                return { data: hit.map((r) => ({ id: r.id })), error: null };
            }
            if (op === 'update') {
                rows().forEach((r) => Object.assign(r, patch));
                return { data: null, error: null };
            }
            return { data: rows(), error: null };
        };
        const chain: any = {
            select: () => chain,
            delete: () => { op = 'delete'; return chain; },
            update: (p: any) => { op = 'update'; patch = p; return chain; },
            eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return chain; },
            in: (c: string, vs: any[]) => { filters.push((r) => vs.indexOf(r[c]) !== -1); return chain; },
            contains: (c: string, vs: any[]) => { filters.push((r) => vs.every((v) => (r[c] || []).indexOf(v) !== -1)); return chain; },
            overlaps: (c: string, vs: any[]) => { filters.push((r) => (r[c] || []).some((v: any) => vs.indexOf(v) !== -1)); return chain; },
            maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
            then: (resolve: any) => resolve(run()),
        };
        return chain;
    };
    const admin: any = {
        from,
        storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(paths); return { error: null }; } }) },
    };
    return { admin, removed, deletes };
}

function load(world: World, userId: string | null = HOST) {
    const fake = fakeAdmin(world);
    stubModule('@supabase/supabase-js', { createClient: () => fake.admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', { logError: async () => undefined });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });
    clearModule('@/lib/listingRemoval');
    clearModule(ROUTE);
    return { route: require(ROUTE), ...fake };
}

const post = (body: any) => new Request('http://x/api/listings/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

const world = (over: Partial<World> = {}): World => ({
    listings: [
        { id: 'l-test', host_id: HOST, images: ['host-1/a.jpg', 'host-1/b.jpg'] },
        { id: 'l-other', host_id: HOST, images: ['host-1/b.jpg'] },
    ],
    bookings: [],
    service_orders: [],
    message_templates: [{ id: 't-1', listing_ids: ['l-test', 'l-other'] }],
    ...over,
});

/* ----------------------------------------------------------------- the rule */

test('the rule: any booking or order means hide, none means delete', () => {
    assert.equal(R.removalFor(true), 'hide');
    assert.equal(R.removalFor(false), 'delete');
});

test('listingsWithRecords counts a booking of ANY status, and an experience order', async () => {
    const { admin } = fakeAdmin(world({
        bookings: [{ listing_id: 'l-1', status: 'cancelled' }, { listing_id: 'l-2', status: 'pending_payment' }],
        service_orders: [{ listing_id: 'l-3' }],
    }));
    const got = await R.listingsWithRecords(admin, ['l-1', 'l-2', 'l-3', 'l-4']);
    assert.deepEqual(Array.from(got).sort(), ['l-1', 'l-2', 'l-3']);
});

test('listingsWithRecords throws on a failed read rather than answering "none"', async () => {
    const admin: any = {
        from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) }),
    };
    await assert.rejects(() => R.listingsWithRecords(admin, ['l-1']));
});

test('photosToRemove skips shared paths, full URLs and blanks', () => {
    assert.deepEqual(
        R.photosToRemove(['a.jpg', 'b.jpg', '', 'https://x/c.jpg', 'a.jpg', null], ['b.jpg']),
        ['a.jpg']
    );
    assert.deepEqual(R.photosToRemove(null, []), []);
});

/* ---------------------------------------------------------------- the route */

test('a never-booked listing is deleted, with its own photos and its template mention', async () => {
    const w = world();
    const { route, removed, deletes } = load(w);
    const res = await route.POST(post({ listingId: 'l-test' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(deletes, ['l-test']);
    assert.deepEqual(removed, [['host-1/a.jpg']], 'b.jpg is still used by another listing, so it stays');
    assert.deepEqual(w.message_templates[0].listing_ids, ['l-other']);
});

test('a listing with a booking is refused with mustHide, and nothing is deleted or removed', async () => {
    for (const status of ['confirmed', 'cancelled', 'pending_payment']) {
        const w = world({ bookings: [{ listing_id: 'l-test', status }] });
        const { route, removed, deletes } = load(w);
        const res = await route.POST(post({ listingId: 'l-test' }));

        assert.equal(res.status, 409, status);
        assert.equal(res.body.mustHide, true);
        assert.match(res.body.error, /can’t be deleted/);
        assert.deepEqual(deletes, [], status);
        assert.deepEqual(removed, [], status);
    }
});

test('a listing with an experience order against it is refused the same way', async () => {
    const w = world({ service_orders: [{ listing_id: 'l-test' }] });
    const { route, deletes } = load(w);
    const res = await route.POST(post({ listingId: 'l-test' }));
    assert.equal(res.status, 409);
    assert.deepEqual(deletes, []);
});

test('a booking landing after the check (FK 23503) is the same refusal, and no photo goes', async () => {
    const w = world({ deleteError: { code: '23503', message: 'violates foreign key constraint' } });
    const { route, removed } = load(w);
    const res = await route.POST(post({ listingId: 'l-test' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.mustHide, true);
    assert.deepEqual(removed, []);
});

test('only the owner can delete — a co-host or anyone else is refused', async () => {
    const w = world();
    const { route, deletes } = load(w, 'someone-else');
    const res = await route.POST(post({ listingId: 'l-test' }));
    assert.equal(res.status, 403);
    assert.deepEqual(deletes, []);
});

test('signed out, or no listing named, is refused', async () => {
    const a = load(world(), null);
    assert.equal((await a.route.POST(post({ listingId: 'l-test' }))).status, 401);
    const b = load(world());
    assert.equal((await b.route.POST(post({}))).status, 400);
    const c = load(world());
    assert.equal((await c.route.POST(post({ listingId: 'nope' }))).status, 404);
});

/* ----------------------------------------------------------- the dashboard */

test('the dashboard chooses the button from the same rule, and the card shows one or the other', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/dashboard/page.tsx'), 'utf8');
    assert.match(src, /listingsWithRecords\(admin/);
    assert.match(src, /removalFor\(booked\) === 'delete' && \(\s*<DeleteListingBtn/);
    // A failed read must fall back to "booked" (Hide), never to Delete.
    assert.match(src, /catch \{\s*bookedIds = new Set\(owned\.map/);
});
