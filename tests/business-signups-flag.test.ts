// The /business tiles, the homepage "Coming soon" bar and /register-interest
// all follow BUSINESS_SIGNUPS_OPEN. It was set to "true" on Production twice and
// the tiles stayed shut, because the check was an exact `=== 'true'` and a
// Sensitive variable cannot be read back to see what was actually typed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const { flagIsTrue, businessSignupsOpen, guestExperiencesOpen } = require('../lib/serviceOrders');

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) {
        saved[k] = process.env[k];
        if (vars[k] === undefined) delete process.env[k];
        else process.env[k] = vars[k];
    }
    try { fn(); } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

test('the ways "true" actually gets typed into Vercel all read as open', () => {
    for (const v of ['true', 'True', 'TRUE', ' true', 'true ', 'true\n', '"true"', "'true'", ' "True" ']) {
        assert.equal(flagIsTrue(v), true, JSON.stringify(v));
    }
});

test('anything else still reads as closed — the safe direction', () => {
    for (const v of [undefined, null, '', ' ', 'false', 'yes', '1', 'on', 'truee', 't rue', '"true', 'true"']) {
        assert.equal(flagIsTrue(v), false, JSON.stringify(v));
    }
});

test('on production the tiles follow the variable, read tolerantly', () => {
    withEnv({ VERCEL_ENV: 'production', BUSINESS_SIGNUPS_OPEN: 'True ' }, () => {
        assert.equal(businessSignupsOpen(), true);
    });
    withEnv({ VERCEL_ENV: 'production', BUSINESS_SIGNUPS_OPEN: undefined }, () => {
        assert.equal(businessSignupsOpen(), false, 'unset on production stays held');
    });
    withEnv({ VERCEL_ENV: 'preview', BUSINESS_SIGNUPS_OPEN: undefined }, () => {
        assert.equal(businessSignupsOpen(), true, 'previews are always open');
    });
});

test('the guest experiences switch is untouched: still exact', () => {
    withEnv({ VERCEL_ENV: 'production', GUEST_EXPERIENCES_OPEN: 'True' }, () => {
        assert.equal(guestExperiencesOpen(), false);
    });
    withEnv({ VERCEL_ENV: 'production', GUEST_EXPERIENCES_OPEN: 'true' }, () => {
        assert.equal(guestExperiencesOpen(), true);
    });
});

test('/api/health/flags says whether it is set and how it reads, never the value', async () => {
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, init }) },
    });
    clearModule('@/app/api/health/flags/route');
    const route = require('../app/api/health/flags/route');

    let res: any;
    await new Promise<void>((done) => withEnv({ VERCEL_ENV: 'production', BUSINESS_SIGNUPS_OPEN: ' TRUE ' }, () => {
        route.GET().then((r: any) => { res = r; done(); });
    }));
    // The env is restored before the promise settles only if GET awaited; it
    // does not, so the body was built with the values above.
    assert.deepEqual(res.body, { env: 'production', businessSignups: { set: true, open: true } });
    assert.ok(!JSON.stringify(res.body).includes('TRUE'), 'the value itself is not disclosed');
});
