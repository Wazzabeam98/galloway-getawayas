// Deleting a listing (/api/listings/delete, lib/listingRemoval).
//
// What these hold:
//   * a listing with a PAID booking or paid experience order is never deleted —
//     the route refuses with mustHide, and the dashboard offers Hide, not
//     Delete — because that payment record has to be kept;
//   * a listing whose only rows are never-paid checkouts (abandoned, cancelled)
//     IS deleted: those unpaid rows are cleared first so the foreign key lets
//     the delete through;
//   * a listing that never took money is deleted, by its owner only, and its
//     photos go with it — except a path another listing still uses;
//   * a paid booking landing between the check and the delete (the foreign
//     key's 23503) is the same refusal, and no photo is touched;
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

test('the rule: a paid booking/order means hide, none means delete', () => {
    assert.equal(R.removalFor(true), 'hide');
    assert.equal(R.removalFor(false), 'delete');
});

test('bookingTookMoney: unpaid/£0 is false; paid, deposit, refunded, amount_paid or paid_at is true', () => {
    // Never took money — an abandoned or cancelled checkout.
    assert.equal(R.bookingTookMoney({ payment_status: 'unpaid', amount_paid: '0.00', paid_at: null }), false);
    assert.equal(R.bookingTookMoney({ payment_status: 'unpaid', amount_paid: 0, paid_at: null }), false);
    assert.equal(R.bookingTookMoney(null), false);
    // Took money — any of the three signals.
    assert.equal(R.bookingTookMoney({ payment_status: 'paid' }), true);
    assert.equal(R.bookingTookMoney({ payment_status: 'deposit_paid' }), true);
    assert.equal(R.bookingTookMoney({ payment_status: 'refunded' }), true);
    assert.equal(R.bookingTookMoney({ payment_status: 'partially_refunded' }), true);
    assert.equal(R.bookingTookMoney({ payment_status: 'unpaid', amount_paid: '120.00' }), true);
    assert.equal(R.bookingTookMoney({ payment_status: 'cancelled', paid_at: '2026-01-01T00:00:00Z' }), true);
});

test('orderTookMoney: a hold with no intent is false; confirmed/authorised/refunded or an intent is true', () => {
    assert.equal(R.orderTookMoney({ status: 'holding', stripe_payment_intent_id: null }), false);
    assert.equal(R.orderTookMoney({ status: 'expired', stripe_payment_intent_id: null }), false);
    assert.equal(R.orderTookMoney({ status: 'declined', stripe_payment_intent_id: null }), false);
    assert.equal(R.orderTookMoney(null), false);
    assert.equal(R.orderTookMoney({ status: 'confirmed' }), true);
    assert.equal(R.orderTookMoney({ status: 'authorised' }), true);
    assert.equal(R.orderTookMoney({ status: 'refunded' }), true);
    assert.equal(R.orderTookMoney({ status: 'holding', stripe_payment_intent_id: 'pi_1' }), true);
});

test('listingsWithPaidRecords counts only paid bookings and paid orders', async () => {
    const { admin } = fakeAdmin(world({
        bookings: [
            { listing_id: 'l-1', status: 'confirmed', payment_status: 'paid', amount_paid: '100.00' },
            // Unpaid cancelled checkout — must NOT lock the listing down.
            { listing_id: 'l-2', status: 'cancelled', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null },
        ],
        service_orders: [
            { listing_id: 'l-3', status: 'confirmed', stripe_payment_intent_id: 'pi_1' },
            // Abandoned hold — must NOT lock the listing down.
            { listing_id: 'l-5', status: 'holding', stripe_payment_intent_id: null },
        ],
    }));
    const got = await R.listingsWithPaidRecords(admin, ['l-1', 'l-2', 'l-3', 'l-4', 'l-5']);
    assert.deepEqual(Array.from(got).sort(), ['l-1', 'l-3']);
});

test('listingsWithPaidRecords throws on a failed read rather than answering "none"', async () => {
    const admin: any = {
        from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) }),
    };
    await assert.rejects(() => R.listingsWithPaidRecords(admin, ['l-1']));
});

test('clearUnpaidRecords removes only the never-paid rows, leaving any paid one', async () => {
    const w = world({
        bookings: [
            { id: 'b-unpaid', listing_id: 'l-test', status: 'cancelled', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null },
            { id: 'b-paid', listing_id: 'l-test', status: 'cancelled', payment_status: 'refunded', amount_paid: '0.00', paid_at: '2026-01-01T00:00:00Z' },
            { id: 'b-other', listing_id: 'l-other', status: 'cancelled', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null },
        ],
        service_orders: [
            { id: 'o-hold', listing_id: 'l-test', status: 'holding', stripe_payment_intent_id: null },
            { id: 'o-paid', listing_id: 'l-test', status: 'confirmed', stripe_payment_intent_id: 'pi_1' },
        ],
    });
    const { admin } = fakeAdmin(w);
    await R.clearUnpaidRecords(admin, 'l-test');
    assert.deepEqual(w.bookings.map((b) => b.id).sort(), ['b-other', 'b-paid'], 'only l-test\'s unpaid booking is gone');
    assert.deepEqual(w.service_orders.map((o) => o.id).sort(), ['o-paid'], 'only l-test\'s unpaid hold is gone');
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

test('a listing whose only rows are never-paid checkouts is deleted — the unpaid rows are cleared first', async () => {
    const w = world({
        bookings: [
            { id: 'b-1', listing_id: 'l-test', status: 'cancelled', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null },
            { id: 'b-2', listing_id: 'l-test', status: 'expired', payment_status: 'unpaid', amount_paid: '0.00', paid_at: null },
        ],
        service_orders: [
            { id: 'o-1', listing_id: 'l-test', status: 'holding', stripe_payment_intent_id: null },
        ],
    });
    const { route, deletes } = load(w);
    const res = await route.POST(post({ listingId: 'l-test' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    // deletes spans every table the fake touched: the unpaid rows were cleared
    // first, then the listing itself.
    assert.ok(deletes.includes('l-test'), 'the listing is deleted');
    assert.deepEqual(deletes.filter((d) => d === 'o-1' || d === 'b-1' || d === 'b-2').sort(), ['b-1', 'b-2', 'o-1']);
    assert.deepEqual(w.bookings, [], 'the unpaid bookings were cleared');
    assert.deepEqual(w.service_orders, [], 'the unpaid hold was cleared');
});

test('a listing with a PAID booking is refused with mustHide; the paid row is never cleared', async () => {
    const paidRows = [
        { payment_status: 'paid', status: 'confirmed', amount_paid: '100.00' },
        { payment_status: 'refunded', status: 'cancelled', amount_paid: '0.00', paid_at: '2026-01-01T00:00:00Z' },
        { payment_status: 'deposit_paid', status: 'confirmed', amount_paid: '50.00' },
    ];
    for (const row of paidRows) {
        const w = world({ bookings: [{ id: 'b-paid', listing_id: 'l-test', ...row }] });
        const { route, removed, deletes } = load(w);
        const res = await route.POST(post({ listingId: 'l-test' }));

        assert.equal(res.status, 409, row.payment_status);
        assert.equal(res.body.mustHide, true);
        assert.match(res.body.error, /can’t be deleted/);
        assert.deepEqual(deletes, [], row.payment_status);
        assert.deepEqual(removed, [], row.payment_status);
        assert.equal(w.bookings.length, 1, 'the paid booking is untouched');
    }
});

test('a listing with a PAID experience order against it is refused the same way', async () => {
    const w = world({ service_orders: [{ id: 'o-paid', listing_id: 'l-test', status: 'confirmed', stripe_payment_intent_id: 'pi_1' }] });
    const { route, deletes } = load(w);
    const res = await route.POST(post({ listingId: 'l-test' }));
    assert.equal(res.status, 409);
    assert.deepEqual(deletes, []);
    assert.equal(w.service_orders.length, 1, 'the paid order is untouched');
});

test('a paid booking landing after the check (FK 23503) is the same refusal, and no photo goes', async () => {
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
    assert.match(src, /listingsWithPaidRecords\(admin/);
    assert.match(src, /removalFor\(booked\) === 'delete' && \(\s*<DeleteListingBtn/);
    // A failed read must fall back to "booked" (Hide), never to Delete.
    assert.match(src, /catch \{\s*bookedIds = new Set\(owned\.map/);
});
