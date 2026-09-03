// Proof for the listings UPDATE allow-list — TEST only, re-runnable.
//
// LEAK:   a host PATCHes their OWN commission_rate to 0.
// REFUSE: after the fix, that (and approved_at, rating_avg) is refused.
// EVERY FIELD STILL SAVES: replay the exact columns addhome and account write as
//   a signed-in host, read every one back, and assert it persisted. A column
//   silently failing to save is worse than the hole, so the allow-list is proven
//   by save, not by eye.
//
// Run: node scripts/prove-listings-update-allow-list.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'luw-' + Date.now(), PW = 'Test-' + tag;
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);

async function req(tok, method, p, body) {
    // return=minimal, like the real editor (addhome's update returns only 'id'):
    // the persistence read-back is done via the service role, so a PATCH never
    // needs SELECT on the sensitive columns the read-fix revokes.
    const r = await fetch(URL + '/rest/v1' + p, { method, headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: r.status, data: d };
}
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }

// The exact columns addhome + account write directly, with typed test values.
const EDITOR_WRITES = {
    title: 'Walked ' + tag, description: 'desc', location: 'Town, Region',
    street_address: '2 Editor Way', postcode: 'DG7 1AA',
    price_per_night: 123, max_guests: 5, property_type: 'house', privacy_type: 'entire',
    bedrooms: 3, beds: 4, bathrooms: 2, amenities: ['wifi', 'parking'], images: ['a.jpg', 'b.jpg'],
    check_in_method: 'lockbox', check_in_time: '15:00:00', check_in_end_time: '20:00:00', check_out_time: '11:00:00',
    latitude: 54.83, longitude: -4.05,
    new_listing_promo: true, last_minute_discount: true, weekly_discount: true, monthly_discount: false,
    status: 'draft',
    instant_book: true, instant_book_requires_phone: true,
    stl_licence_status: 'applied', stl_licence_number: 'STL-123', stl_licence_expiry: '2027-01-01',
};

async function cleanup() {
    try {
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) await db.remove('listings', '?id=eq.' + l.id).catch(() => {});
        const us = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) { await db.remove('profiles', '?id=eq.' + u.id).catch(() => {}); await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {}); }
    } catch (e) { console.log('cleanup', e.message); }
}

async function main() {
    console.log('\n=== Proof: listings UPDATE allow-list — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await cleanup();
    const host = await (async () => { const u = await db.auth('POST', '/admin/users', { email: 'host-' + tag + '@' + SEED_DOMAIN, password: PW, email_confirm: true }); return { id: u.id, email: 'host-' + tag + '@' + SEED_DOMAIN }; })();
    await db.rest('POST', '/profiles', [{ id: host.id, email: host.email }], 'return=representation,resolution=merge-duplicates');
    // Seeded as a DRAFT: addhome only ever writes status='draft' to an
    // already-draft row (publishing goes through the server), and a listings
    // trigger blocks a browser status CHANGE — so the editor's status='draft'
    // is a no-op the trigger allows.
    const listing = (await db.insert('listings', [{ host_id: host.id, title: 'Seed ' + tag, location: 'x', price_per_night: 100, status: 'draft', commission_rate: 15 }]))[0];
    const hostTok = (await signIn(env, host.email, PW)).session.access_token;

    // baseline: clean table-level SELECT + UPDATE (undo any residue from the
    // column-privacy proof on this shared test project; that fix is a separate PR).
    await runSql('grant select, update on public.listings to authenticated');
    await runSql('drop view if exists public.listing_private');
    console.log('--- baseline (table-level SELECT + UPDATE) ---');
    let r = await req(hostTok, 'PATCH', '/listings?id=eq.' + listing.id, { commission_rate: 0 });
    let comm = (await db.select('listings', '?id=eq.' + listing.id + '&select=commission_rate'))[0].commission_rate;
    ok(String(comm) === '0', 'LEAK: host PATCHes own commission_rate to 0  [HTTP ' + r.status + ']');
    await runSql("update listings set commission_rate=15 where id='" + listing.id + "'");

    // Apply BOTH listings-grants migrations — the read fix (SELECT re-scope +
    // listing_private) and this write fix — so the editor is proven against the
    // real end state: sensitive columns unreadable AND commission/rating/etc
    // unwritable on the base table, reads via listing_private, writes via the
    // allow-list.
    await applyFile('supabase/migrations/20260903154419_listing_private_columns.sql');
    await applyFile('supabase/migrations/20260903161233_listings_update_is_an_allow_list.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 1500));
    console.log('  · applied 20260903154419 + 20260903161233 (both listings-grants fixes)');
    console.log('--- after fix: platform columns refused ---');
    for (const [col, val] of [['commission_rate', 0], ['approved_at', new Date().toISOString()], ['rating_avg', 5]]) {
        r = await req(hostTok, 'PATCH', '/listings?id=eq.' + listing.id, { [col]: val });
        ok(r.status === 401 || r.status === 403, 'REFUSE: host cannot set ' + col + '  [HTTP ' + r.status + ']');
    }

    console.log('--- after fix: EVERY editor field still saves ---');
    r = await req(hostTok, 'PATCH', '/listings?id=eq.' + listing.id, EDITOR_WRITES);
    ok(r.status === 204 || r.status === 200, 'the full editor write PATCHes cleanly  [HTTP ' + r.status + (r.status < 300 ? '' : ' ' + JSON.stringify(r.data)) + ']');
    const back = (await db.select('listings', '?id=eq.' + listing.id + '&select=' + Object.keys(EDITOR_WRITES).join(',')))[0];
    const misses = [];
    for (const [col, val] of Object.entries(EDITOR_WRITES)) {
        const got = back[col];
        const same = Array.isArray(val) ? JSON.stringify(got) === JSON.stringify(val)
            : String(got).replace(/:00$/, '') === String(val).replace(/:00$/, '') || String(got) === String(val);
        if (!same) misses.push(col + ' (sent ' + JSON.stringify(val) + ', got ' + JSON.stringify(got) + ')');
    }
    ok(misses.length === 0, 'all ' + Object.keys(EDITOR_WRITES).length + ' editor columns persisted' + (misses.length ? ':\n      ' + misses.join('\n      ') : ''));

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
}
main().then(() => process.exit(0)).catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
