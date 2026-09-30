// No seed, scenario or e2e reset may delete Liam's own TEST account, or change
// its password or email.
//
// WHY THIS EXISTS. Every seed resets by listing auth users and DELETE-ing the
// ones it owns. The seeds each own a `.test` domain (CLAUDE.md), but Liam's
// account is his real address, which he uses to walk the host side (Millburn
// Cottage), the admin side and — via the experience seed — the guest side. On
// 30 Sep 2026 it stopped signing in on the preview and the first suspect was a
// seed reset. None had touched it, but only each script's own email filter
// stood between its DELETE loop and his account. scripts/protectedAccounts.cjs
// is now that wall, once, for every path.
//
// Two halves, both behavioural where they can be:
//   1. seed-lib's client (which most scripts use) really refuses — run in a
//      subprocess with fetch stubbed, and we check no DELETE ever went out.
//   2. any script that talks to the auth admin API with its OWN fetch wrapper
//      calls guardFetch. That half is structural, because those scripts need a
//      live database to run.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_LIB = path.join(ROOT, 'scripts', 'seed-lib.mjs').replace(/\\/g, '/');

const LIAM_ID = 'a1ed9461-239b-4a33-bf9d-e3fc14fbde86';
const SEED_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Run one seed-lib call with fetch stubbed: GET /admin/users/<id> answers with
 * the email for that id, profiles selects answer likewise, and everything else
 * is recorded. Returns what was refused and which requests actually went out.
 */
function run(call: string): { outcome: string; sent: string[] } {
    const script = `
        const emails = { '${LIAM_ID}': 'LiamWorrall18@hotmail.com', '${SEED_ID}': 'seed@gallowayseed.test' };
        const sent = [];
        globalThis.fetch = async (url, init = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            const u = new URL(url);
            const byId = u.pathname.match(/\\/admin\\/users\\/([0-9a-f-]{36})$/);
            const json = (x) => ({ ok: true, status: 200, json: async () => x, text: async () => JSON.stringify(x) });
            if (method === 'GET' && byId) return json({ id: byId[1], email: emails[byId[1]] });
            if (method === 'GET' && u.pathname.endsWith('/profiles')) {
                const id = (u.searchParams.get('id') || '').replace('eq.', '');
                return json(emails[id] ? [{ id, email: emails[id] }] : []);
            }
            sent.push(method + ' ' + u.pathname);
            return json({});
        };
        import('${SEED_LIB}').then(async (m) => {
            const db = m.supabaseClient({ NEXT_PUBLIC_SUPABASE_URL: 'https://yefoqcabuijcowoqewtc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
            let outcome = 'ALLOWED';
            try { await ${call}; } catch (e) { outcome = 'REFUSED:' + e.message; }
            console.log(JSON.stringify({ outcome, sent }));
        }).catch((e) => console.log(JSON.stringify({ outcome: 'THREW_ON_IMPORT:' + e.message, sent: [] })));
    `;
    const out = String(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 })).trim();
    return JSON.parse(out.split('\n').pop());
}

test('a seed reset cannot delete the protected account', () => {
    const r = run(`db.auth('DELETE', '/admin/users/${LIAM_ID}')`);
    assert.match(r.outcome, /^REFUSED:.*protected/, r.outcome);
    assert.deepEqual(r.sent, [], 'a DELETE still went out: ' + r.sent.join(', '));
});

test('a seed cannot reset the protected account\'s password or email', () => {
    for (const body of ['{ password: "x" }', '{ email: "x@y.test" }']) {
        const r = run(`db.auth('PUT', '/admin/users/${LIAM_ID}', ${body})`);
        assert.match(r.outcome, /^REFUSED:/, body + ' → ' + r.outcome);
        assert.deepEqual(r.sent, []);
    }
});

test('a seed cannot delete the protected account\'s profile row', () => {
    const r = run(`db.remove('profiles', '?id=eq.${LIAM_ID}')`);
    assert.match(r.outcome, /^REFUSED:/, r.outcome);
    assert.deepEqual(r.sent, []);
});

test('a seed can still delete its own .test accounts (the guard is not a blanket block)', () => {
    const r = run(`db.auth('DELETE', '/admin/users/${SEED_ID}')`);
    assert.equal(r.outcome, 'ALLOWED');
    assert.deepEqual(r.sent, ['DELETE /auth/v1/admin/users/' + SEED_ID]);
});

test('editing the protected account\'s profile (not its login) is still allowed', () => {
    // Seeds legitimately place orders on, and set flags for, Liam's account.
    const r = run(`db.auth('PUT', '/admin/users/${LIAM_ID}', { user_metadata: { a: 1 } })`);
    assert.equal(r.outcome, 'ALLOWED');
});

test('every script with its own auth-admin fetch wrapper goes through guardFetch', () => {
    // A generic passthrough ('/auth/v1' + endpoint, SUPABASE_URL + path) or a
    // templated delete-by-id can reach the protected account without seed-lib.
    const RAW = /\/auth\/v1(['"`] *\+|\/admin\/users\/\$\{)|\$\{SUPABASE_URL\}\$\{path\}|SUPABASE_URL \+ path/;
    const files: string[] = [];
    for (const dir of ['scripts', 'e2e']) {
        for (const f of fs.readdirSync(path.join(ROOT, dir))) {
            if (/\.(mjs|cjs|js|ts)$/.test(f)) files.push(dir + '/' + f);
        }
    }
    const raw = files.filter((rel) => RAW.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    assert.ok(raw.length >= 5, 'the pattern stopped matching the known callers: ' + raw.join(', '));
    const unguarded = raw.filter((rel) => !fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('guardFetch('));
    assert.deepEqual(unguarded, [], 'these talk to the auth admin API without protectedAccounts.guardFetch: ' + unguarded.join(', '));
});
