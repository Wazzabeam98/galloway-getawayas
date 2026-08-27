// The client that asks Supabase to send an auth email must not use PKCE.
//
// Under PKCE, signUp and resetPasswordForEmail send a code_challenge and keep
// the matching verifier in the storage of the browser making the request. The
// email then carries a pkce_-prefixed token hash that only that one browser can
// redeem — so signing up on a laptop and opening the email on a phone can never
// work. People read their email on their phones.
//
// What is asserted here is the wire: no code_challenge leaves the client. That
// is the thing that decides whether the link is device-bound, and it is the
// thing that silently comes back if someone swaps this client for the ordinary
// one, or if a library upgrade reinstates the default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createEmailFlowClient } = require('../lib/supabaseEmailFlow');

const OPTS = { url: 'https://project.supabase.co', anonKey: 'anon-key' };

// Captures what the client actually puts on the wire.
function recorder(body: any = {}) {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = async (url: any, init: any) => {
        calls.push({
            url: String(url),
            body: init && init.body ? JSON.parse(init.body) : null,
        });
        return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
    return { calls, fetchImpl };
}

test('signUp sends no code_challenge, so the link is not bound to one device', async () => {
    const { calls, fetchImpl } = recorder({ user: null, session: null });
    const client = createEmailFlowClient({ ...OPTS, fetchImpl });

    await client.auth.signUp({
        email: 'guest@example.test',
        password: 'a-long-enough-password',
        options: { emailRedirectTo: 'https://site.test/auth/callback?next=/' },
    });

    const signup = calls.find((c) => c.url.includes('/signup'));
    assert.ok(signup, 'expected a request to /signup');
    assert.ok(!signup!.body.code_challenge, 'signUp must not send a code_challenge');
    assert.ok(!signup!.body.code_challenge_method, 'signUp must not send a challenge method');
});

test('the redirect the app asked for is still passed through', async () => {
    const { calls, fetchImpl } = recorder({ user: null, session: null });
    const client = createEmailFlowClient({ ...OPTS, fetchImpl });

    await client.auth.signUp({
        email: 'guest@example.test',
        password: 'a-long-enough-password',
        options: { emailRedirectTo: 'https://site.test/auth/callback?next=%2Fx' },
    });

    const signup = calls.find((c) => c.url.includes('/signup'));
    // Carried as redirect_to on the query string. It must survive, and it must
    // still have the ? that lets the email template append with a single &.
    assert.match(signup!.url, /redirect_to=/);
    assert.match(decodeURIComponent(signup!.url), /\/auth\/callback\?next=/);
});

test('resetPasswordForEmail sends no code_challenge either', async () => {
    const { calls, fetchImpl } = recorder({});
    const client = createEmailFlowClient({ ...OPTS, fetchImpl });

    await client.auth.resetPasswordForEmail('guest@example.test', {
        redirectTo: 'https://site.test/auth/callback?next=/auth/reset',
    });

    const recover = calls.find((c) => c.url.includes('/recover'));
    assert.ok(recover, 'expected a request to /recover');
    assert.ok(!recover!.body.code_challenge, 'reset must not send a code_challenge');
    assert.ok(!recover!.body.code_challenge_method, 'reset must not send a challenge method');
});

test('a session it receives is never persisted anywhere shared', async () => {
    const { fetchImpl } = recorder({
        access_token: 'a-token',
        refresh_token: 'r-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'u1' },
    });
    const client = createEmailFlowClient({ ...OPTS, fetchImpl });

    await client.auth.signUp({ email: 'guest@example.test', password: 'a-long-enough-password' });

    // persistSession is off, so the session lives in this client's memory and
    // goes no further: a fresh client cannot see it, and neither can the
    // auth-helpers client or the cookies the rest of the site reads. That is
    // why the caller has to hand it over with setSession() rather than assume
    // signing up here signs anybody in.
    const fresh = createEmailFlowClient({ ...OPTS, fetchImpl });
    const { data } = await fresh.auth.getSession();
    assert.equal(data.session, null, 'a session must not survive into another client');
});

test('a missing key is a loud failure, not a client that quietly cannot send', async () => {
    assert.throws(
        () => createEmailFlowClient({ url: 'https://project.supabase.co', anonKey: '' }),
        /required/i
    );
});
