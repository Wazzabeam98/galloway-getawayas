// What a deployment will tell you about itself.
//
// The e2e guard refuses to run unless this route says the target is not
// production and is writing to the test database, so the two properties below
// are load-bearing for a safety check and not merely cosmetic.
//
// The disclosure rule is the part worth pinning: on production this answers
// with the single fact needed to refuse a run, and nothing else. Adding the
// commit or the database to that branch later would be an easy, quiet mistake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const ROUTE = '@/app/api/health/route';

function load(env: Record<string, string | undefined>) {
    for (const key of ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF', 'NEXT_PUBLIC_SUPABASE_URL']) {
        delete process.env[key];
    }
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;

    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, init }) },
    });
    clearModule(ROUTE);
    return require(ROUTE.replace('@/', '../'));
}

const PREVIEW = {
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_SHA: 'abc1234def5678',
    VERCEL_GIT_COMMIT_REF: 'e2e-preview',
    NEXT_PUBLIC_SUPABASE_URL: 'https://yefoqcabuijcowoqewtc.supabase.co',
};

test('a preview says which commit and which database', async () => {
    const route = load(PREVIEW);
    const { body } = await route.GET();

    assert.equal(body.env, 'preview');
    assert.equal(body.commit, 'abc1234def5678');
    assert.equal(body.branch, 'e2e-preview');
    assert.equal(body.supabase, 'yefoqcabuijcowoqewtc',
        'the guard compares this against the test project');
});

test('production says it is production and nothing else', async () => {
    const route = load({ ...PREVIEW, VERCEL_ENV: 'production' });
    const { body } = await route.GET();

    assert.equal(body.env, 'production', 'enough for the guard to refuse');
    assert.deepEqual(Object.keys(body), ['env'],
        'the live site discloses no commit, no branch and no database');
});

test('the database is reported as a project ref, never as a URL', async () => {
    // A ref identifies which database, which is all the guard needs. Returning
    // the URL would put a live endpoint in the response for no added value.
    const route = load(PREVIEW);
    const { body } = await route.GET();

    assert.equal(String(body.supabase).includes('http'), false);
    assert.equal(String(body.supabase).includes('supabase.co'), false);
});

test('a missing Supabase URL reports null rather than guessing', async () => {
    // The guard refuses on a null. That is the correct direction for a safety
    // check to fail in, and it only works if this does not invent a value.
    const route = load({ ...PREVIEW, NEXT_PUBLIC_SUPABASE_URL: undefined });
    const { body } = await route.GET();

    assert.equal(body.supabase, null);
});

test('it is never cached', async () => {
    // A cached answer is a stale answer, and this exists to detect staleness.
    const route = load(PREVIEW);
    const { init } = await route.GET();
    assert.equal(init.headers['cache-control'], 'no-store');
});
