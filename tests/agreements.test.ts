// The agreements registry (lib/agreements.ts) and the one route that records an
// acceptance (/api/agreements).
//
// What these hold:
//   * the shared rule — no tick, or a stale version, is refused; a current
//     record needs nothing — for every document, and the host wrapper still
//     answers exactly as lib/hostTerms always did;
//   * the sign-in prompt asks for ONE document, the Terms of Service first,
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
        assert.match(A.agreementProblem(key, null, 'an-old-version'), /has been updated since this page loaded/);
        assert.equal(A.agreementProblem(key, null, v), null);
        assert.equal(A.agreementProblem(key, v, undefined), null, 'already on record: nothing to send');
        assert.equal(A.versionForTick(key, false), undefined);
        assert.equal(A.versionForTick(key, true), v);
    }
});

test('the host wrapper still answers as lib/hostTerms did', () => {
    assert.equal(hostTerms.HOST_TERMS_VERSION, '2026-09-28', 'unchanged, so hosts who agreed are not asked again');
    assert.equal(hostTerms.hasAgreedToCurrentTerms('2026-09-28'), true);
    assert.equal(hostTerms.hasAgreedToCurrentTerms(null), false);
    assert.ok(hostTerms.termsProblem(null, undefined));
    assert.equal(hostTerms.termsProblem(null, '2026-09-28'), null);
    assert.equal(hostTerms.TERMS_LAST_UPDATED, '28/09/2026', 'DD/MM/YYYY from the day key');
});

test('the sign-in prompt: Terms of Service first, then only the role agreements the account holds', () => {
    const g = A.AGREEMENTS.guest.version;
    const h = A.AGREEMENTS.host.version;
    assert.equal(A.nextOwed(NONE, {}), 'guest', 'everyone owes the Terms of Service');
    assert.equal(A.nextOwed(NONE, { guest: [g] }), null, 'a guest with it owes nothing');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, {}), 'guest', 'one at a time — ToS before the Host Agreement');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, { guest: [g] }), 'host');
    assert.equal(A.nextOwed({ ...NONE, isHost: true }, { guest: [g], host: ['old', h] }), null, 'any current version counts');
    assert.equal(A.nextOwed({ ...NONE, isTradesperson: true }, { guest: ['2020-01-01'] }), 'guest', 'a stale version is owed again');
    assert.equal(A.nextOwed({ ...NONE, isTradesperson: true }, { guest: [g], host: [h] }), 'tradesperson',
        'a host agreement does not stand in for a trade one');
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
    assert.match(res.body.error, /has been updated/);
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
