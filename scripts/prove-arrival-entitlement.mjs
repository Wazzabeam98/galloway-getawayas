// Proof harness for the arrival/PII entitlement fix — 2026-09-03.
//
// Proves, on the TEST project only, for the profile_private surface:
//   READ:  leak on the current view  -> refuse after the status-filter fix
//          -> a legitimate CONFIRMED guest still reads the host's details.
//   WRITE: a signed-in stranger can UPDATE the host's profiles row THROUGH the
//          view (stripe_account_id — payout hijack) -> refuse after the
//          write-grant is revoked -> a legitimate guest also cannot (writes were
//          never theirs to do).
//
// Everything is tagged with SEED_DOMAIN and torn down at the end; the host's
// stripe_account_id is restored immediately after each write attempt.
//
// Run: node scripts/prove-arrival-entitlement.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'arrentitle-' + Date.now();
const PW = 'Test-' + tag + '-pw';

const line = (s) => console.log(s);
const ok = (cond, msg) => line((cond ? '  ✓ ' : '  ✗ FAIL ') + msg);

// PostgREST as a given bearer (a real signed-in user's access token, RLS applied).
async function asUser(token, method, pathAndQuery, body, prefer) {
    const res = await fetch(URL + '/rest/v1' + pathAndQuery, {
        method,
        headers: {
            apikey: ANON,
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            ...(prefer ? { Prefer: prefer } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
}

async function applySqlFile(file) {
    // Apply a migration file straight to the test DB (migrate.mjs guards the URL;
    // here we reuse SUPABASE_TEST_DB_URL directly for a single create-or-replace).
    const conn = env.SUPABASE_TEST_DB_URL;
    if (!conn || !conn.includes(TEST_PROJECT_REF)) throw new Error('SUPABASE_TEST_DB_URL is not the test project');
    const fs = await import('node:fs');
    const sql = fs.readFileSync(file, 'utf8');
    const client = new pg.Client({ connectionString: conn });
    await client.connect();
    try { await client.query(sql); } finally { await client.end(); }
}

async function runSql(sql) {
    const client = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL });
    await client.connect();
    try { const r = await client.query(sql); return r.rows; } finally { await client.end(); }
}

async function cleanup() {
    // Remove everything this run created, tag-scoped.
    try {
        const users = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (users.users || [])) {
            if (u.email && u.email.includes(tag)) {
                await db.remove('bookings', '?guest_id=eq.' + u.id).catch(() => {});
                await db.remove('bookings', '?host_id=eq.' + u.id).catch(() => {});
            }
        }
        // listings + arrival + codes by tag in title
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) {
            await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listing_arrival', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listing_access_codes', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listings', '?id=eq.' + l.id).catch(() => {});
        }
        const users2 = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (users2.users || [])) {
            if (u.email && u.email.includes(tag)) {
                await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
                await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
            }
        }
    } catch (e) { line('cleanup note: ' + e.message); }
}

async function makeUser(role) {
    const email = role + '-' + tag + '@' + SEED_DOMAIN;
    const u = await db.auth('POST', '/admin/users', { email, password: PW, email_confirm: true });
    return { id: u.id, email };
}

const HOST_STRIPE = 'acct_VICTIM_' + tag;
const HOST_PHONE = '0777-SECRET-' + tag;

async function main() {
    line('\n=== Proof: arrival/PII entitlement — TEST project ' + TEST_PROJECT_REF + ' ===\n');
    await cleanup();

    // ---- Fixtures (service role) ----
    const host = await makeUser('host');
    const attacker = await makeUser('attacker');
    const legit = await makeUser('legit');

    // A trigger auto-creates the profile row on user creation, so upsert.
    const upsertProfile = (row) => db.rest('POST', '/profiles', [row], 'return=representation,resolution=merge-duplicates');
    await upsertProfile({
        id: host.id, email: host.email, full_name: 'Victim Host ' + tag,
        phone: HOST_PHONE, residential_address: '1 Secret Lane, DG7 9ZZ',
        stripe_account_id: HOST_STRIPE, payout_balance_owed: 123.45,
    });
    await upsertProfile({ id: attacker.id, email: attacker.email, full_name: 'Attacker ' + tag });
    await upsertProfile({ id: legit.id, email: legit.email, full_name: 'Legit Guest ' + tag });

    const listing = (await db.insert('listings', [{
        host_id: host.id, title: 'Secret Cottage ' + tag, location: 'Nowhere', price_per_night: 100,
        status: 'published',
    }]))[0];

    const attackerSession = await signIn(env, attacker.email, PW);
    const attackerTok = attackerSession.session.access_token;
    const legitSession = await signIn(env, legit.email, PW);
    const legitTok = legitSession.session.access_token;

    const readPP = async (tok) => (await asUser(tok, 'GET',
        '/profile_private?id=eq.' + host.id + '&select=email,phone,stripe_account_id,payout_balance_owed')).data;

    // Reset the test DB to the PRE-FIX vulnerable baseline so the leak is
    // demonstrated honestly and the whole proof is re-runnable: the original
    // no-status-filter view, and the inherited write grants back on.
    await applySqlFile('supabase/migrations/20260828234001_profiles_private_view.sql');
    await runSql('grant insert, update, references, trigger on public.profile_private to authenticated');
    line('  · reset profile_private to pre-fix baseline (no status filter, writes granted)');

    // ---------- READ PROOF ----------
    line('--- READ: profile_private counterparty branch ---');

    // baseline: no relationship, no read
    let r = await readPP(attackerTok);
    ok(Array.isArray(r) && r.length === 0, 'baseline (no booking): attacker reads NO host row  [' + JSON.stringify(r) + ']');

    // plant an unpaid pending_payment booking, via the ATTACKER's own JWT (RLS applied)
    // Only the 12 browser-grantable columns — exactly what BookingWidget sends.
    // payment_status is NOT grantable; it defaults to 'unpaid', which the INSERT
    // policy's `payment_status = 'unpaid'` check then sees.
    const plant = await asUser(attackerTok, 'POST', '/bookings', [{
        listing_id: listing.id, guest_id: attacker.id, host_id: host.id,
        check_in: dayStr(1), check_out: dayStr(3), total_price: 200,
        guests: 2, adults: 2, children: 0, pets: 0,
        status: 'pending_payment',
    }], 'return=representation');
    ok(plant.ok, 'attacker plants pending_payment booking via own JWT (RLS)  [HTTP ' + plant.status + (plant.ok ? '' : ' ' + JSON.stringify(plant.data)) + ']');
    const plantedId = plant.ok && plant.data && plant.data[0] && plant.data[0].id;

    // LEAK on current (unfixed) view
    r = await readPP(attackerTok);
    const leaked = Array.isArray(r) && r.length === 1 && r[0].stripe_account_id === HOST_STRIPE;
    ok(leaked, 'LEAK (unfixed view): attacker reads host stripe/phone/payout  [' + JSON.stringify(r) + ']');

    // apply the read fix
    await applySqlFile('supabase/migrations/20260903011742_profile_private_counterparty_must_be_confirmed.sql');
    line('  · applied 20260903011742 (counterparty must be confirmed)');

    // REFUSE: planted pending_payment no longer confers the read
    r = await readPP(attackerTok);
    ok(Array.isArray(r) && r.length === 0, 'REFUSE (fixed view): same planted booking, attacker reads NO host row  [' + JSON.stringify(r) + ']');

    // LEGIT: a confirmed booking joining legit guest <-> host still reads it
    await db.insert('bookings', [{
        listing_id: listing.id, guest_id: legit.id, host_id: host.id,
        check_in: dayStr(1), check_out: dayStr(3), total_price: 200,
        status: 'confirmed', payment_status: 'paid', confirmed_at: new Date().toISOString(),
    }]);
    r = await readPP(legitTok);
    const legitOk = Array.isArray(r) && r.length === 1 && r[0].stripe_account_id === HOST_STRIPE && r[0].phone === HOST_PHONE;
    ok(legitOk, 'LEGIT (fixed view): confirmed guest still reads host stripe+phone+payout  [' + JSON.stringify(r) + ']');

    // ---------- WRITE PROOF (the views-sweep critical finding) ----------
    line('\n--- WRITE: authenticated inherited UPDATE on profile_private (payout hijack) ---');

    // The legit CONFIRMED guest's row is visible through the view even after the
    // read fix, so use them to expose the write vector (worst case: even a real
    // guest must not be able to write the host's Stripe id).
    const HIJACK = 'acct_ATTACKER_HIJACK_' + tag;
    let w = await asUser(legitTok, 'PATCH', '/profile_private?id=eq.' + host.id,
        { stripe_account_id: HIJACK }, 'return=representation');
    let after = (await runSql("select stripe_account_id from profiles where id='" + host.id + "'"))[0].stripe_account_id;
    const wrote = after === HIJACK;
    ok(wrote, 'LEAK (write): confirmed guest UPDATEs host stripe_account_id through view  [HTTP ' + w.status + ', now=' + after + ']');
    // restore immediately
    await runSql("update profiles set stripe_account_id='" + HOST_STRIPE + "' where id='" + host.id + "'");

    // apply the write-grant revoke fix
    await applySqlFile('supabase/migrations/20260903011803_browser_views_are_read_only.sql');
    line('  · applied 20260903011803 (browser views are read-only)');

    w = await asUser(legitTok, 'PATCH', '/profile_private?id=eq.' + host.id,
        { stripe_account_id: HIJACK }, 'return=representation');
    after = (await runSql("select stripe_account_id from profiles where id='" + host.id + "'"))[0].stripe_account_id;
    const refused = after === HOST_STRIPE;
    ok(refused, 'REFUSE (write): same UPDATE now blocked, host stripe unchanged  [HTTP ' + w.status + ', still=' + after + ']');

    // and the read still works for the legit guest (revoke did not break SELECT)
    r = await readPP(legitTok);
    ok(Array.isArray(r) && r.length === 1, 'LEGIT still reads after write-revoke (SELECT intact)  [rows=' + (r||[]).length + ']');

    line('\n--- teardown ---');
    await cleanup();
    line('  done.\n');
}

function dayStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }

main().then(() => process.exit(0)).catch(async (e) => { console.error('ERROR', e); await cleanup(); process.exit(1); });
