// The agreements registry (lib/agreements.ts) and the one route that records an
// acceptance (/api/agreements).
//
// What these hold:
//   * the shared rule — no tick, or a stale version, is refused; a current
//     record needs nothing — for every document, and the host wrapper still
//     answers exactly as lib/hostTerms always did;
//   * the sign-in prompt asks for ONE document, the Guest Terms first,
//     and a role agreement only of someone in that role;
//   * the route refuses to record without the tick, and records with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require('../lib/agreements');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hostTerms = require('../lib/hostTerms');

const NONE = { isHost: false, isExperienceProvider: false, isTradesperson: false };

/* ------------------------------------------------------------ the registry */

test('every document has a title, its own /terms page, a version and a DD/MM-able day key', () => {
    const paths = new Set<string>();
    for (const key of A.AGREEMENT_ORDER) {
        const a = A.AGREEMENTS[key];
        assert.equal(a.key, key);
        assert.ok(a.title && a.version && a.textFile, key);
        assert.match(a.path, /^\/terms\/[a-z-]+$/, key);
        assert.match(a.lastUpdated, /^\d{4}-\d{2}-\d{2}$/, key);
        paths.add(a.path);
    }
    assert.equal(paths.size, 4, 'four documents, four pages');
});

test('the shared rule: no tick is refused, a stale page is refused, the current version passes', () => {
    for (const key of A.AGREEMENT_ORDER) {
        const v = A.AGREEMENTS[key].version;
        assert.match(A.agreementProblem(key, null, undefined), /Please agree to the/);
        assert.match(A.agreementProblem(key, null, 'an-old-version'), /was updated after this page loaded/);
        assert.equal(A.agreementProblem(key, null, v), null);
        assert.equal(A.agreementProblem(key, v, undefined), null, 'already on record: nothing to send');
        assert.equal(A.versionForTick(key, false), undefined);
        assert.equal(A.versionForTick(key, true), v);
    }
});

test('the host wrapper still answers as lib/hostTerms did', () => {
    const v = A.AGREEMENTS.host.version;
    assert.equal(hostTerms.HOST_TERMS_VERSION, v, 'the wrapper reads the registry');
    assert.equal(hostTerms.hasAgreedToCurrentTerms(v), true);
    assert.equal(hostTerms.hasAgreedToCurrentTerms('2026-09-28'), false, 'the pre-final host terms are asked again');
    assert.equal(hostTerms.hasAgreedToCurrentTerms(null), false);
    assert.ok(hostTerms.termsProblem(null, undefined));
    assert.equal(hostTerms.termsProblem(null, v), null);
    assert.equal(hostTerms.TERMS_LAST_UPDATED, '08/10/2026', 'DD/MM/YYYY from the day key');
});

test('the approved terms carry no draft marker, and each text states the version it is recorded as', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    for (const key of A.AGREEMENT_ORDER) {
        const a = A.AGREEMENTS[key];
        assert.doesNotMatch(a.version, /draft/i, key + ' version');
        assert.equal('draft' in a, false, key + ' has no draft flag');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', a.textFile), 'utf8');
        const body = src.slice(src.indexOf('export'));
        assert.doesNotMatch(body, /draft|to be dated/i, key + ' wording');
        const stated = body.match(/^Version: (.+)$/m);
        if (stated) assert.equal(stated[1].trim(), a.version, key + ' Version line matches the registry');
    }
});

test('the sign-in prompt: Guest Terms first, then only the role agreements the account holds', () => {
    const g = A.AGREEMENTS.guest.version;
    const h = A.AGREEMENTS.host.version;
    assert.equal(A.nextOwed(NONE, {}), 'guest', 'everyone owes the Guest Terms');
    assert.equal(A.nextOwed(NONE, { guest: [g] }), null, 'a guest with it owes nothing');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, {}), 'guest', 'one at a time — ToS before the Host Agreement');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, { guest: [g] }), 'host');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, { guest: [g], host: ['old', h] }), null, 'any current version counts');
    assert.equal(A.nextOwed({ ...NONE, isTradesperson: true }, { guest: ['2020-01-01'] }), 'guest', 'a stale version is owed again');
    assert.equal(A.nextOwed({ ...NONE, isTradesperson: true }, { guest: [g], host: [h] }), 'tradesperson',
        'a host agreement does not stand in for a trade one');
});

test('the sign-in prompt shows ROLE agreements only — never the Guest Terms', () => {
    const g = A.AGREEMENTS.guest.version;
    const t = A.AGREEMENTS.tradesperson.version;
    // A plain account owing only the Guest Terms is NOT prompted here — the Guest
    // Terms are taken at the end of sign-up and at first stay checkout instead.
    assert.equal(A.nextRoleOwed(NONE, {}), null, 'guest terms are not a sign-in prompt');
    assert.equal(A.nextRoleOwed(NONE, { guest: [g] }), null);
    // A role agreement is still prompted (e.g. an updated wording), and does not
    // wait behind the Guest Terms the way nextOwed makes it.
    assert.equal(A.nextRoleOwed({ ...NONE, isTradesperson: true }, {}), 'tradesperson',
        'a role agreement is owed even when the Guest Terms are not on record');
    assert.equal(A.nextRoleOwed({ ...NONE, isTradesperson: true }, { tradesperson: [t] }), null);
    assert.equal(A.nextRoleOwed({ ...NONE, isHost: true }, { host: ['old'] }), 'host', 'a stale role version is owed again');
});

/* ------------------------------------------------------------ the route */

const ROUTE = '@/app/api/agreements/route';

function loadRoute({ user = { id: 'u-1', user_metadata: {} } as any, rows = [] as any[] } = {}) {
    const writes: any[] = [];
    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'maybeSingle') return async () => ({ data: table === 'profiles' ? { host_terms_version: null } : null, error: null });
                    if (prop === 'upsert' || prop === 'update' || prop === 'insert') {
                        return (row: any) => { writes.push({ table, op: prop, row }); return chain; };
                    }
                    if (prop === 'then') {
                        const data = table === 'agreement_acceptances' ? rows : [];
                        return (resolve: any) => resolve({ data, error: null });
                    }
                    return () => chain;
                },
            });
            return chain;
        },
    };
    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/logError', { logError: async () => {} });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/agreementRecords');
    clearModule(ROUTE);
    return { route: require(ROUTE), writes };
}

const post = (body: any) => new Request('http://x/api/agreements', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('POST without the tick (no version) is refused and records nothing', async () => {
    for (const document of A.AGREEMENT_ORDER) {
        const { route, writes } = loadRoute();
        const res = await route.POST(post({ document }));
        assert.equal(res.status, 400, document);
        assert.equal(res.body.needsAgreement, true);
        assert.match(res.body.error, /Please agree to the/);
        assert.equal(writes.length, 0, 'nothing written');
    }
});

test('POST with a stale version is refused', async () => {
    const { route, writes } = loadRoute();
    const res = await route.POST(post({ document: 'tradesperson', version: 'draft-2000-01-01' }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /was updated after/);
    assert.equal(writes.length, 0);
});

test('POST for an unknown document, or signed out, is refused', async () => {
    const { route } = loadRoute();
    assert.equal((await route.POST(post({ document: 'nonsense', version: 'x' }))).status, 400);
    const signedOut = loadRoute({ user: null });
    assert.equal((await signedOut.route.POST(post({ document: 'guest', version: A.AGREEMENTS.guest.version }))).status, 401);
});

test('POST with the current version records it, and a host acceptance also keeps profiles in step', async () => {
    const { route, writes } = loadRoute();
    const res = await route.POST(post({ document: 'host', version: A.AGREEMENTS.host.version }));
    assert.equal(res.status, 200);
    const row = writes.find((w) => w.table === 'agreement_acceptances');
    assert.equal(row.row.document, 'host');
    assert.equal(row.row.version, A.AGREEMENTS.host.version);
    assert.equal(row.row.user_id, 'u-1');
    const prof = writes.find((w) => w.table === 'profiles');
    assert.equal(prof.row.host_terms_version, A.AGREEMENTS.host.version);
});

test('GET names the one document owed next', async () => {
    const fresh = loadRoute();
    const res = await fresh.route.GET();
    assert.equal(res.body.next, 'guest');
    assert.equal(res.body.documents.guest.agreed, false);

    const done = loadRoute({ rows: [{ document: 'guest', version: A.AGREEMENTS.guest.version }] });
    const res2 = await done.route.GET();
    assert.equal(res2.body.next, null);
    assert.equal(res2.body.documents.guest.agreed, true);
});

/* ------------------------------------------------- the dashboard update notice */

test('every agreement bumped past its first version says what changed, in a line or two', () => {
    for (const key of A.AGREEMENT_ORDER) {
        const a = A.AGREEMENTS[key];
        if (/^v1-/.test(a.version)) continue;
        assert.ok(a.changeSummary && a.changeSummary.trim().length > 0, key + ' was bumped to ' + a.version + ' with no changeSummary for the update notice');
        assert.ok(a.changeSummary.length <= 240, key + ' changeSummary is a line or two, not the agreement');
    }
});

test('the update notice asks only a role holder who has not agreed to the current version, and never for the Guest Terms', () => {
    const N = A.agreementUpdateNotice;
    assert.equal(N('host', { agreed: true, earlier: false, required: true }), null, 'agreed: nothing shown');
    assert.equal(N('host', { agreed: false, earlier: true, required: false }), null, 'not a host: nothing shown');
    assert.equal(N('host', null), null, 'status unknown: nothing shown');
    assert.equal(N('guest', { agreed: false, earlier: true, required: true }), null, 'the Guest Terms are asked at checkout');
    const update = N('host', { agreed: false, earlier: true, required: true });
    assert.ok(update && update.earlier, 'an older version on record: shown as an update');
    assert.equal(update.summary, A.AGREEMENTS.host.changeSummary, 'with what changed');
    const fresh = N('tradesperson', { agreed: false, earlier: false, required: true });
    assert.ok(fresh && !fresh.earlier && fresh.summary === '', 'never agreed: asked plainly, no "what changed"');
});
