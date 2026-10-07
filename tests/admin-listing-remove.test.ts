// Remove on /admin/listings (/api/admin/listings/remove).
//
// What these hold:
//   * a listing that never took money is deleted for good — the row, its own
//     photos in storage — and the trail records it as listing_deleted with the
//     title kept in detail;
//   * a listing with a PAID booking or order is never deleted: it is taken
//     down with the ordinary admin hide (status 'hidden', listing_hidden in
//     the trail), and every booking/order row survives;
//   * the screen's promise is checked: if the answer changed since the page
//     loaded (a booking paid in between), nothing happens at all;
//   * only an admin, and only with a reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/admin/listings/remove/route';
const OWNER = 'owner-1';
const HOST = 'host-1';

interface World {
    listings: any[];
    bookings: any[];
    service_orders: any[];
    message_templates: any[];
    profiles: any[];
    admin_actions: any[];
}

function fakeAdmin(world: World) {
    const removed: string[][] = [];
    const from = (table: keyof World) => {
        const filters: Array<(r: any) => boolean> = [];
        let op: 'select' | 'delete' | 'update' | 'insert' = 'select';
        let patch: any = null;
        const rows = () => ((world as any)[table] as any[]).filter((r) => filters.every((f) => f(r)));
        const run = () => {
            if (op === 'insert') { (world as any)[table].push(patch); return { data: null, error: null }; }
            if (op === 'delete') {
                const hit = rows();
                (world as any)[table] = (world as any)[table].filter((r: any) => hit.indexOf(r) === -1);
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
            insert: (p: any) => { op = 'insert'; patch = p; return chain; },
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
    return { admin, removed };
}

function load(world: World, userId: string | null = OWNER) {
    const fake = fakeAdmin(world);
    stubModule('@/lib/supabaseAdmin', { adminClient: () => fake.admin });
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
    clearModule('@/lib/adminAudit');
    clearModule('@/lib/listingRemoval');
    clearModule(ROUTE);
    return { route: require(ROUTE), ...fake };
}

const post = (body: any) => new Request('http://x/api/admin/listings/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

const world = (over: Partial<World> = {}): World => ({
    listings: [
        { id: 'l-1', host_id: HOST, title: 'SEED — Test Cottage', status: 'published', images: ['host-1/a.jpg', 'host-1/shared.jpg'] },
        { id: 'l-2', host_id: HOST, title: 'Other', status: 'published', images: ['host-1/shared.jpg'] },
    ],
    bookings: [],
    service_orders: [],
    message_templates: [],
    profiles: [{ id: OWNER, is_admin: true }, { id: 'nobody', is_admin: false }],
    admin_actions: [],
    ...over,
});

test('a never-booked listing is deleted for good, with its own photos, and the trail keeps its title', async () => {
    const w = world();
    const { route, removed } = load(w);
    const res = await route.POST(post({ listingId: 'l-1', reason: 'Test listing', expect: 'delete' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'deleted');
    assert.deepEqual(w.listings.map((l) => l.id), ['l-2']);
    assert.deepEqual(removed, [['host-1/a.jpg']], 'the shared photo stays with the listing still using it');
    assert.equal(w.admin_actions.length, 1);
    assert.equal(w.admin_actions[0].action, 'listing_deleted');
    assert.equal(w.admin_actions[0].listing_id, null);
    assert.equal(w.admin_actions[0].detail.title, 'SEED — Test Cottage');
});

test('a listing with a paid booking is taken down, never deleted — booking kept, no photo touched', async () => {
    const w = world({ bookings: [{ id: 'b-1', listing_id: 'l-1', payment_status: 'paid', amount_paid: '100.00' }] });
    const { route, removed } = load(w);
    const res = await route.POST(post({ listingId: 'l-1', reason: 'Fake listing', expect: 'hide' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'hidden');
    assert.equal(w.listings.find((l) => l.id === 'l-1').status, 'hidden');
    assert.equal(w.bookings.length, 1, 'the paid booking is untouched');
    assert.deepEqual(removed, []);
    assert.equal(w.admin_actions[0].action, 'listing_hidden');
});

test('a paid experience order counts as a booking too', async () => {
    const w = world({ service_orders: [{ id: 'o-1', listing_id: 'l-1', status: 'confirmed', stripe_payment_intent_id: 'pi_1' }] });
    const { route } = load(w);
    const res = await route.POST(post({ listingId: 'l-1', reason: 'Fake listing', expect: 'hide' }));
    assert.equal(res.body.outcome, 'hidden');
    assert.equal(w.service_orders.length, 1);
});

test('if a booking was paid since the page loaded, a confirmed delete does nothing at all', async () => {
    const w = world({ bookings: [{ id: 'b-1', listing_id: 'l-1', payment_status: 'deposit_paid', amount_paid: '50.00' }] });
    const { route } = load(w);
    const res = await route.POST(post({ listingId: 'l-1', reason: 'Test listing', expect: 'delete' }));

    assert.equal(res.status, 409);
    assert.equal(res.body.changed, true);
    assert.equal(w.listings.length, 2, 'not deleted');
    assert.equal(w.listings[0].status, 'published', 'and not hidden either — that was not what was confirmed');
});

test('a never-paid abandoned checkout does not stop the delete', async () => {
    const w = world({ bookings: [{ id: 'b-x', listing_id: 'l-1', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null }] });
    const { route } = load(w);
    const res = await route.POST(post({ listingId: 'l-1', reason: 'Test listing', expect: 'delete' }));
    assert.equal(res.body.outcome, 'deleted');
});

test('not an admin, signed out, or no reason — refused, nothing changes', async () => {
    const a = load(world(), 'nobody');
    assert.equal((await a.route.POST(post({ listingId: 'l-1', reason: 'x y z', expect: 'delete' }))).status, 403);
    const b = load(world(), null);
    assert.equal((await b.route.POST(post({ listingId: 'l-1', reason: 'x y z', expect: 'delete' }))).status, 401);
    const w = world();
    const c = load(w);
    assert.equal((await c.route.POST(post({ listingId: 'l-1', reason: '', expect: 'delete' }))).status, 400);
    assert.equal(w.listings.length, 2);
});
