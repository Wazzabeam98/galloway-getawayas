// Whether a social sign-in button is allowed to render.
//
// The rule this enforces is "fail closed". Every way of not knowing the answer
// — no env, a 500, a network error, a body in a shape we don't recognise —
// has to end with the button hidden. A hidden button costs a visitor nothing;
// a button that opens Supabase and bounces them back to an error page reads as
// the whole site being broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    externalProviders,
    isProviderEnabled,
    resetProviderCache,
} = require('../lib/authProviders');

const OPTS = { url: 'https://project.supabase.co', anonKey: 'anon-key' };

function respondWith(body: any, ok = true, status = 200) {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
        calls.push(url);
        return { ok, status, json: async () => body };
    };
    return { fetchImpl, calls };
}

test('google is reported enabled only when Supabase says so', async () => {
    resetProviderCache();
    const { fetchImpl } = respondWith({ external: { google: true, email: true } });
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), true);
});

test('google disabled on the project means the button stays hidden', async () => {
    resetProviderCache();
    const { fetchImpl } = respondWith({ external: { google: false, email: true } });
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), false);
});

test('the settings endpoint is asked for, on the right host and with the key', async () => {
    resetProviderCache();
    const calls: any[] = [];
    const fetchImpl = async (url: string, init: any) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ external: { google: true } }) };
    };
    await isProviderEnabled('google', { ...OPTS, fetchImpl });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/settings');
    assert.equal(calls[0].init.headers.apikey, 'anon-key');
});

test('several buttons mounting at once share one request', async () => {
    resetProviderCache();
    const { fetchImpl, calls } = respondWith({ external: { google: true } });
    const answers = await Promise.all([
        isProviderEnabled('google', { ...OPTS, fetchImpl }),
        isProviderEnabled('google', { ...OPTS, fetchImpl }),
        isProviderEnabled('google', { ...OPTS, fetchImpl }),
    ]);
    assert.deepEqual(answers, [true, true, true]);
    assert.equal(calls.length, 1);
});

// ------------------------------------------------------------- failing closed

test('a refused request hides the button rather than showing it', async () => {
    resetProviderCache();
    const { fetchImpl } = respondWith({}, false, 500);
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), false);
});

test('a network error hides the button', async () => {
    resetProviderCache();
    const fetchImpl = async () => {
        throw new Error('offline');
    };
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl } as any), false);
});

test('a body without the shape we expect hides the button', async () => {
    resetProviderCache();
    for (const body of [null, {}, { external: null }, { external: {} }, 'nonsense']) {
        resetProviderCache();
        const { fetchImpl } = respondWith(body);
        assert.equal(
            await isProviderEnabled('google', { ...OPTS, fetchImpl }),
            false,
            `body ${JSON.stringify(body)} should hide the button`
        );
    }
});

test('a provider present but not exactly true is not treated as enabled', async () => {
    // Guards against a truthy string or 1 quietly turning the button on.
    for (const value of ['true', 1, {}, 'yes']) {
        resetProviderCache();
        const { fetchImpl } = respondWith({ external: { google: value } });
        assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), false);
    }
});

test('missing configuration hides the button without a request', async () => {
    resetProviderCache();
    const { fetchImpl, calls } = respondWith({ external: { google: true } });
    assert.equal(
        await isProviderEnabled('google', { url: '', anonKey: '', fetchImpl }),
        false
    );
    assert.equal(calls.length, 0);
});

test('a failure is not cached, so a later attempt can still succeed', async () => {
    resetProviderCache();
    const failing = async () => {
        throw new Error('offline');
    };
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl: failing } as any), false);

    // Same page, connection back. Without clearing the cache on failure this
    // would stay false until a reload.
    const { fetchImpl } = respondWith({ external: { google: true } });
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), true);
});

test('a success IS cached, so the answer does not flap mid-session', async () => {
    resetProviderCache();
    const { fetchImpl } = respondWith({ external: { google: true } });
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl }), true);

    const second = respondWith({ external: { google: false } });
    assert.equal(await isProviderEnabled('google', { ...OPTS, fetchImpl: second.fetchImpl }), true);
    assert.equal(second.calls.length, 0);
});

test('externalProviders hands back the whole map', async () => {
    resetProviderCache();
    const { fetchImpl } = respondWith({ external: { google: true, email: true, apple: false } });
    const providers = await externalProviders({ ...OPTS, fetchImpl });
    assert.equal(providers.google, true);
    assert.equal(providers.apple, false);
});
