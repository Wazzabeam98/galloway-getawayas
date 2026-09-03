// Proof for the may_read_listing fix — TEST only, re-runnable.
//
// LEAK:   a planted pending_payment booking lets a stranger read a DRAFT listing.
// REFUSE: after the fix, the same planted booking reads nothing.
// LEGIT:  a confirmed guest still reads a HIDDEN listing (the host took it down,
//         the guest keeps their trip) — and a PUBLISHED listing stays world-open.
//
// Run: node scripts/prove-may-read-listing.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'mrl-' + Date.now(), PW = 'Test-' + tag;
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);

async function asUser(tok, p) {
    const r = await fetch(URL + '/rest/v1' + p, { headers: { apikey: ANON, Authorization: 'Bearer ' + tok } });
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: r.status, data: d };
}
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

// The ORIGINAL (vulnerable) function, to reset the baseline so the leak is honest.
const ORIGINAL = `create or replace function public.may_read_listing(listing uuid, host uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select host = auth.uid()
    or exists (select 1 from listing_access la where la.listing_id=listing and la.user_id=auth.uid())
    or exists (select 1 from bookings b where b.listing_id=listing and b.guest_id=auth.uid())
    or exists (select 1 from bookings b join booking_guests bg on bg.booking_id=b.id where b.listing_id=listing and bg.user_id=auth.uid());
$f$;`;

async function makeUser(role) { const u = await db.auth('POST', '/admin/users', { email: role + '-' + tag + '@' + SEED_DOMAIN, password: PW, email_confirm: true }); return { id: u.id, email: role + '-' + tag + '@' + SEED_DOMAIN }; }
async function cleanup() {
    try {
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) { await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('listings', '?id=eq.' + l.id).catch(() => {}); }
        const us = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) { await db.remove('profiles', '?id=eq.' + u.id).catch(() => {}); await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {}); }
    } catch (e) { console.log('cleanup note', e.message); }
}

async function main() {
    console.log('\n=== Proof: may_read_listing — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await cleanup();
    const host = await makeUser('host'), attacker = await makeUser('attacker'), legit = await makeUser('legit');
    const up = (r) => db.rest('POST', '/profiles', [r], 'return=representation,resolution=merge-duplicates');
    await up({ id: host.id, email: host.email }); await up({ id: attacker.id, email: attacker.email }); await up({ id: legit.id, email: legit.email });

    const mk = async (status) => (await db.insert('listings', [{ host_id: host.id, title: 'L-' + status + '-' + tag, location: 'x', price_per_night: 100, status, street_address: 'SECRET ' + status }]))[0];
    // The exploit needs the listing PUBLISHED at plant time (the booking INSERT
    // policy reads the listing's host_id, which a stranger cannot for a draft).
    // So: create published, plant, then the host hides it. That is the real
    // published->hidden path a planted row survives.
    const draft = await mk('published'), hidden = await mk('hidden'), published = await mk('published');

    const aTok = (await signIn(env, attacker.email, PW)).session.access_token;
    const lTok = (await signIn(env, legit.email, PW)).session.access_token;

    // plant while published, via attacker JWT (only 12 grantable columns)
    await fetch(URL + '/rest/v1/bookings', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + aTok, 'Content-Type': 'application/json' }, body: JSON.stringify([{ listing_id: draft.id, guest_id: attacker.id, host_id: host.id, check_in: day(1), check_out: day(3), total_price: 100, guests: 1, adults: 1, status: 'pending_payment' }]) });
    // the host now takes it down — the planted row must not keep it open.
    await runSql("update listings set status='draft' where id='" + draft.id + "'");
    // a real confirmed booking for legit on the HIDDEN listing (service role)
    await db.insert('bookings', [{ listing_id: hidden.id, guest_id: legit.id, host_id: host.id, check_in: day(1), check_out: day(3), total_price: 100, status: 'confirmed', payment_status: 'paid', confirmed_at: new Date().toISOString() }]);

    const reads = async (tok, id) => { const r = await asUser(tok, '/listings?id=eq.' + id + '&select=id,status,street_address'); return Array.isArray(r.data) && r.data.length === 1; };

    // reset to vulnerable baseline
    await runSql(ORIGINAL);
    console.log('--- baseline (original may_read_listing) ---');
    ok(await reads(aTok, draft.id), 'LEAK: attacker with planted booking reads the DRAFT listing');

    await applyFile('supabase/migrations/20260903152233_may_read_listing_ignores_planted_bookings.sql');
    console.log('  · applied 20260903152233');
    console.log('--- after fix ---');
    ok(!(await reads(aTok, draft.id)), 'REFUSE: same planted booking reads NOTHING of the draft');
    ok(await reads(lTok, hidden.id), 'LEGIT: confirmed guest still reads the HIDDEN listing (their trip)');
    ok(await reads(aTok, published.id), 'PUBLISHED still world-readable (attacker reads it — unaffected)');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
}
main().then(() => process.exit(0)).catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
