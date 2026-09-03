// The planted-booking leak, turned into a standing guard so the next reader
// someone writes cannot quietly reopen it. This is the difference between
// fixing the instance and fixing the shape.
//
// Two layers, because this repo is edited two ways:
//
//   STATIC (always, incl. CI and the web-editor paste path) — the migration
//   that hides host PII still carries `status = 'confirmed'`, and each of the
//   four readers still routes through lib/bookingEntitlement.ts. A whole-file
//   paste that drops the gate (the classic "a fix reappears undone" here) turns
//   the suite red.
//
//   LIVE (when a test database is configured — the pre-push hook, local runs) —
//   actually plants an unpaid pending_payment booking as a stranger and asserts
//   profile_private hands back NOTHING, and that a real confirmed guest still
//   gets the row. Skips cleanly when no DB env is present (CI has none), so it
//   never flakes a push; the static layer covers CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

// tests run from .test-build/tests, so the repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------- STATIC layer

test('the profile_private counterparty branch still requires a confirmed AND paid booking', () => {
    // The latest profile_private (re)definition — must gate the counterparty
    // branch on confirmed AND paid. status alone is not enough (a host can
    // self-confirm an unpaid booking on their own listing).
    const file = 'supabase/migrations/20260903171533_profile_private_counterparty_must_be_paid.sql';
    const sql = read(file).replace(/\s+/g, ' ');
    assert.match(sql, /b\."?status"?\s*=\s*'confirmed'/,
        file + ' no longer filters the counterparty booking on status=confirmed — the host-PII leak is reopened.');
    assert.match(sql, /b\."?payment_status"?\s+in\s*\(\s*'paid'\s*,\s*'deposit_paid'\s*\)/,
        file + ' no longer requires the counterparty booking to be PAID — a host-self-confirmed unpaid booking leaks PII again.');
});

test('every arrival/PII reader still routes through the single entitlement', () => {
    const readers = [
        'app/arrival/[bookingId]/page.tsx',
        'app/api/trips/route.ts',
        'lib/stayWindow.ts',
    ];
    const missing = readers.filter((rel) => !read(rel).includes('bookingReleasesPrivateData'));
    assert.deepEqual(
        missing, [],
        'These readers no longer call bookingReleasesPrivateData, so a booking that is '
        + 'not confirmed can leak private data again:\n  ' + missing.join('\n  ')
        + '\n\nA new reader that hands out address / door code / phone / host PII on a '
        + 'booking MUST gate on bookingReleasesPrivateData (status===confirmed).'
    );
});

test('the browser-facing views are still revoked from writing', () => {
    // The payout-hijack write vector: authenticated must not hold INSERT/UPDATE
    // on the definer views. Guards the revoke migration from being dropped.
    const sql = read('supabase/migrations/20260903011803_browser_views_are_read_only.sql').replace(/\s+/g, ' ');
    for (const view of ['profile_private', 'service_provider_own_contacts']) {
        assert.match(
            sql,
            new RegExp('revoke[^;]*on\\s+"?public"?\\."?' + view + '"?\\s+from\\s+"?authenticated"?', 'i'),
            'the revoke of writes on ' + view + ' is gone — a signed-in guest could UPDATE a host\'s '
            + 'stripe_account_id through the view again (payout redirection).'
        );
    }
});

// ------------------------------------------------------------------ LIVE layer

// Parse .env.local without importing the ESM seed helpers into this CJS test.
function loadEnvLocal(): Record<string, string> | null {
    let text: string;
    try { text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'); }
    catch { return null; }
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return env;
}

const env = loadEnvLocal();
const URL = env && env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env && env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env && env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_REF = 'yefoqcabuijcowoqewtc';
// Only run live against the TEST project, never anything else.
const liveReady = !!(URL && ANON && SERVICE && URL.includes(TEST_REF));

test('a planted pending_payment booking reads NOTHING from profile_private; a confirmed guest still does',
    { skip: liveReady ? false : 'no TEST Supabase env in .env.local — static layer covers CI' },
    async () => {
        const svc = (m: string, p: string, body?: any, prefer?: string) => fetch(URL + '/rest/v1' + p, {
            method: m,
            headers: { apikey: SERVICE!, Authorization: 'Bearer ' + SERVICE!, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const auth = (m: string, p: string, body?: any) => fetch(URL + '/auth/v1' + p, {
            method: m,
            headers: { apikey: SERVICE!, Authorization: 'Bearer ' + SERVICE!, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        const asUser = (tok: string, m: string, p: string, body?: any, prefer?: string) => fetch(URL + '/rest/v1' + p, {
            method: m,
            headers: { apikey: ANON!, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });

        const tag = 'guard-' + Date.now();
        const pw = 'Test-' + tag;
        const mk = async (role: string) => {
            const r = await (await auth('POST', '/admin/users', { email: role + '-' + tag + '@gallowayseed.test', password: pw, email_confirm: true })).json();
            return r.id as string;
        };
        const signIn = async (email: string) => {
            const r = await (await fetch(URL + '/auth/v1/token?grant_type=password', {
                method: 'POST', headers: { apikey: ANON!, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: pw }),
            })).json();
            return r.access_token as string;
        };
        const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

        let hostId = '', attackerId = '', legitId = '', listingId = '';
        try {
            hostId = await mk('host'); attackerId = await mk('attacker'); legitId = await mk('legit');
            const up = (row: any) => svc('POST', '/profiles', [row], 'return=representation,resolution=merge-duplicates');
            await up({ id: hostId, email: 'host-' + tag + '@gallowayseed.test', full_name: 'Host ' + tag, phone: 'SECRET-' + tag, stripe_account_id: 'acct_' + tag });
            await up({ id: attackerId, email: 'attacker-' + tag + '@gallowayseed.test' });
            await up({ id: legitId, email: 'legit-' + tag + '@gallowayseed.test' });
            listingId = (await (await svc('POST', '/listings', [{ host_id: hostId, title: 'Guard ' + tag, location: 'x', price_per_night: 100, status: 'published' }], 'return=representation')).json())[0].id;

            const attackerTok = await signIn('attacker-' + tag + '@gallowayseed.test');
            const legitTok = await signIn('legit-' + tag + '@gallowayseed.test');

            // Plant the unpaid booking as the attacker, exactly as BookingWidget does.
            const plant = await asUser(attackerTok, 'POST', '/bookings', [{
                listing_id: listingId, guest_id: attackerId, host_id: hostId,
                check_in: day(1), check_out: day(3), total_price: 200, guests: 2, adults: 2, status: 'pending_payment',
            }], 'return=representation');
            assert.equal(plant.status, 201, 'the planted booking should insert (that is the whole premise); got ' + plant.status);

            // THE INVARIANT: the attacker reads nothing about the host.
            const leaked = await (await asUser(attackerTok, 'GET', '/profile_private?id=eq.' + hostId + '&select=email,phone,stripe_account_id')).json();
            assert.deepEqual(leaked, [], 'REOPENED: a planted pending_payment booking leaked host PII from profile_private');

            // And a real confirmed guest is NOT locked out.
            await svc('POST', '/bookings', [{
                listing_id: listingId, guest_id: legitId, host_id: hostId,
                check_in: day(1), check_out: day(3), total_price: 200, status: 'confirmed', payment_status: 'paid', confirmed_at: new Date().toISOString(),
            }]);
            const seen = await (await asUser(legitTok, 'GET', '/profile_private?id=eq.' + hostId + '&select=email,phone,stripe_account_id')).json();
            assert.equal(Array.isArray(seen) && seen.length, 1, 'a confirmed guest must still read their host\'s details — the fix must not lock real guests out');
        } finally {
            // Tag-scoped teardown.
            if (listingId) { await svc('DELETE', '/bookings?listing_id=eq.' + listingId); await svc('DELETE', '/listings?id=eq.' + listingId); }
            for (const id of [hostId, attackerId, legitId]) if (id) { await svc('DELETE', '/profiles?id=eq.' + id); await auth('DELETE', '/admin/users/' + id); }
        }
    });
