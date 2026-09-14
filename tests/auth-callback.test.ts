// What the auth callback does with a link, and — since the interstitial fix —
// WHEN it spends the token.
//
// Two rules this enforces:
//   1. A session is the only thing that counts as success. The route used to
//      check `error` alone, so a reply that complained about nothing and
//      returned nothing fell through to the redirect: the visitor landed
//      signed out with no sign anything failed. A failed link and a working one
//      looked identical, which is what made a misdirected link slow to spot.
//   2. A GET carrying an email token consumes NOTHING — it renders an
//      interstitial. The token is verified only on the POST the button makes.
//      This is what stops a mail scanner's GET spending the link before the
//      recipient opens it. (Rule 1 then applies to that POST.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule } from './helpers/stub';

installAliases();

stubModule('next/headers', { cookies: () => ({}) });

// The auth reply the route is about to receive. `verifyOtp` and
// `exchangeCodeForSession` share a shape: { data: { session }, error }.
let reply: any = { data: { session: null }, error: null };
// How many times the route actually verified a token — the tell for whether a
// GET spent it.
let verifyCalls = 0;

stubModule('@supabase/auth-helpers-nextjs', {
    createRouteHandlerClient: () => ({
        auth: {
            verifyOtp: async () => { verifyCalls++; return reply; },
            exchangeCodeForSession: async () => reply,
        },
    }),
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET, POST } = require('../app/auth/callback/route');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextRequest } = require('next/server');

const ORIGIN = 'https://preview.example.test';

// A GET that ends in a redirect (the ?code path, or a refusal).
async function get(query: string) {
    const res = await GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
    const location = new URL(res.headers.get('location'));
    return { path: location.pathname, error: location.searchParams.get('error') };
}

// The POST the interstitial button makes — where an email token is now spent.
async function post(fields: Record<string, string>) {
    const req = new NextRequest(`${ORIGIN}/auth/callback`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
    });
    const res = await POST(req);
    const location = new URL(res.headers.get('location'));
    return { path: location.pathname, error: location.searchParams.get('error') };
}

function sessionFor(token: string | null) {
    return { data: { session: { access_token: token } }, error: null };
}

// --- Rule 2: a GET carrying a token renders the interstitial, verifies nothing.

test('a GET carrying an email token renders the interstitial and verifies NOTHING', async () => {
    verifyCalls = 0;
    reply = sessionFor('would-have-signed-in');   // even a token that WOULD work
    const res = await GET(new NextRequest(`${ORIGIN}/auth/callback?token_hash=abc&type=signup&next=%2Fservices%2Fjoin%2Fapply`));
    assert.equal(res.status, 200, 'a page, not a redirect');
    assert.equal(res.headers.get('location'), null, 'no redirect — nothing was signed in');
    const html = await res.text();
    assert.match(html, /Finish signing in/, 'the interstitial button is there');
    assert.match(html, /name="token_hash"/, 'the token is carried to the POST, not spent');
    assert.equal(verifyCalls, 0, 'the GET never touched verifyOtp — a scanner spends nothing');
});

// --- Rule 1, now on the POST: a session is the only success.

test('the POST with a session sends you on to ?next=', async () => {
    reply = sessionFor('a-real-token');
    const res = await post({ token_hash: 'abc', type: 'signup', next: '/services/join/apply' });
    assert.equal(res.path, '/services/join/apply');
    assert.equal(res.error, null);
});

test('the POST with no error and no session does NOT land you signed out', async () => {
    reply = { data: { session: null }, error: null };
    const res = await post({ token_hash: 'abc', type: 'signup', next: '/services/join/apply' });
    assert.notEqual(res.path, '/services/join/apply');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /did not sign you in/i);
});

test('the POST with a pkce_ hash and no session says which device to use', async () => {
    reply = { data: { session: null }, error: null };
    const res = await post({ token_hash: 'pkce_abc', type: 'signup', next: '/' });
    assert.match(String(res.error), /device you signed up from/i);
});

test('a Supabase error on the POST still reaches the visitor', async () => {
    reply = { data: { session: null }, error: new Error('Email link is invalid or has expired') };
    const res = await post({ token_hash: 'abc', type: 'signup', next: '/' });
    assert.equal(res.path, '/');
    assert.match(String(res.error), /invalid or has expired/i);
});

test('the POST with neither token nor type is refused', async () => {
    reply = sessionFor('unused');
    const res = await post({ next: '/' });
    assert.equal(res.path, '/');
    assert.match(String(res.error), /missing its sign-in code/i);
});

// --- The ?code (OAuth) path still completes on GET — not emailed, scanner-safe.

test('the ?code path signs you in on GET', async () => {
    reply = sessionFor('a-real-token');
    const res = await get('?code=abc&next=%2Fdashboard');
    assert.equal(res.path, '/dashboard');
    assert.equal(res.error, null);
});

test('the same silent failure on the ?code path is caught on GET', async () => {
    reply = { data: { session: null }, error: null };
    const res = await get('?code=abc&next=%2Fdashboard');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /did not sign you in/i);
});

test('a GET carrying neither code nor token_hash is refused', async () => {
    reply = sessionFor('unused');
    const res = await get('?next=%2F');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /missing its sign-in code/i);
});
