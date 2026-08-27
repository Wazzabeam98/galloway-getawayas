// What the auth callback does with a link that does not produce a session.
//
// The rule this enforces is that a session is the only thing that counts as
// success. The route used to check `error` alone, so a reply that complained
// about nothing and returned nothing fell straight through to the redirect:
// the visitor landed on the page they were aiming at, signed out, with no
// indication anything had gone wrong. A confirmation link that had failed and
// one that had worked looked identical from the outside, which is what made a
// misdirected link so slow to spot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule } from './helpers/stub';

installAliases();

stubModule('next/headers', { cookies: () => ({}) });

// The auth reply the route is about to receive. `verifyOtp` and
// `exchangeCodeForSession` share a shape: { data: { session }, error }.
let reply: any = { data: { session: null }, error: null };

stubModule('@supabase/auth-helpers-nextjs', {
    createRouteHandlerClient: () => ({
        auth: {
            verifyOtp: async () => reply,
            exchangeCodeForSession: async () => reply,
        },
    }),
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('../app/auth/callback/route');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextRequest } = require('next/server');

const ORIGIN = 'https://preview.example.test';

async function callback(query: string) {
    const res = await GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
    const location = new URL(res.headers.get('location'));
    return {
        path: location.pathname,
        error: location.searchParams.get('error'),
    };
}

function sessionFor(token: string | null) {
    return { data: { session: { access_token: token } }, error: null };
}

test('a session sends you on to ?next=', async () => {
    reply = sessionFor('a-real-token');
    const res = await callback('?token_hash=abc&type=signup&next=%2Fservices%2Fjoin%2Fapply');
    assert.equal(res.path, '/services/join/apply');
    assert.equal(res.error, null);
});

test('no error and no session does NOT land you on the page signed out', async () => {
    reply = { data: { session: null }, error: null };
    const res = await callback('?token_hash=abc&type=signup&next=%2Fservices%2Fjoin%2Fapply');
    assert.notEqual(res.path, '/services/join/apply');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /did not sign you in/i);
});

test('a pkce_ hash with no session says which device to use', async () => {
    reply = { data: { session: null }, error: null };
    const res = await callback('?token_hash=pkce_abc&type=signup&next=%2F');
    assert.match(String(res.error), /device you signed up from/i);
});

test('the same silent failure on the ?code= path is caught too', async () => {
    reply = { data: { session: null }, error: null };
    const res = await callback('?code=abc&next=%2Fdashboard');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /did not sign you in/i);
});

test('a link carrying neither code nor token_hash is refused', async () => {
    reply = sessionFor('unused');
    const res = await callback('?next=%2F');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /missing its sign-in code/i);
});

test('an error from Supabase still reaches the visitor', async () => {
    reply = { data: { session: null }, error: new Error('Email link is invalid or has expired') };
    const res = await callback('?token_hash=abc&type=signup&next=%2F');
    assert.equal(res.path, '/');
    assert.match(String(res.error), /invalid or has expired/i);
});
