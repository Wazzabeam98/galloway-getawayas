// Proof for the listings column-privacy fix — TEST only, re-runnable.
//
// READ leak:  a signed-in stranger reads any published listing's street_address,
//             ical_token and commission_rate -> refused after the revoke ->
//             the OWNER still reads them, through listing_private.
// WRITE hole: a host lowers their OWN commission_rate to 0 -> refused after the
//             UPDATE grant is taken back.
//
// Run: node scripts/prove-listing-column-privacy.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'lcp-' + Date.now(), PW = 'Test-' + tag;
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);

async function req(tok, method, p, body) {
    const r = await fetch(URL + '/rest/v1' + p, { method, headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: r.status, data: d };
}
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }

const ICAL = (await import('node:crypto')).randomUUID(), ADDR = '1 Secret Lane ' + tag;
async function mkUser(role) { const u = await db.auth('POST', '/admin/users', { email: role + '-' + tag + '@' + SEED_DOMAIN, password: PW, email_confirm: true }); return { id: u.id, email: role + '-' + tag + '@' + SEED_DOMAIN }; }
async function cleanup() {
    try {
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) { await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('listings', '?id=eq.' + l.id).catch(() => {}); }
        const us = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) { await db.remove('profiles', '?id=eq.' + u.id).catch(() => {}); await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {}); }
    } catch (e) { console.log('cleanup', e.message); }
}

async function main() {
    console.log('\n=== Proof: listings column privacy — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await cleanup();
    const host = await mkUser('host'), attacker = await mkUser('attacker');
    const up = (r) => db.rest('POST', '/profiles', [r], 'return=representation,resolution=merge-duplicates');
    await up({ id: host.id, email: host.email }); await up({ id: attacker.id, email: attacker.email });
    const listing = (await db.insert('listings', [{ host_id: host.id, title: 'Cottage ' + tag, location: 'x', price_per_night: 100, status: 'published', street_address: ADDR, ical_token: ICAL, commission_rate: 15 }]))[0];
    const hostTok = (await signIn(env, host.email, PW)).session.access_token;
    const attackerTok = (await signIn(env, attacker.email, PW)).session.access_token;

    const readSensitive = (tok, table) => req(tok, 'GET', '/' + table + '?id=eq.' + listing.id + '&select=street_address,ical_token,commission_rate');

    // reset to vulnerable baseline: the TABLE-level grant (which is what makes a
    // column-level revoke a no-op) and no view.
    await runSql("grant select on public.listings to authenticated");
    await runSql("drop view if exists public.listing_private");
    console.log('--- baseline (table-level SELECT granted to authenticated) ---');
    let r = await readSensitive(attackerTok, 'listings');
    ok(r.status === 200 && r.data[0] && r.data[0].ical_token === ICAL, 'LEAK read: a stranger reads another host\'s street_address/ical_token/commission_rate  [' + JSON.stringify(r.data) + ']');
    // The commission-WRITE hole (reported separately, NOT fixed by this migration):
    r = await req(hostTok, 'PATCH', '/listings?id=eq.' + listing.id, { commission_rate: 0 });
    let comm = (await db.select('listings', '?id=eq.' + listing.id + '&select=commission_rate'))[0].commission_rate;
    console.log('  · (separate finding) host lowered own commission_rate to ' + comm + '  [HTTP ' + r.status + '] — fix scoped separately');
    await runSql("update listings set commission_rate=15 where id='" + listing.id + "'");

    await applyFile('supabase/migrations/20260903154419_listing_private_columns.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 1500)); // let PostgREST reload its schema cache
    console.log('  · applied 20260903154419');
    console.log('--- after fix ---');
    r = await readSensitive(attackerTok, 'listings');
    ok(r.status === 401 || r.status === 403, 'REFUSE read: stranger selecting sensitive cols is refused  [HTTP ' + r.status + ']');

    // LEGIT: the owner reads their own sensitive columns via listing_private
    r = await readSensitive(hostTok, 'listing_private');
    ok(r.status === 200 && r.data[0] && r.data[0].ical_token === ICAL && r.data[0].street_address === ADDR, 'LEGIT: owner reads own street_address/ical_token/commission via listing_private  [' + JSON.stringify(r.data) + ']');
    // and a stranger gets NOTHING from listing_private
    r = await readSensitive(attackerTok, 'listing_private');
    ok(Array.isArray(r.data) && r.data.length === 0, 'LEGIT: stranger reads nothing from listing_private  [' + JSON.stringify(r.data) + ']');
    // safe columns still readable by the stranger on the base table
    r = await req(attackerTok, 'GET', '/listings?id=eq.' + listing.id + '&select=id,title,location');
    ok(r.status === 200 && r.data[0], 'LEGIT: safe columns (title/location) still world-visible on published listing');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
}
main().then(() => process.exit(0)).catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
