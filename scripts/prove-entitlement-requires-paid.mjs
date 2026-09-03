// Proof that the entitlement requires PAID, not just confirmed — TEST, re-runnable.
//
// LEAK:   a confirmed-but-UNPAID booking (a host can self-confirm one) releases
//         the counterparty's PII through profile_private.
// REFUSE: after the fix, that same unpaid booking releases nothing.
// LEGIT:  a confirmed + PAID guest still reads it, AND a confirmed + DEPOSIT_PAID
//         guest still reads it (the deposit guest must not be locked out).
//
// Run: node scripts/prove-entitlement-requires-paid.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'erp-' + Date.now(), PW = 'Test-' + tag;
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);

async function readHostPII(tok, hostId) {
    const r = await fetch(URL + '/rest/v1/profile_private?id=eq.' + hostId + '&select=email,phone', { headers: { apikey: ANON, Authorization: 'Bearer ' + tok } });
    const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }
const mkUser = async (role) => { const u = await db.auth('POST', '/admin/users', { email: role + '-' + tag + '@' + SEED_DOMAIN, password: PW, email_confirm: true }); return { id: u.id, email: role + '-' + tag + '@' + SEED_DOMAIN }; };
async function cleanup() {
    try {
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) { await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('listings', '?id=eq.' + l.id).catch(() => {}); }
        const us = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) { await db.remove('profiles', '?id=eq.' + u.id).catch(() => {}); await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {}); }
    } catch (e) { console.log('cleanup', e.message); }
}
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

async function main() {
    console.log('\n=== Proof: entitlement requires PAID — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await cleanup();
    const host = await mkUser('host'), unpaid = await mkUser('unpaid'), paid = await mkUser('paid'), deposit = await mkUser('deposit');
    const up = (r) => db.rest('POST', '/profiles', [r], 'return=representation,resolution=merge-duplicates');
    await up({ id: host.id, email: host.email, phone: 'HOSTPHONE-' + tag });
    for (const g of [unpaid, paid, deposit]) await up({ id: g.id, email: g.email });
    const listing = (await db.insert('listings', [{ host_id: host.id, title: 'C-' + tag, location: 'x', price_per_night: 100, status: 'published' }]))[0];
    // Staggered dates — the no-overlapping-confirmed exclusion constraint forbids
    // two confirmed bookings on the same listing over the same nights.
    const bk = (guest, payment_status, from) => db.insert('bookings', [{ listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: day(from), check_out: day(from + 2), total_price: 200, status: 'confirmed', payment_status, confirmed_at: new Date().toISOString() }]);
    await bk(unpaid, 'unpaid', 1); await bk(paid, 'paid', 5); await bk(deposit, 'deposit_paid', 9);
    const tok = {};
    for (const g of [unpaid, paid, deposit]) tok[g.id] = (await signIn(env, g.email, PW)).session.access_token;

    // baseline: the status-only view (as shipped in 20260903011742 / #99)
    await applyFile('supabase/migrations/20260903011742_profile_private_counterparty_must_be_confirmed.sql');
    console.log('--- baseline (view requires status=confirmed only) ---');
    let r = await readHostPII(tok[unpaid.id], host.id);
    ok(Array.isArray(r) && r.length === 1, 'LEAK: confirmed-but-UNPAID guest reads the host PII  [' + JSON.stringify(r) + ']');

    await applyFile('supabase/migrations/20260903171533_profile_private_counterparty_must_be_paid.sql');
    console.log('  · applied 20260903171533 (must be paid)');
    console.log('--- after fix ---');
    r = await readHostPII(tok[unpaid.id], host.id);
    ok(Array.isArray(r) && r.length === 0, 'REFUSE: confirmed-but-UNPAID guest reads nothing  [' + JSON.stringify(r) + ']');
    r = await readHostPII(tok[paid.id], host.id);
    ok(Array.isArray(r) && r.length === 1, 'LEGIT: confirmed + PAID guest still reads host PII');
    r = await readHostPII(tok[deposit.id], host.id);
    ok(Array.isArray(r) && r.length === 1, 'LEGIT: confirmed + DEPOSIT_PAID guest still reads host PII (not locked out)');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
}
main().then(() => process.exit(0)).catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
