// Submitting a listing for review (/api/listings/publish).
//
// The order is Airbnb's: list → submit → an owner approves → live and bookable.
// Payout setup is NOT a condition of submitting any more — it comes after
// approval, and the payout run holds a host's money until they've done it. What
// IS a condition is the host's agreement to the terms, recorded (version and
// server time) on their profile the first time they submit.
//
// This file replaced publish-requires-payout.test.ts, which asserted the old
// order (no payouts → refused). That rule was deliberately removed, not broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const HOST = 'host-1';
const ROUTE = '@/app/api/listings/publish/route';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HOST_TERMS_VERSION } = require('../lib/hostTerms');

function loadPublish({ status, payoutsEnabled = false, termsVersion = null }: { status: string; payoutsEnabled?: boolean; termsVersion?: string | null }) {
    const updates: any[] = [];
    const listing = {
        id: 'l-1', host_id: HOST, title: 'Heron Cottage', price_per_night: 120, status,
        images: ['a', 'b', 'c', 'd', 'e'],
        street_address: '1 Harbour Row', postcode: 'DG6 4JG', latitude: 54.8, longitude: -4.05,
    };
    const profile = { stripe_payouts_enabled: payoutsEnabled, host_terms_version: termsVersion };

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

const post = (extra: any = {}) => new Request('http://x/api/listings/publish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: 'l-1', ...extra }),
});

const termsWrite = (updates: any[]) => updates.find((u) => u.table === 'profiles' && 'host_terms_version' in u.patch);

/* ------------------------------------------------------------ the terms */

test('a first submit with no agreement on record, and no tick, is refused and nothing changes', async () => {
    const { route, updates } = loadPublish({ status: 'draft' });
    const res = await route.POST(post());
    assert.equal(res.status, 400);
    assert.equal(res.body.needsTerms, true, 'the wizard is told to show the agree box');
    assert.equal(res.body.termsVersion, HOST_TERMS_VERSION);
    assert.deepEqual(updates, [], 'not submitted, and no agreement recorded');
});

test('ticking the box records the version and the time, and submits for review', async () => {
    const { route, updates } = loadPublish({ status: 'draft' });
    const res = await route.POST(post({ termsVersion: HOST_TERMS_VERSION }));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'pending_review');
    const w = termsWrite(updates);
    assert.ok(w, 'the agreement is recorded on the profile');
    assert.equal(w.patch.host_terms_version, HOST_TERMS_VERSION);
    assert.ok(!Number.isNaN(Date.parse(w.patch.host_terms_agreed_at)), 'with a real timestamp, set by the server');
});

test('an agreement to an OLD version does not count — the host must agree again', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: '2020-01-01' });
    const res = await route.POST(post());
    assert.equal(res.status, 400);
    assert.equal(res.body.needsTerms, true);
    assert.deepEqual(updates, []);
});

test('a stale page sending an old version is refused rather than recording it', async () => {
    const { route, updates } = loadPublish({ status: 'draft' });
    const res = await route.POST(post({ termsVersion: '2020-01-01' }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /updated/);
    assert.equal(termsWrite(updates), undefined);
});

test('a host already on the current version is not asked again, and nothing is re-stamped', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION });
    const res = await route.POST(post());
    assert.equal(res.body.ok, true);
    assert.equal(termsWrite(updates), undefined, 'the original agreement time is kept');
});

/* ------------------------------------------------ payouts no longer gate it */

test('a host with NO payout account can submit — payouts come after approval', async () => {
    const { route } = loadPublish({ status: 'draft', payoutsEnabled: false });
    const res = await route.POST(post({ termsVersion: HOST_TERMS_VERSION }));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.needsPayoutSetup, undefined);
});

/* ------------------------------------------------------ the approval gate */

test('a first submit waits for approval — it is never written as published', async () => {
    const { route, updates } = loadPublish({ status: 'draft', payoutsEnabled: true });
    const res = await route.POST(post({ termsVersion: HOST_TERMS_VERSION }));
    assert.equal(res.body.status, 'pending_review');
    assert.ok(updates.some((u) => u.table === 'listings' && u.patch.status === 'pending_review'));
    assert.ok(!updates.some((u) => u.table === 'listings' && u.patch.status === 'published'));
});

test('a listing that has been live before is not queued again, and is not asked for terms', async () => {
    const { route, updates } = loadPublish({ status: 'hidden' });
    const res = await route.POST(post());
    assert.equal(res.body.status, 'published');
    assert.equal(termsWrite(updates), undefined);
});

test('an already-published listing is left alone', async () => {
    const { route } = loadPublish({ status: 'published' });
    const res = await route.POST(post());
    assert.equal(res.body.ok, true);
});
