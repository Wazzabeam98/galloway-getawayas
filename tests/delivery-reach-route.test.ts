// The delivery-reach preflight: the read-only check the address modal runs at
// Save so an out-of-area postcode is refused there, with the SAME message the
// order route shows before payment. It must never create anything, must refuse a
// too-far / out-of-region address plainly, and must fail closed on a missing
// postcode or provider — the order route re-runs the real check regardless.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/services/delivery-reach/route';

function load(opts: { provider?: any; decision?: any; limited?: boolean } = {}) {
    const provider = Object.prototype.hasOwnProperty.call(opts, 'provider')
        ? opts.provider
        : { id: 'p1', business_name: 'Solway Loaf & Larder', shape: 'made_to_order', fulfilment: 'delivery', delivery_radius_miles: 10, collection_postcode: 'DG6 4JA' };

    function builder() {
        const state: any = { ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') return async () => ({ data: provider, error: null });
                if (prop === 'then') return (r: any) => r({ data: provider ? [provider] : [], error: null });
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: () => builder() }) });
    stubModule('@/lib/rateLimit', {
        withinLimits: async () => ({ ok: !opts.limited }),
        callerAddress: () => '1.2.3.4',
    });
    stubModule('@/lib/postcodeGeocode', {
        deliveryReach: async () => opts.decision ?? { ok: true, miles: 5 },
    });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule(ROUTE);
    return require(ROUTE.replace('@/', '../'));
}

const req = (body: any) => ({ headers: new Headers(), json: async () => body }) as any;

test('a reachable address returns reachable:true', async () => {
    const route = load({ decision: { ok: true, miles: 4 } });
    const res = await route.POST(req({ providerId: 'p1', postcode: 'DG6 4JB' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.reachable, true);
});

test('a too-far address returns reachable:false with the provider message', async () => {
    const route = load({ decision: { ok: false, reason: 'too_far', miles: 25 } });
    const res = await route.POST(req({ providerId: 'p1', postcode: 'DG1 1AA' }));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.reachable, false);
    assert.match(res.body.message, /Solway Loaf & Larder only delivers within 10 miles/);
    assert.match(res.body.message, /about 25 miles away/);
});

test('an out-of-region address names Dumfries & Galloway', async () => {
    const route = load({ decision: { ok: false, reason: 'out_of_region', miles: null } });
    const res = await route.POST(req({ providerId: 'p1', postcode: 'EH1 1AA' }));
    assert.equal(res.body.reachable, false);
    assert.match(res.body.message, /within Dumfries & Galloway/);
});

test('a missing postcode is refused (400), nothing checked', async () => {
    const route = load();
    const res = await route.POST(req({ providerId: 'p1', postcode: '' }));
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
});

test('an unknown provider is refused (404)', async () => {
    const route = load({ provider: null });
    const res = await route.POST(req({ providerId: 'nope', postcode: 'DG6 4JA' }));
    assert.equal(res.status, 404);
});

test('a collection-only provider has no reach to fail', async () => {
    const route = load({ provider: { id: 'p2', business_name: 'Collect Co', shape: 'made_to_order', fulfilment: 'collection', delivery_radius_miles: 0, collection_postcode: 'DG6 4JA' } });
    const res = await route.POST(req({ providerId: 'p2', postcode: 'DG1 1AA' }));
    assert.equal(res.body.reachable, true);
});

test('rate-limited callers are turned away (429)', async () => {
    const route = load({ limited: true });
    const res = await route.POST(req({ providerId: 'p1', postcode: 'DG6 4JA' }));
    assert.equal(res.status, 429);
});
