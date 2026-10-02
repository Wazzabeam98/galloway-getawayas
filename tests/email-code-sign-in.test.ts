// The shared "What's your email?" first step (lib/emailCodeSignIn).
//
// What matters here: the code path creates-or-signs-in with one call and never
// reveals which; a password account can still log in with its password; and
// Supabase's raw wording never reaches the person.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = require('../lib/emailCodeSignIn');

function fakeClient(over: Partial<Record<string, any>> = {}) {
    const calls: any[] = [];
    const client = {
        auth: {
            signInWithOtp: async (a: any) => { calls.push(['otp', a]); return over.otp ?? { error: null }; },
            verifyOtp: async (a: any) => { calls.push(['verify', a]); return over.verify ?? { data: { session: { user: { id: 'u1' } } }, error: null }; },
            signInWithPassword: async (a: any) => { calls.push(['password', a]); return over.password ?? { data: { session: { user: { id: 'u1' } } }, error: null }; },
        },
    };
    return { client, calls };
}

test('sendCode creates-or-signs-in with one call, on the tidied address', async () => {
    const { client, calls } = fakeClient();
    const r = await lib.sendCode(client, '  Liam@Example.COM ');
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [['otp', { email: 'liam@example.com', options: { shouldCreateUser: true } }]]);
});

test('sendCode refuses an address with no @ without calling Supabase', async () => {
    const { client, calls } = fakeClient();
    const r = await lib.sendCode(client, 'liam.example.com');
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0);
});

test('the per-address cooldown and the site-wide email limit read differently', async () => {
    const { client } = fakeClient({ otp: { error: { status: 429, message: 'For security purposes, you can only request this after 42 seconds.' } } });
    assert.match((await lib.sendCode(client, 'a@b.co')).message, /just sent a code/);
    // Nothing went out on this one, so it must not tell them to use a code.
    const { client: c2 } = fakeClient({ otp: { error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } } });
    const m = (await lib.sendCode(c2, 'a@b.co')).message;
    assert.match(m, /too many emails have gone out/);
    assert.doesNotMatch(m, /code we (already )?sent/);
});

test('verifyCode tidies a pasted code and uses the email OTP type', async () => {
    const { client, calls } = fakeClient();
    const r = await lib.verifyCode(client, 'a@b.co', ' 123 456\n');
    assert.equal(r.ok, true);
    assert.deepEqual(calls[0], ['verify', { email: 'a@b.co', token: '123456', type: 'email' }]);
});

test('an expired code reads as expired, and a short code is caught locally', async () => {
    const { client } = fakeClient({ verify: { data: null, error: { message: 'Token has expired or is invalid' } } });
    assert.match((await lib.verifyCode(client, 'a@b.co', '123456')).message, /may have expired/);
    const { client: c2, calls } = fakeClient();
    assert.equal((await lib.verifyCode(c2, 'a@b.co', '123')).ok, false);
    assert.equal(calls.length, 0);
});

test('an existing password account still logs in with its password', async () => {
    const { client, calls } = fakeClient();
    const r = await lib.logInWithPassword(client, 'Host@Example.com', 'secret-pass');
    assert.equal(r.ok, true);
    assert.deepEqual(calls[0], ['password', { email: 'host@example.com', password: 'secret-pass' }]);
});

test('a wrong password never says whether the address exists', async () => {
    const { client } = fakeClient({ password: { data: null, error: { message: 'Invalid login credentials' } } });
    const r = await lib.logInWithPassword(client, 'a@b.co', 'nope');
    assert.equal(r.ok, false);
    assert.match(r.message, /don’t match/);
    assert.doesNotMatch(r.message, /no account|not found|doesn’t exist/i);
});

test('the name is asked only when the account has none', () => {
    assert.equal(lib.needsName(''), true);
    assert.equal(lib.needsName('   '), true);
    assert.equal(lib.needsName(null), true);
    assert.equal(lib.needsName('Liam Worrall'), false);
});
