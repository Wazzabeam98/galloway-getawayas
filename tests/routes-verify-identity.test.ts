// No API route may take the caller's word for who they are.
//
// WHY. `supabase.auth.getSession()` reads the id out of the auth cookie and
// **never checks the JWT signature** — it validates shape and expiry only. So
// an attacker who writes their own cookie is whichever user id they choose.
// The overnight audit proved the primitive against the exact installed
// library: a token carrying a victim's `sub` and an invented signature came
// back as `session.user.id = <victim>`, valid shape, future expiry.
//
// `getUser()` asks the auth server, which verifies the signature and that the
// session has not been revoked. It costs one round trip — measured at 43–64ms
// from outside the region, less from inside it — and that is the entire price
// of the site knowing who is calling.
//
// WHY A TEST RATHER THAN HAVING FIXED THEM. They are all fixed. This is here
// because the fix is a one-line difference that reads as a style choice, and
// the next route somebody adds will be copied from whichever file they had
// open. A rule that lives only in the routes that already follow it is not a
// rule.
//
// WHAT IT DELIBERATELY ALLOWS. `getSession()` is fine in a client component —
// the browser reading its own session to decide what to render. It is fine in
// a route that has already called `getUser()` and only wants the access token
// to forward. The check below is about routes that *authorise* on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

// tests run from .test-build/tests, so the repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'app', 'api');

function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
            out.push(...routeFiles(full));
        } else if (name === 'route.ts') {
            out.push(full);
        }
    }
    return out;
}

function code(file: string): string {
    // Comments stripped. Several of these files explain in a comment why they
    // do NOT use getSession, and a check that cannot tell the explanation from
    // the thing being explained fails on a correct file.
    return fs.readFileSync(file, 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

const rel = (f: string) => path.relative(ROOT, f);

test('every API route is found by the scan', () => {
    // If this ever drops to nothing the rule below is vacuously true, which is
    // the failure mode this whole file exists to prevent.
    const files = routeFiles(API);
    assert.ok(files.length >= 50, `expected 50+ route files, found ${files.length}`);
});

test('no API route authorises on getSession()', () => {
    const offenders: string[] = [];

    for (const file of routeFiles(API)) {
        const body = code(file);
        if (!/getSession\(\)/.test(body)) continue;

        // Allowed: a route that verifies with getUser() and only wants the
        // session for its access token. Not allowed: reading an identity off
        // the session, verified or not.
        const usesSessionIdentity = /session[?.]*\.user/.test(body);
        const verifies = /getUser\(\)/.test(body);

        if (usesSessionIdentity || !verifies) offenders.push(rel(file));
    }

    assert.deepEqual(
        offenders, [],
        'These routes take the caller\'s word for who they are:\n  '
        + offenders.join('\n  ')
        + '\n\ngetSession() does not check the JWT signature. Anyone who writes'
        + '\ntheir own cookie is whoever they say they are. Use getUser().'
    );
});

test('the routes that were fixed stayed fixed', () => {
    // Named individually so a regression says which one, and so that deleting
    // a route does not quietly shrink the coverage of the rule above.
    const fixed = [
        'app/api/address/autocomplete/route.ts',
        'app/api/address/get/route.ts',
        'app/api/booking-guests/accept/route.ts',
        'app/api/errors/report/route.ts',
        'app/api/listing-access/accept/route.ts',
        'app/api/message-templates/coverage/route.ts',
        'app/api/messages/mark-read/route.ts',
        'app/api/messages/mark-unread/route.ts',
        'app/api/my-listings/route.ts',
    ];

    for (const r of fixed) {
        const full = path.join(ROOT, r);
        assert.ok(fs.existsSync(full), r + ' has gone — update this list deliberately');
        const body = code(full);
        assert.match(body, /getUser\(\)/, r + ' no longer verifies the caller');
        assert.ok(!/session[?.]*\.user/.test(body), r + ' reads an identity off the session again');
    }
});

test('a signed-out caller is refused rather than treated as nobody in particular', () => {
    // The swap changes the shape of the guard from `!session || !session.user`
    // to `!user`. Getting that wrong — leaving a truthy check on an object
    // that is now always defined — turns the guard off without changing what
    // it looks like.
    for (const r of [
        'app/api/my-listings/route.ts',
        'app/api/badges/route.ts',
    ]) {
        const body = code(path.join(ROOT, r));
        assert.match(body, /if \(!user\)/, r + ' does not refuse a signed-out caller');
    }
});
