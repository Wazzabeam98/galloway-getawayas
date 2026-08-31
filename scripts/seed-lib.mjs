// Shared plumbing for the payment seeder and the scenario runner.
//
// Everything here talks to the TEST Supabase project and Stripe TEST mode,
// both read out of .env.local. It refuses to run if either looks live.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = '.env.local') {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const env = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const i = trimmed.indexOf('=');
        env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return env;
}

// The one guard that matters. A seeder that can reach production is a seeder
// that will eventually reach production.
export function assertTestEnvironment(env) {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
        throw new Error('refusing to run: STRIPE_SECRET_KEY is not a test key');
    }
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
        throw new Error(
            'refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')'
        );
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

// galloway-getaways-test. Production is hviwjxigqivjfhmhpjiy — never this.
// Defined in target.cjs, not here. That file has to be CommonJS so Playwright
// can load it, and on Node 20 CommonJS cannot require an ESM module — so the
// dependency runs that way round.
//
// IMPORTED as well as re-exported, in two steps, deliberately.
//
// `export { X } from './y'` forwards the name to importers and creates NO local
// binding, so every use of TEST_PROJECT_REF inside THIS file was a reference to
// something undefined: assertTestEnvironment, the guard the payment seeders run
// before touching anything, and signIn, which four scenario runners call. Both
// threw "TEST_PROJECT_REF is not defined" at the moment they were relied on.
// It failed closed — nothing was written anywhere it should not have been — but
// every seeder and scenario runner stopped working.
//
// It broke when the constant moved to target.cjs so Playwright could require
// it, and nothing caught it because no unit test imports this file: the scripts
// that use it need a database. Two sessions found it separately within minutes,
// which is the argument for tests/seed-guard.test.ts existing.
import { TEST_PROJECT_REF } from './target.cjs';

export { TEST_PROJECT_REF };

// Everything the seeder creates carries one of these, so a reset can find it
// again and nothing else is ever touched.
export const SEED_DOMAIN = 'gallowayseed.test';
export const SEED_TAG = 'gg-payment-seed';

/* ---------------------------------------------------------------- Stripe */

function encodeForm(obj, prefix) {
    const parts = [];
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value === undefined || value === null) continue;
        const name = prefix ? prefix + '[' + key + ']' : key;
        if (Array.isArray(value)) {
            value.forEach((item, i) => {
                parts.push(
                    item !== null && typeof item === 'object'
                        ? encodeForm(item, name + '[' + i + ']')
                        : encodeURIComponent(name + '[' + i + ']') + '=' + encodeURIComponent(String(item))
                );
            });
        } else if (typeof value === 'object') {
            parts.push(encodeForm(value, name));
        } else {
            parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
        }
    }
    return parts.filter(Boolean).join('&');
}

export function stripeClient(env) {
    async function request(method, endpoint, body, options = {}) {
        const headers = {
            Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
            'Stripe-Version': '2024-06-20',
        };
        if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
        // Acting as the connected account rather than the platform.
        if (options.account) headers['Stripe-Account'] = options.account;

        let url = 'https://api.stripe.com/v1' + endpoint;
        let payload;
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            payload = body ? encodeForm(body) : '';
        } else if (body) {
            const qs = encodeForm(body);
            if (qs) url += '?' + qs;
        }

        const res = await fetch(url, { method, headers, body: payload });
        const data = await res.json();
        if (!res.ok) {
            const err = new Error((data && data.error && data.error.message) || 'Stripe request failed');
            err.stripeCode = data && data.error && data.error.code;
            err.status = res.status;
            throw err;
        }
        return data;
    }
    return { request };
}

/* -------------------------------------------------------------- Supabase */

export function supabaseClient(env) {
    const base = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

    async function rest(method, pathAndQuery, body, prefer) {
        const res = await fetch(base + '/rest/v1' + pathAndQuery, {
            method,
            headers: prefer ? { ...headers, Prefer: prefer } : headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(method + ' ' + pathAndQuery + ': ' + text);
        return data;
    }

    async function auth(method, endpoint, body) {
        const res = await fetch(base + '/auth/v1' + endpoint, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(method + ' ' + endpoint + ': ' + text);
        return data;
    }

    return {
        rest,
        auth,
        select: (table, query = '') => rest('GET', '/' + table + query),
        insert: (table, rows) => rest('POST', '/' + table, rows, 'return=representation'),
        update: (table, query, patch) => rest('PATCH', '/' + table + query, patch, 'return=representation'),
        remove: (table, query) => rest('DELETE', '/' + table + query),
    };
}

/* ----------------------------------------------------------------- Misc */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

// yyyy-mm-dd, n days from today.
export function dayOffset(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

export const MANIFEST = path.join(ROOT, 'scripts', '.seed-manifest.json');

export function writeManifest(data) {
    fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2) + '\n');
}

export function readManifest() {
    if (!fs.existsSync(MANIFEST)) {
        throw new Error('no seed manifest — run `node scripts/seed-payments.mjs` first');
    }
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

/* ------------------------------------------------- signing in as a seeded user */

// The refund route is a normal signed-in route, not a cron route, so a test
// has to arrive with a real session cookie. @supabase/auth-helpers-nextjs
// stores the session as a JSON array under `sb-<ref>-auth-token`.
// A REAL session cookie, written by the app itself.
//
// WHY signIn() BELOW IS NOT ENOUGH, AND WHY THAT MATTERED.
//
// signIn() asks Supabase for tokens and then ASSEMBLES a cookie by hand in the
// shape auth-helpers uses. That is fine for talking to PostgREST directly,
// which is all the security probes need — they send the access token as a
// bearer and never go through the app.
//
// It is not enough for fetching a page. A hand-built cookie satisfies the
// browser-side client, which is why a client component would render as
// signed-in, but `createServerComponentClient` did not accept it — so every
// server component on the page rendered its SIGNED-OUT branch. Pages fetched
// that way looked signed in and were not, and a crawl of them was measuring
// the logged-out site while reporting on the logged-in one.
//
// This instead asks the admin API for a magic link and then walks it through
// the application's own /auth/callback, exactly as a person clicking the link
// in their email does. The app calls verifyOtp and writes its own cookies, and
// what comes back in Set-Cookie is a session the server accepts because the
// server made it.
//
// Returns every cookie the app set, joined for a Cookie header. auth-helpers
// splits a large session across .0/.1 chunks, so taking only the first would
// work until a token grew.
export async function sessionCookieViaApp(env, email, siteUrl) {
    const admin = {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
    };

    const linkRes = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', {
        method: 'POST',
        headers: admin,
        body: JSON.stringify({ type: 'magiclink', email }),
    });
    const link = await linkRes.json();
    if (!link.hashed_token) {
        throw new Error('no magic link for ' + email + ': ' + JSON.stringify(link).slice(0, 200));
    }

    // redirect: manual, because the cookies are set on the 302 itself and
    // following it throws them away.
    const cb = await fetch(
        siteUrl + '/auth/callback?type=magiclink&next=%2F&token_hash=' + encodeURIComponent(link.hashed_token),
        { redirect: 'manual' }
    );

    const setCookies = typeof cb.headers.getSetCookie === 'function'
        ? cb.headers.getSetCookie()
        : [cb.headers.get('set-cookie')].filter(Boolean);

    const cookie = setCookies
        .map((c) => String(c).split(';')[0])
        .filter((c) => c && !c.endsWith('='))
        .join('; ');

    if (!cookie) {
        const to = cb.headers.get('location') || '';
        throw new Error(
            'the callback set no cookie for ' + email + ' (HTTP ' + cb.status + ')'
            + (to.includes('error=') ? ' — it redirected to ' + decodeURIComponent(to.slice(0, 160)) : '')
        );
    }

    return cookie;
}

export async function signIn(env, email, password) {
    const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const session = await res.json();
    if (!res.ok || !session.access_token) {
        throw new Error('could not sign in as ' + email + ': ' + JSON.stringify(session));
    }

    const value = JSON.stringify([
        session.access_token,
        session.refresh_token,
        session.provider_token ?? null,
        session.provider_refresh_token ?? null,
        (session.user && session.user.factors) ?? null,
    ]);

    const name = 'sb-' + TEST_PROJECT_REF + '-auth-token';
    return { session, cookie: name + '=' + encodeURIComponent(value) };
}
