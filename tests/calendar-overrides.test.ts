// The calendar's Manage dates panel (prices, minimum stays, blocks, reset).
//
// Wendy, a real host, got "new row violates row-level security policy for table
// calendar_overrides" saving a price on 19/10/2026. The panel wrote straight
// from the browser, guarded by a policy that knows only the owner, so co-hosts
// with calendar permission were always refused and a lapsed sign-in looked the
// same. It now saves through /api/listings/calendar, which checks the caller
// with the shared helper — owner or calendar co-host, any listing status.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, clearModule } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { checkOverridePatch, checkOverrideDates } = require('../lib/calendarOverrides');

test('the shared check: prices, minimum stays and dates', () => {
    const ok = checkOverridePatch({ dates: ['2026-12-14', '2026-12-15', '2026-12-14'], is_blocked: false, price_override: '150', min_nights_override: '3' });
    assert.deepEqual(ok, { ok: true, patch: { dates: ['2026-12-14', '2026-12-15'], is_blocked: false, price_override: 150, min_nights_override: 3 } });
    assert.deepEqual(checkOverridePatch({ dates: ['2026-12-14'], price_override: '', min_nights_override: '' }).patch,
        { dates: ['2026-12-14'], is_blocked: false, price_override: null, min_nights_override: null }, 'blank means the default');
    assert.equal(checkOverridePatch({ dates: ['2026-12-14'], is_blocked: true }).patch.is_blocked, true);
    for (const bad of [
        { dates: [] },
        { dates: ['14/12/2026'] },
        { dates: ['2026-12-14'], price_override: 0 },
        { dates: ['2026-12-14'], price_override: 5001 },
        { dates: ['2026-12-14'], price_override: 'abc' },
        { dates: ['2026-12-14'], min_nights_override: 0 },
        { dates: ['2026-12-14'], min_nights_override: 1.5 },
        { dates: Array.from({ length: 401 }, (_, i) => '2027-01-01') },
    ]) assert.equal(checkOverridePatch(bad).ok, false, JSON.stringify(bad).slice(0, 80));
    assert.deepEqual(checkOverrideDates({ dates: ['2026-12-14'] }), { ok: true, dates: ['2026-12-14'] });
});

test('the page no longer writes calendar_overrides from the browser, and checks before sending', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/dashboard/calendar/page.tsx'), 'utf8');
    const writes = src.match(/from\('calendar_overrides'\)\s*\.(upsert|insert|update|delete)/g);
    assert.equal(writes, null, 'browser writes: ' + writes);
    assert.match(src, /fetch\('\/api\/listings\/calendar', \{\s*method: 'POST'/);
    assert.match(src, /fetch\('\/api\/listings\/calendar', \{\s*method: 'DELETE'/);
    assert.match(src, /checkOverridePatch\(/, 'the same check as the server');
});

/* ---------------- the route, with its dependencies stood in for ---------------- */

const LISTING = 'l1';
let signedIn: string | null;
const written: any[] = [];

function load() {
    stubModule('@supabase/auth-helpers-nextjs', { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: signedIn } : null } }) } }) });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/logError', { logError: async () => {} });
    // The shared helper, as it answers: the owner and a calendar co-host may;
    // a co-host without calendar permission and a stranger may not. The
    // listing's status is not an input — a hidden listing answers the same.
    stubModule('@/lib/access', { checkListing: async (uid: string, lid: string, perm: string) => {
        assert.equal(perm, 'can_calendar');
        return lid === LISTING && (uid === 'owner' || uid === 'calendar-cohost') ? { listingId: lid } : null;
    } });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => ({
        upsert: async (rows: any) => { written.push({ t, rows }); return { error: null }; },
        delete: () => ({ eq: () => ({ in: async (_c: string, d: string[]) => { written.push({ t, deleted: d }); return { error: null }; } }) }),
    }) }) });
    clearModule('@/app/api/listings/calendar/route');
    return require('../app/api/listings/calendar/route');
}

const req = (body: any) => new Request('http://x/api/listings/calendar', { method: 'POST', body: JSON.stringify(body) });
const SAVE = { listingId: LISTING, dates: ['2026-12-14', '2026-12-15'], is_blocked: false, price_override: 150, min_nights_override: null };

test('the owner and a co-host with calendar permission can save and reset; nobody else can', async () => {
    const route = load();
    for (const who of ['owner', 'calendar-cohost']) {
        signedIn = who; written.length = 0;
        const r = await route.POST(req(SAVE));
        assert.equal(r.status, 200, who);
        assert.equal(written[0].rows.length, 2);
        assert.equal(written[0].rows[0].price_override, 150);
        const d = await route.DELETE(req({ listingId: LISTING, dates: ['2026-12-14'] }));
        assert.equal(d.status, 200);
        assert.deepEqual(written[1].deleted, ['2026-12-14']);
    }
    for (const who of ['messages-only-cohost', 'stranger']) {
        signedIn = who; written.length = 0;
        assert.equal((await route.POST(req(SAVE))).status, 403, who);
        assert.equal((await route.DELETE(req({ listingId: LISTING, dates: ['2026-12-14'] }))).status, 403, who);
        assert.equal(written.length, 0, 'nothing written for ' + who);
    }
});

test('signed out is told to log in again, not shown a database error', async () => {
    const route = load();
    signedIn = null;
    const r = await route.POST(req(SAVE));
    assert.equal(r.status, 401);
    assert.match(r.body.error, /log in again/);
});

test('bad input is refused before anything is written', async () => {
    const route = load();
    signedIn = 'owner'; written.length = 0;
    assert.equal((await route.POST(req({ ...SAVE, price_override: 9999 }))).status, 400);
    assert.equal(written.length, 0);
});

test('the calendar-read GET that the change-dates picker uses is still there, unchanged', () => {
    const route = load();
    assert.equal(typeof route.GET, 'function');
    const src = fs.readFileSync(path.join(ROOT, 'app/api/listings/calendar/route.ts'), 'utf8');
    assert.match(src, /return NextResponse\.json\(await guestCalendar\(listingId\)\);/);
});

test('the route asks the shared helper and never looks at the listing’s status', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/listings/calendar/route.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.match(src, /checkListing\(user\.id, listingId, 'can_calendar'\)/);
    assert.match(src, /getUser\(\)/);
    assert.doesNotMatch(src, /status\s*[!=]==?\s*'(published|hidden|pending)/, 'hidden, paused and pending listings are managed like live ones');
});
