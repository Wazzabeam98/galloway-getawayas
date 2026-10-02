// Staying signed in (lib/staySignedIn) and the resend countdown
// (lib/signInMemory, lib/signInCode).
//
// What matters: a sign-in cookie is re-issued from the server with a year's
// life by default; a refreshed token always beats the one the browser sent (re-
// stamping the old one would sign the person out); "don't stay" makes it a
// browser-session cookie; and a code sent under a minute ago is reported as
// still good with the exact seconds left, never as "wait a minute".

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const stay = require('../lib/staySignedIn');
const memory = require('../lib/signInMemory');
const code = require('../lib/signInCode');
/* eslint-enable @typescript-eslint/no-var-requires */

const TOKEN = 'sb-hviwjxigqivjfhmhpjiy-auth-token';

test('only Supabase sign-in cookies are touched', () => {
    assert.equal(stay.isAuthCookie(TOKEN), true);
    assert.equal(stay.isAuthCookie(TOKEN + '.0'), true);
    assert.equal(stay.isAuthCookie('gg_mode'), false);
    assert.equal(stay.isAuthCookie('sb-x-auth-token-code-verifier'), false);
});

test('staying is the default; only an explicit "0" opts out', () => {
    assert.equal(stay.wantsToStay(undefined), true);
    assert.equal(stay.wantsToStay('1'), true);
    assert.equal(stay.wantsToStay('0'), false);
});

test('a year, matched to Airbnb, renewed on each visit', () => {
    const [s] = stay.stampsFor([{ name: TOKEN, value: 'old' }], [], true, true);
    assert.equal(s.options.maxAge, 365 * 24 * 60 * 60);
    assert.equal(stay.serializeStamp(s), TOKEN + '=old; Path=/; SameSite=Lax; Max-Age=31536000; Secure');
});

test('"don\'t stay" re-issues it as a cookie that ends with the browser', () => {
    const [s] = stay.stampsFor([{ name: TOKEN, value: 'old' }], [], false, true);
    assert.equal(s.options.maxAge, undefined);
    assert.doesNotMatch(stay.serializeStamp(s), /Max-Age/);
});

test('a token refreshed by the middleware wins over the one the browser sent', () => {
    const out = stay.stampsFor([{ name: TOKEN, value: 'old' }, { name: 'gg_mode', value: 'host' }], [{ name: TOKEN, value: 'new' }], true, true);
    assert.deepEqual(out.map((s: any) => [s.name, s.value]), [[TOKEN, 'new']]);
});

test('a cookie the refresh deleted is not brought back', () => {
    const out = stay.stampsFor([{ name: TOKEN + '.1', value: 'chunk' }], [{ name: TOKEN + '.1', value: '' }], true, true);
    assert.deepEqual(out, []);
});

test('raw cookie values survive untouched (they are encoded JSON)', () => {
    const raw = '%5B%22eyJ%22%2C%22r%22%5D';
    assert.deepEqual(stay.parseCookieHeader('gg_stay=1; ' + TOKEN + '=' + raw), [{ name: 'gg_stay', value: '1' }, { name: TOKEN, value: raw }]);
    assert.deepEqual(
        stay.parseSetCookies(TOKEN + '=' + raw + '; Path=/; Max-Age=100, other=x; Path=/'),
        [{ name: TOKEN, value: raw }, { name: 'other', value: 'x' }]
    );
});

function store() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('resend: the exact seconds left, per address', () => {
    const s = store();
    memory.recordCodeSent('a@b.com', 1_000_000, s);
    assert.equal(memory.secondsUntilResend('a@b.com', 1_000_000 + 18_000, s), 42);
    assert.equal(memory.secondsUntilResend('a@b.com', 1_000_000 + 61_000, s), 0);
    assert.equal(memory.secondsUntilResend('other@b.com', 1_000_000, s), 0);
});

test('Supabase\'s cooldown is read as seconds left; the site-wide limit is not', () => {
    assert.equal(code.retryAfterSeconds({ status: 429, message: 'For security purposes, you can only request this after 37 seconds.' }), 37);
    assert.equal(code.retryAfterSeconds({ status: 429, message: 'For security purposes' }), 60);
    assert.equal(code.retryAfterSeconds({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }), 0);
    assert.equal(code.retryAfterSeconds({ status: 500, message: 'boom' }), 0);
});
