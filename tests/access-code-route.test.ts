// The only door in or out of `listing_access_codes`.
//
// That table has no grants for `anon` or `authenticated`, so a browser cannot
// touch it however the query is phrased — which makes this route the entire
// attack surface for a credential that opens somebody's front door. It is
// worth testing as such.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/listings/access-code/route';

function load(opts: { user?: string | null; access?: any; stored?: any } = {}) {
    const writes: any[] = [];
    const deletes: any[] = [];

    function builder(_table: string) {
        const state: any = { ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    return async () => ({ data: opts.stored ?? null, error: null });
                }
                if (prop === 'then') {
                    const upsert = state.ops.find((o: any) => o.op === 'upsert');
                    if (upsert) writes.push(upsert.args[0]);
                    const del = state.ops.find((o: any) => o.op === 'delete');
                    if (del) deletes.push(true);
                    return (r: any) => r({ data: null, error: null });
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: {
                getUser: async () => ({
                    data: { user: opts.user === null ? null : { id: opts.user || 'host-1' } },
                }),
            },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', { logError: async () => undefined });
    // `??` would treat an explicit null as "not supplied" and hand back the
    // default — so the refusal test would have exercised the permitted path
    // while claiming to test a 403. Ask whether the key is present instead.
    const access = Object.prototype.hasOwnProperty.call(opts, 'access')
        ? opts.access
        : { isOwner: true };
    stubModule('@/lib/access', { checkListing: async () => access });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), writes, deletes };
}

const get = (listing = 'l1') =>
    new Request('http://example.invalid/api/listings/access-code?listing=' + listing);

const post = (body: any) =>
    new Request('http://example.invalid/api/listings/access-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

test('a signed-out visitor gets nothing, read or write', async () => {
    const { route, writes } = load({ user: null });

    const read: any = await route.GET(get());
    assert.equal(read.status, 401);
    assert.equal(read.body.code, undefined, 'no code in the body of a refusal');

    const write: any = await route.POST(post({ listing: 'l1', code: '9999' }));
    assert.equal(write.status, 401);
    assert.equal(writes.length, 0);
});

test('somebody without can_listing is refused, even signed in', async () => {
    const { route, writes } = load({ access: null });

    const read: any = await route.GET(get());
    assert.equal(read.status, 403);
    assert.equal(read.body.code, undefined, 'a refusal must never leak the code');

    const write: any = await route.POST(post({ listing: 'l1', code: '9999' }));
    assert.equal(write.status, 403);
    assert.equal(writes.length, 0, 'and must not write one either');
});

test('a host with permission reads their own code', async () => {
    const { route } = load({ stored: { code: '1860', updated_at: '2026-08-23T00:00:00Z' } });
    const res: any = await route.GET(get());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, '1860');
});

test('a listing with no code set reads as empty, not as an error', async () => {
    const { route } = load({ stored: null });
    const res: any = await route.GET(get());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, '', 'the sender treats empty as "hold the message", so it must be a normal answer');
});

test('saving records who set it', async () => {
    const { route, writes } = load({ user: 'host-7' });
    const res: any = await route.POST(post({ listing: 'l1', code: ' 1860 ' }));

    assert.equal(res.status, 200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].code, '1860', 'trimmed — a stray space is a door that will not open');
    assert.equal(writes[0].listing_id, 'l1');
    assert.equal(writes[0].updated_by, 'host-7', 'a credential should say who set it');
});

test('clearing the code removes the row rather than storing an empty string', async () => {
    // "No code set" has to be one state, because that is what the sender
    // checks before holding a message back.
    const { route, writes, deletes } = load({});
    const res: any = await route.POST(post({ listing: 'l1', code: '' }));

    assert.equal(res.status, 200);
    assert.equal(deletes.length, 1);
    assert.equal(writes.length, 0);
});

test('a listing must be named', async () => {
    const { route } = load({});
    const res: any = await route.POST(post({ code: '1860' }));
    assert.equal(res.status, 400);
});

test('an absurdly long value is refused rather than stored', async () => {
    const { route, writes } = load({});
    const res: any = await route.POST(post({ listing: 'l1', code: 'x'.repeat(41) }));

    assert.equal(res.status, 400);
    assert.equal(writes.length, 0);
});
