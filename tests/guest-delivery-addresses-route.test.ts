// The saved delivery-address book. Every query runs through the guest's own
// session (RLS pins each row to auth.uid()), so the route's own job is narrower:
// an anonymous caller gets an empty list and cannot save; a save needs a full
// address with a postcode; and a repeat of an address already saved bumps it
// rather than duplicating it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/guest/delivery-addresses/route';

function load(opts: { user?: string | null; existing?: any; list?: any[] } = {}) {
    const inserts: any[] = [];
    const updates: any[] = [];
    const deletes: any[] = [];

    function builder() {
        const state: any = { ops: [] };
        const has = (op: string) => state.ops.some((o: any) => o.op === op);
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    return async () => {
                        if (has('ilike')) return { data: opts.existing ?? null, error: null };
                        if (has('update')) { return { data: { id: 'up-1' }, error: null }; }
                        if (has('insert')) { return { data: { id: 'new-1' }, error: null }; }
                        return { data: null, error: null };
                    };
                }
                if (prop === 'then') {
                    return (r: any) => {
                        if (has('delete')) { deletes.push(true); return r({ data: null, error: null }); }
                        // select().order() — GET list, or the post-insert prune read.
                        return r({ data: opts.list ?? [], error: null });
                    };
                }
                return (...args: any[]) => {
                    state.ops.push({ op: prop, args });
                    if (prop === 'insert') inserts.push(args[0]);
                    if (prop === 'update') updates.push(args[0]);
                    return chain;
                };
            },
        });
        return chain;
    }

    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: opts.user === null ? null : { id: opts.user || 'guest-1' } } }) },
            from: () => builder(),
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), inserts, updates, deletes };
}

const post = (body: any) => ({ json: async () => body }) as any;
const GOOD = { house: 'Rose Cottage', street: '18 Dovecroft', town: 'Kirkcudbright', postcode: 'DG6 4JA', line: 'Rose Cottage, 18 Dovecroft, Kirkcudbright, DG6 4JA' };

test('GET returns an empty list for an anonymous basket', async () => {
    const { route } = load({ user: null });
    const res = await route.GET();
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.addresses, []);
});

test('GET returns the saved rows for a signed-in guest', async () => {
    const rows = [{ id: 'a1', ...GOOD, last_used_at: 't' }];
    const { route } = load({ user: 'guest-1', list: rows });
    const res = await route.GET();
    assert.equal(res.body.ok, true);
    assert.equal(res.body.addresses.length, 1);
});

test('POST refuses an anonymous save (401)', async () => {
    const { route, inserts } = load({ user: null });
    const res = await route.POST(post(GOOD));
    assert.equal(res.status, 401);
    assert.equal(inserts.length, 0);
});

test('POST refuses an address with no postcode (400)', async () => {
    const { route, inserts } = load({ user: 'guest-1' });
    const res = await route.POST(post({ house: 'x', street: 'y', town: 'z', postcode: '', line: 'x, y, z' }));
    assert.equal(res.status, 400);
    assert.equal(inserts.length, 0);
});

test('POST inserts a brand-new address', async () => {
    const { route, inserts, updates } = load({ user: 'guest-1', existing: null, list: [] });
    const res = await route.POST(post(GOOD));
    assert.equal(res.body.ok, true);
    assert.equal(inserts.length, 1);
    assert.equal(updates.length, 0);
    // guest_id is never trusted from the browser — the insert must not carry one.
    assert.equal(Object.prototype.hasOwnProperty.call(inserts[0], 'guest_id'), false);
});

test('POST bumps an address already saved rather than duplicating it', async () => {
    const { route, inserts, updates } = load({ user: 'guest-1', existing: { id: 'a1' } });
    const res = await route.POST(post(GOOD));
    assert.equal(res.body.ok, true);
    assert.equal(inserts.length, 0);
    assert.equal(updates.length, 1);
    assert.ok(updates[0].last_used_at);
});
