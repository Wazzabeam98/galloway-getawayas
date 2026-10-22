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

function loadPublish({ status, payoutsEnabled = false, termsVersion = null, named = true, declinedAt = null, actorId = HOST, coHostPermission = null }: { status: string; payoutsEnabled?: boolean; termsVersion?: string | null; named?: boolean; declinedAt?: string | null; actorId?: string; coHostPermission?: boolean | null }) {
    const updates: any[] = [];
    const sent: any[] = [];
    const listing = {
        id: 'l-1', host_id: HOST, title: 'Heron Cottage', price_per_night: 120, status,
        images: ['a', 'b', 'c', 'd', 'e'],
        street_address: '1 Harbour Row', postcode: 'DG6 4JG', latitude: 54.8, longitude: -4.05,
        declined_at: declinedAt,
    };
    const profile = {
        stripe_payouts_enabled: payoutsEnabled, host_terms_version: termsVersion,
        first_name: named ? 'Morag' : null, last_name: named ? 'MacLellan' : null,
        email: 'morag@heroncottage.co.uk',
    };
    // The listing_access row checkListing reads for a non-owner actor. A
    // full-access co-host has every permission; coHostPermission:false models a
    // co-host WITHOUT can_listing.
    const accessRow = coHostPermission === null ? null : {
        id: 'acc-1', role: 'co_host',
        can_calendar: true, can_messages: true, can_bookings: true,
        can_listing: coHostPermission, can_earnings: true,
    };

    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'maybeSingle') return async () => ({
                        data: table === 'profiles' ? profile : table === 'listing_access' ? accessRow : listing,
                        error: null,
                    });
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
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: actorId } } }) } }),
        createServerComponentClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/listingRules', { addressBlockerForPublish: () => null, NEW_LISTING_MIN_PHOTOS: 5 });
    stubModule('@/lib/postcodeGeocode', { coordinatePatchFor: async () => ({}) });
    stubModule('@/lib/logError', { logError: async () => {} });
    // The host's "it's in review" email (lib/listingSubmittedConfirm) — captured,
    // never sent. Additive: nothing above asserted on email.
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return true; },
        emailLayout: (body: string) => body,
        escapeHtml: (x: string) => String(x),
        button: (url: string, label: string) => '[' + label + '](' + url + ')',
        SITE_URL: 'http://example.invalid',
        COTTAGE_SUBTITLE: '',
    });

    clearModule('@/lib/supabaseAdmin');
    // access.ts binds adminClient at import; re-require it each time so checkListing
    // reads through THIS test's admin stub, not a stale one.
    clearModule('@/lib/access');
    clearModule('@/lib/listingSubmittedConfirm');
    clearModule(ROUTE);
    return { route: require(ROUTE), updates, sent };
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

// The host's first and last name are required to publish (lib/personName,
// 19 Oct 2026): guests see "Hosted by" and a first name. The wizard asks
// first; this is the server holding the line.
test('a host with no first and last name cannot publish, and nothing changes', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION, named: false });
    const res = await route.POST(post());
    assert.equal(res.status, 400);
    assert.equal(res.body.needsName, true);
    assert.equal(updates.length, 0);
});

/* --------------------------------------------- a co-host submits a draft */
// A full-access co-host (can_listing) may submit the owner's draft for review,
// exactly as the owner would — the #440 class, where the page opens for the
// co-host but the write behind it is refused. The owner's name and terms are
// already on record (the normal onboarding case), so nothing walls it.
const COHOST = 'cohost-1';

test('a full-access co-host can submit the owner’s draft for review', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION, actorId: COHOST, coHostPermission: true });
    const res = await route.POST(post());
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'pending_review');
    assert.ok(updates.some((u) => u.table === 'listings' && u.patch.status === 'pending_review'));
});

test('a co-host WITHOUT can_listing is refused', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION, actorId: COHOST, coHostPermission: false });
    const res = await route.POST(post());
    assert.equal(res.status, 403);
    assert.equal(updates.length, 0);
});

test('a stranger with no access is refused', async () => {
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION, actorId: 'stranger', coHostPermission: null });
    const res = await route.POST(post());
    assert.equal(res.status, 403);
    assert.equal(updates.length, 0);
});

test('a co-host cannot submit when the OWNER has not accepted the current terms', async () => {
    // The co-host cannot agree for the owner; refused with an explained message,
    // not a silent 403, and nothing changes.
    const { route, updates } = loadPublish({ status: 'draft', termsVersion: null, actorId: COHOST, coHostPermission: true });
    const res = await route.POST(post({ termsVersion: HOST_TERMS_VERSION }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /owner needs to accept/i);
    assert.equal(res.body.needsTerms, undefined, 'the co-host is not shown the owner’s agree box');
    assert.equal(updates.length, 0);
});

/* ------------------------------------------------------------ "it's in review" */
// The host twin of the provider's confirmation: sent when the listing moves INTO
// review, and only then.

test('a first submit tells the host it is in review, linking to the listing', async () => {
    const { route, sent } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION });
    const res = await route.POST(post());
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1, 'one confirmation');
    assert.equal(sent[0].to, 'morag@heroncottage.co.uk');
    assert.match(sent[0].subject, /got your listing.*in review/);
    assert.match(sent[0].html, /Hello Morag/);
    assert.match(sent[0].html, /Heron Cottage/);
    assert.match(sent[0].html, /\[See your listing\]\(http:\/\/example\.invalid\/edit-listing\/l-1\)/);
    assert.doesNotMatch(sent[0].html, /again with your changes/);
});

test('a listing sent back and submitted again says so', async () => {
    const { route, sent } = loadPublish({ status: 'draft', termsVersion: HOST_TERMS_VERSION, declinedAt: '2026-10-01T10:00:00Z' });
    await route.POST(post());
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /again with your changes/);
});

test('no confirmation when nothing goes into review', async () => {
    for (const status of ['published', 'hidden']) {
        const { route, sent } = loadPublish({ status, termsVersion: HOST_TERMS_VERSION });
        await route.POST(post());
        assert.equal(sent.length, 0, status + ': back up without a review, nothing to confirm');
    }
    const again = loadPublish({ status: 'pending_review', termsVersion: HOST_TERMS_VERSION });
    await again.route.POST(post());
    assert.equal(again.sent.length, 0, 'a second press while waiting sends nothing more');
});

test('a refused submit sends nothing', async () => {
    const { route, sent } = loadPublish({ status: 'draft' });
    const res = await route.POST(post());
    assert.equal(res.status, 400);
    assert.equal(sent.length, 0);
});
