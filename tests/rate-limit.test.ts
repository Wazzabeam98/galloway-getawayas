// How often a stranger may make the site send an email.
//
// /api/services/apply has no auth gate and cannot have one: a tradesman has no
// account until this route makes them one. Every call creates a real Supabase
// auth user and asks Supabase to email it, and the project's outbound mail is
// a single shared allowance. A loop against that address takes down password
// resets FOR THE WHOLE SITE. That, not the junk rows, is what these limits are
// for, and it is why the global one is the half that matters: a per-IP limit
// is bypassed by picking another address, and a cap on the total is not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const { withinLimits, callerAddress, GLOBAL_KEY } = require('@/lib/rateLimit');

const NOW = new Date('2026-08-29T12:00:00.000Z');

/**
 * A stand-in for the table. `counts` says what each bucket|key already holds
 * inside the window; `inserted` records what the limiter writes.
 */
function db(counts: Record<string, number> = {}, opts: { error?: any } = {}) {
    const inserted: any[] = [];
    const asked: string[] = [];

    const client = {
        from(_table: string) {
            return {
                select() {
                    const state: any = { bucket: '', key: '' };
                    const chain: any = {
                        eq(col: string, val: string) {
                            state[col] = val;
                            return chain;
                        },
                        gte() {
                            asked.push(state.bucket + '|' + state.key);
                            return Promise.resolve({
                                count: counts[state.bucket + '|' + state.key] || 0,
                                error: opts.error || null,
                            });
                        },
                    };
                    return chain;
                },
                insert(rows: any) {
                    (Array.isArray(rows) ? rows : [rows]).forEach((r) => inserted.push(r));
                    return Promise.resolve({ error: null });
                },
            };
        },
    };

    return { client, inserted, asked };
}

const LIMITS = [
    { bucket: 'services-apply:all', key: GLOBAL_KEY, max: 20, windowMinutes: 60 },
    { bucket: 'services-apply:ip', key: '1.2.3.4', max: 3, windowMinutes: 60 },
    { bucket: 'services-apply:email', key: 'a@b.test', max: 2, windowMinutes: 1440 },
];

/* ------------------------------------------------------------ letting through */

test('a first application goes through', async () => {
    const { client, inserted } = db();
    const v = await withinLimits(LIMITS, NOW, client);

    assert.equal(v.ok, true);
    assert.equal(inserted.length, 3, 'one row per limit, so each window counts on its own');
});

test('an ordinary tradesman is nowhere near any of them', async () => {
    // Two applications from one address in an hour is a person who made a
    // mistake the first time, not an attack.
    const { client } = db({
        'services-apply:all|*': 4,
        'services-apply:ip|1.2.3.4': 1,
        'services-apply:email|a@b.test': 1,
    });
    assert.equal((await withinLimits(LIMITS, NOW, client)).ok, true);
});

/* -------------------------------------------------------------------- refusing */

test('the site-wide cap refuses even a brand new address', async () => {
    // The one that matters. However the requests are spread — one address or
    // ten thousand — the emails the site can be made to send are bounded.
    const { client } = db({ 'services-apply:all|*': 20 });
    const v = await withinLimits(LIMITS, NOW, client);

    assert.equal(v.ok, false);
    assert.match(v.hit, /services-apply:all/,
        'the global limit has to be the one that refuses, or spreading the load defeats it');
});

test('one address hammering it is stopped before the site-wide cap is', async () => {
    const { client } = db({ 'services-apply:ip|1.2.3.4': 3 });
    const v = await withinLimits(LIMITS, NOW, client);

    assert.equal(v.ok, false);
    assert.match(v.hit, /services-apply:ip/);
});

test('the same email over and over is stopped for a day', async () => {
    const { client } = db({ 'services-apply:email|a@b.test': 2 });
    assert.equal((await withinLimits(LIMITS, NOW, client)).ok, false);
});

test('a refused attempt is NOT recorded', async () => {
    // Otherwise an attacker holding the door shut also extends how long it
    // stays shut for everybody else — the block would keep renewing itself.
    const { client, inserted } = db({ 'services-apply:all|*': 99 });
    await withinLimits(LIMITS, NOW, client);

    assert.deepEqual(inserted, []);
});

test('the cheapest and most important limit is checked first', async () => {
    // The global count is one indexed lookup and it is the one that protects
    // the mail allowance. Checking it last would mean doing the other work
    // first on exactly the requests that should not get any work at all.
    const { client, asked } = db({ 'services-apply:all|*': 20 });
    await withinLimits(LIMITS, NOW, client);

    assert.deepEqual(asked, ['services-apply:all|*'],
        'it should have stopped after the first refusal');
});

/* --------------------------------------------------------------- the failure mode */

test('an unreadable limit lets the applicant through and says so', async () => {
    // Fail open, deliberately and only here: refusing every applicant because
    // the limiter is broken turns a database wobble into a closed shop. The
    // route reports it.
    const { client } = db({}, { error: { message: 'connection failure' } });
    const v = await withinLimits(LIMITS, NOW, client);

    assert.equal(v.ok, true);
    assert.equal(v.hit, 'unreadable', 'the caller has to be able to tell this apart from a clean pass');
});

/* ------------------------------------------------------------------ the address */

test('x-real-ip is preferred where the platform sets it', () => {
    const h = new Headers({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 9.9.9.9' });
    assert.equal(callerAddress(h), '9.9.9.9');
});

test('the LAST forwarded-for entry is used, not the first', () => {
    // The front of that list is whatever the caller chose to send. The entry
    // the edge in front of us appended is the address it actually saw.
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' });
    assert.equal(callerAddress(h), '198.51.100.7');
});

test('no headers at all still gives a usable key', () => {
    // It must not return empty, or every anonymous caller shares one bucket by
    // accident and the per-IP limit becomes a second global one.
    assert.equal(callerAddress(new Headers()), 'unknown');
});

/* ---------------------------------------------------- the route actually uses it */

test('services/apply is gated before it creates anything', () => {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'app/api/services/apply/route.ts'), 'utf8'
    );
    const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(code, /withinLimits/, 'the route is ungated again');

    // THIS ROUTE NO LONGER MAKES AN ACCOUNT AT ALL, and that is worth pinning
    // here rather than only in service-apply.test.ts. Creating a Supabase auth
    // user from an unauthenticated public form is what let a stranger squat
    // somebody's address; the account is now made by /api/services/finish,
    // when the emailed link proves the address. If createUser ever comes back
    // to this file, the squat comes back with it.
    assert.doesNotMatch(
        code, /createUser/,
        'services/apply must not create an auth user — that is what /finish is for'
    );

    // The limit still has to come before the expensive, irreversible half.
    // That used to be the account; it is now the email, which spends the same
    // shared outbound allowance every password reset on the site draws on.
    assert.ok(
        code.indexOf('withinLimits') < code.indexOf('sendEmail'),
        'the limit has to be checked BEFORE the email goes, or it has already been spent'
    );
    assert.match(code, /GLOBAL_KEY/, 'the site-wide cap is the half that protects the mail allowance');
    assert.match(code, /429/);
});


/* ------------------------------ the other two public routes it now guards */

function code(rel: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('errors/report is limited, and stays open to signed-out callers', () => {
    // It has to stay open: an error can happen to somebody who is not signed
    // in, and those are the ones most worth knowing about. The limit is not
    // about who is calling, it is about how many.
    const body = code('app/api/errors/report/route.ts');
    assert.match(body, /withinLimits/);
    assert.match(body, /GLOBAL_KEY/, 'the site-wide cap is the half that bounds a flood');
    assert.ok(!/status:\s*401/.test(body), 'it must not start requiring a session');
});

test('a throttled error report answers 200, not 429', () => {
    // It is called from an error page, by code that has already failed once.
    // Handing that an error status is how a broken page becomes a broken page
    // that also retries.
    const body = code('app/api/errors/report/route.ts');
    assert.match(body, /throttled: true/);
    assert.ok(!/status:\s*429/.test(body));
});

test('a refused error report does NOT write to the error log', () => {
    // Everywhere else a refusal is reported. Here that would write a row to
    // the very table being protected, on every refused request — the flood,
    // with extra steps.
    const body = code('app/api/errors/report/route.ts');
    const refusal = body.slice(body.indexOf('if (!verdict.ok)'), body.indexOf('if (!verdict.ok)') + 260);
    assert.ok(!/logError/.test(refusal),
        'reporting a refusal here feeds the thing it is defending');
});

test('services/wanted is limited and still reachable signed out', () => {
    const body = code('app/api/services/wanted/route.ts');
    assert.match(body, /withinLimits/);
    assert.match(body, /GLOBAL_KEY/);
    assert.ok(!/status:\s*401/.test(body), 'a host should not have to sign in to say what they need');
});

test('a signed-in host is counted by their id, not their address', () => {
    // Otherwise a household or an office behind one connection throttles
    // itself, and the people most likely to be sharing an address are the
    // ones most likely to be genuine.
    const body = code('app/api/services/wanted/route.ts');
    assert.match(body, /hostId \? 'services-wanted:user' : 'services-wanted:ip'/);
});

test('both routes check the limit before doing the expensive thing', () => {
    for (const [rel, after] of [
        ['app/api/errors/report/route.ts', 'error_log'],
        ['app/api/services/wanted/route.ts', 'announceWanted'],
    ]) {
        const body = code(rel);
        assert.ok(
            body.indexOf('withinLimits') < body.indexOf(after),
            rel + ' does the work before checking whether it is allowed to'
        );
    }
});
