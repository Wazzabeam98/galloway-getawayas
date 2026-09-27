// Publishing a listing must require a Stripe payout account the FIRST time it
// goes live, so a host can never take real bookings with nowhere for the money
// to go. An already-live or paused ('hidden') listing has been through this once
// and is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const HOST = 'host-1';
const ROUTE = '@/app/api/listings/publish/route';

function loadPublish({ status, payoutsEnabled }: { status: string; payoutsEnabled: boolean }) {
    const updates: any[] = [];
    const listing = {
        id: 'l-1', host_id: HOST, title: 'Heron Cottage', price_per_night: 120, status,
        images: ['a', 'b', 'c', 'd', 'e'],
        street_address: '1 Harbour Row', postcode: 'DG6 4JG', latitude: 54.8, longitude: -4.05,
    };
    const profile = { stripe_payouts_enabled: payoutsEnabled };

    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'maybeSingle') return async () => ({ data: table === 'profiles' ? profile : listing, error: null });
                    if (prop === 'update') return (patch: any) => { updates.push({ table, patch }); return chain; };
                    if (prop === 'then') return (resolve: any) => resolve({ data: null, error: null });
                    return () => chain;
                },
            });
            return chain;
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: HOST } } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/listingRules', { addressBlockerForPublish: () => null, NEW_LISTING_MIN_PHOTOS: 5 });
    stubModule('@/lib/postcodeGeocode', { coordinatePatchFor: async () => ({}) });
    stubModule('@/lib/logError', { logError: async () => {} });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    return { route: require(ROUTE), updates };
}

const post = () => new Request('http://x/api/listings/publish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: 'l-1' }),
});

test('a first publish with no payout account is refused and nothing is published', async () => {
    const { route, updates } = loadPublish({ status: 'draft', payoutsEnabled: false });
    const res = await route.POST(post());
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.needsPayoutSetup, true, 'the wizard is told to prompt for payout setup');
    assert.deepEqual(updates, [], 'the listing is not set to published');
});

test('a first publish WITH a payout account goes live', async () => {
    const { route, updates } = loadPublish({ status: 'draft', payoutsEnabled: true });
    const res = await route.POST(post());
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'published');
    assert.ok(updates.some((u) => u.table === 'listings' && u.patch.status === 'published'), 'the listing is published');
});

test('an already-published listing is left alone even without a payout flag', async () => {
    // "Leave already-published listings alone" — re-saving a live listing must not
    // be blocked by the new gate.
    const { route } = loadPublish({ status: 'published', payoutsEnabled: false });
    const res = await route.POST(post());
    assert.equal(res.body.ok, true, 'a live listing is not disturbed by the payout gate');
});
