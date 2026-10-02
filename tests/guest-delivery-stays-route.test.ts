// "Deliver to my cottage": the signed-in guest's own confirmed stay that covers
// the delivery date. The route must never hand a stay to the wrong account (it
// pins guest_id to the caller and reads only confirmed stays), must refuse a bad
// date, and must compose the same [street, postcode, town] private line the order
// route freezes — so a one-tap fill and an against-a-stay order agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/guest/delivery-stays/route';

function load(opts: { user?: string | null; bookings?: any[]; listings?: any[] } = {}) {
    const bookingQueries: any[] = [];

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    return (r: any) => {
                        if (table === 'bookings') { bookingQueries.push(state.ops); return r({ data: opts.bookings ?? [], error: null }); }
                        if (table === 'listings') return r({ data: opts.listings ?? [], error: null });
                        return r({ data: [], error: null });
                    };
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: opts.user === null ? null : { id: opts.user || 'guest-1' } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), bookingQueries };
}

const req = (date: string) => ({ url: 'http://x/api/guest/delivery-stays?date=' + date }) as any;

test('an anonymous basket gets no stays', async () => {
    const { route } = load({ user: null });
    const res = await route.GET(req('2026-10-01'));
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.stays, []);
});

test('a malformed date is refused (400)', async () => {
    const { route } = load({ user: 'guest-1' });
    const res = await route.GET(req('not-a-date'));
    assert.equal(res.status, 400);
});

test('queries only the caller\'s confirmed stays', async () => {
    const { route, bookingQueries } = load({ user: 'guest-9', bookings: [] });
    await route.GET(req('2026-10-01'));
    const ops = bookingQueries[0] || [];
    const eqArgs = ops.filter((o: any) => o.op === 'eq').map((o: any) => o.args);
    assert.ok(eqArgs.some((a: any[]) => a[0] === 'guest_id' && a[1] === 'guest-9'), 'pins guest_id to the caller');
    assert.ok(eqArgs.some((a: any[]) => a[0] === 'status' && a[1] === 'confirmed'), 'only confirmed stays');
});

test('composes the private line for an overlapping stay', async () => {
    const { route } = load({
        user: 'guest-1',
        bookings: [{ id: 'b1', listing_id: 'l1', check_in: '2026-09-30', check_out: '2026-10-05', status: 'confirmed' }],
        listings: [{ id: 'l1', title: 'Harbour Cottage', street_address: '2 Harbour St', postcode: 'DG6 4JA', location: 'Kirkcudbright' }],
    });
    const res = await route.GET(req('2026-10-01'));
    assert.equal(res.body.stays.length, 1);
    assert.equal(res.body.stays[0].propertyName, 'Harbour Cottage');
    assert.equal(res.body.stays[0].line, '2 Harbour St, DG6 4JA, Kirkcudbright');
});

test('a stay whose listing is missing is dropped, not returned blank', async () => {
    const { route } = load({
        user: 'guest-1',
        bookings: [{ id: 'b1', listing_id: 'l1', check_in: '2026-09-30', check_out: '2026-10-05', status: 'confirmed' }],
        listings: [],
    });
    const res = await route.GET(req('2026-10-01'));
    assert.deepEqual(res.body.stays, []);
});
