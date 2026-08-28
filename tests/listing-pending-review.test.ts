// The groundwork for putting host listings behind approval.
//
// Nothing writes 'pending_review' yet. That is the point: the status exists in
// the constraint and every screen and route knows what to do with it BEFORE
// anything can create one. A host must never press Submit and watch their
// property vanish off their own dashboard three weeks before launch.
//
// Two of these are holes rather than displays, and both were the same shape —
// code that named what was FORBIDDEN and let everything else through, which is
// safe exactly until a new status exists:
//
//   app/homes/[id]/page.tsx hid 'draft' and showed the rest, so a listing
//   waiting for approval would have been public and bookable at its own URL.
//
//   /api/listings/visibility refused 'draft' and let the rest through, so a
//   host could have called it with hidden:false and set their own pending
//   listing to 'published' — self-approval in one request, the hole column
//   grants closed for providers.
//
// Both now name what is ALLOWED. A status added later is invisible and
// immovable until somebody decides otherwise, which is the safe direction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const HOST = 'host-1';
const ROUTE = '@/app/api/listings/visibility/route';

/* ------------------------------------------------ the self-approval hole */

function loadVisibility(status: string) {
    const updates: any[] = [];

    const admin: any = {
        from() {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'maybeSingle') return async () => ({ data: { status }, error: null });
                    if (prop === 'update') {
                        return (patch: any) => { updates.push(patch); return chain; };
                    }
                    if (prop === 'then') return (resolve: any) => resolve({ data: null, error: null });
                    return () => chain;
                },
            });
            return chain;
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getSession: async () => ({ data: { session: { user: { id: HOST } } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    // Permission is not what is under test here — the caller is allowed.
    stubModule('@/lib/access', { checkListing: async () => ({ isOwner: true }) });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    return { route: require(ROUTE), updates };
}

const post = (body: any) => new Request('http://x/api/listings/visibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

test('a host cannot publish their own listing by un-hiding it', async () => {
    // The hole. Before the fix this returned ok and wrote status: 'published',
    // which is a host approving their own listing in one request.
    const { route, updates } = loadVisibility('pending_review');
    const res = await route.POST(post({ listingId: 'l-1', hidden: false }));

    assert.equal(res.status, 400, 'a pending listing is not toggleable');
    assert.equal(res.body.ok, false);
    assert.deepEqual(updates, [], 'nothing may be written');
});

test('a host cannot hide a listing that is waiting for approval either', async () => {
    // Not merely the unhide direction: a pending listing is not the host's to
    // move at all until somebody has looked at it.
    const { route, updates } = loadVisibility('pending_review');
    const res = await route.POST(post({ listingId: 'l-1', hidden: true }));

    assert.equal(res.status, 400);
    assert.deepEqual(updates, []);
});

test('a draft is still refused, as it always was', async () => {
    const { route, updates } = loadVisibility('draft');
    const res = await route.POST(post({ listingId: 'l-1', hidden: true }));

    assert.equal(res.status, 400);
    assert.deepEqual(updates, []);
});

test('hiding and un-hiding a live listing still works', async () => {
    // The case that must not move. This is the whole purpose of the route.
    const hide = loadVisibility('published');
    const hidden = await hide.route.POST(post({ listingId: 'l-1', hidden: true }));
    assert.equal(hidden.body.ok, true);
    assert.deepEqual(hide.updates, [{ status: 'hidden' }]);

    const show = loadVisibility('hidden');
    const shown = await show.route.POST(post({ listingId: 'l-1', hidden: false }));
    assert.equal(shown.body.ok, true);
    assert.deepEqual(show.updates, [{ status: 'published' }]);
});

/* -------------------------------------- the screens know the new status */

test('the public listing page names what is visible rather than what is not', () => {
    // Read as source because the page is an async server component that reaches
    // for cookies and Supabase before it decides anything — loading it here
    // would test the stubs, not the rule. What matters is the SHAPE: an
    // allow-list, so a status added later is invisible by default.
    const page = read('app/homes/[id]/page.tsx');

    assert.match(page, /PUBLICLY_VISIBLE\s*=\s*\[[^\]]*'published'[^\]]*\]/,
        'published must be on the visible list');
    assert.doesNotMatch(page, /home\.status === 'draft'/,
        'the old blocklist is still there — a new status would be public');
    assert.doesNotMatch(page, /PUBLICLY_VISIBLE\s*=\s*\[[^\]]*'pending_review'/,
        'a listing waiting for approval must not be publicly visible');
});

test('a host waiting for approval still sees their listing on the dashboard', () => {
    // The three-weeks-before-launch failure: a host presses Submit and their
    // property is in neither the live list nor the drafts list, so it simply
    // is not there any more.
    const page = read('app/dashboard/page.tsx');

    const publishedFilter = page.match(/const published = owned\.filter\([\s\S]*?\);/);
    assert.ok(publishedFilter, 'could not find the dashboard filter');
    assert.match(publishedFilter![0], /pending_review/,
        'a pending listing falls through both filters and vanishes');

    assert.match(page, /Waiting for approval/, 'the host is told what state it is in');
});

test('the owner tools count what is waiting', () => {
    const page = read('app/admin/listings/page.tsx');
    assert.match(page, /status === 'pending_review'/);
    assert.match(page, /waiting for approval/);
});

test('every status a listing can hold is displayed somewhere', () => {
    // The constraint and the screens have to agree. If a value is added to one
    // and not the other, a listing lands in a state nothing renders — which is
    // how it disappears rather than how it looks wrong.
    const migration = read('supabase/migrations/20260828143000_listing_pending_review.sql');
    const values = (migration.match(/check \(status in \(([^)]*)\)/) || [])[1] || '';
    const statuses = values.split(',').map((s: string) => s.trim().replace(/'/g, ''));

    assert.deepEqual(statuses, ['draft', 'pending_review', 'published', 'hidden']);

    const dashboard = read('app/dashboard/page.tsx');
    for (const status of statuses) {
        assert.match(dashboard, new RegExp("'" + status + "'"),
            `the host dashboard does not mention '${status}', so a listing in it is invisible`);
    }
});
