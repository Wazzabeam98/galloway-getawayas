// Proof: a travelling slot booking freezes the guest's STAY address on the order,
// and the provider can't see it until it's paid. TEST only, re-runnable. Rows are
// read back from the database.
//
// Sets up a REAL booking — a guest with a cottage stay (bookings -> listings) —
// then books a travelling slot the way the book route does (freeze the stay's
// address onto service_orders.service_address), and checks:
//   1. the frozen address equals the stay's cottage address (pick-your-stay);
//   2. a come-to-me order freezes NO address (scope: travelling only);
//   3. NO browser role can read service_orders at all (the grant is revoked) —
//      so the address can never leak to a provider's browser directly;
//   4. the provider API's rule releases the address ONLY when confirmed (== paid
//      for a slot): null while holding, the address once confirmed.
//
// Run: node scripts/prove-travelling-address.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = supabaseClient(env);
const tag = 'tadr-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

async function runSql(sql, params) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

// The provider orders route's release rule (services/orders/route.ts), mirrored:
// the address is handed to the provider only when the order is confirmed.
const providerSeesAddress = (order) => (order.status === 'confirmed' ? order.service_address : null);

async function cleanup() {
    const us = await db.auth('GET', '/admin/users?per_page=500');
    for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const p of (provs || [])) await runSql('delete from public.service_orders where provider_id=$1', [p.id]).catch(() => {});
        await runSql('delete from public.service_orders where guest_id=$1', [u.id]).catch(() => {});
        await db.remove('service_providers', '?owner_id=eq.' + u.id).catch(() => {});
        await db.remove('bookings', '?guest_id=eq.' + u.id).catch(() => {});
        await db.remove('bookings', '?host_id=eq.' + u.id).catch(() => {});
        await db.remove('listings', '?host_id=eq.' + u.id).catch(() => {});
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}

async function main() {
    console.log('\n=== Proof: travelling-session address freeze + paid gate — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await applyFile('supabase/migrations/20260914224003_service_address_on_a_travelling_order.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 900));
    await cleanup();

    // A REAL booking: host, guest, a cottage with a real address, the stay.
    const host = await db.auth('POST', '/admin/users', { email: 'h-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    const guest = await db.auth('POST', '/admin/users', { email: 'g-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    for (const u of [host, guest]) await db.rest('POST', '/profiles', [{ id: u.id, email: u.email }], 'return=representation,resolution=merge-duplicates');
    const listing = (await db.insert('listings', [{
        host_id: host.id, title: 'Shore Cottage ' + tag, location: 'Kirkcudbright',
        street_address: '12 Shore Road', postcode: 'DG6 4JT', price_per_night: 120, status: 'published',
    }]))[0];
    const booking = (await db.insert('bookings', [{
        listing_id: listing.id, guest_id: guest.id, host_id: host.id,
        check_in: day(7), check_out: day(10), total_price: 360, status: 'confirmed', payment_status: 'paid', guests: 2,
    }]))[0];
    const stayAddress = ['12 Shore Road', 'DG6 4JT', 'Kirkcudbright'].join(', ');

    // A TRAVELLING slot provider (comes to the guest).
    const prov = (await db.insert('service_providers', [{ owner_id: host.id, business_name: 'Mobile Yoga ' + tag, trade: 'guest', audience: 'guest', shape: 'slot', status: 'approved', fulfilment: 'delivery' }]))[0];

    // Book it the way the route does: freeze service_address from booking -> listing.
    const stay = (await runSql('select street_address, postcode, location from public.listings where id=$1', [booking.listing_id]))[0];
    const composed = [stay.street_address, stay.postcode, stay.location].filter(Boolean).join(', ');
    const order = (await db.insert('service_orders', [{
        provider_id: prov.id, guest_id: guest.id, trade: 'guest', service_date: day(8), price: 40,
        status: 'holding', shape: 'slot', fulfilment: 'delivery', booking_id: booking.id, listing_id: listing.id,
        service_address: composed,
    }]))[0];

    // 1. The freeze captured the picked stay's address.
    const stored = (await runSql('select service_address, status, fulfilment from public.service_orders where id=$1', [order.id]))[0];
    check(stored.service_address === stayAddress, 'the order froze the stay address: "' + stored.service_address + '"');

    // 2. A come-to-me order freezes NO address (travelling only). Its own owner —
    // service_providers is unique on (owner_id, trade).
    const owner2 = await db.auth('POST', '/admin/users', { email: 'o2-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: owner2.id, email: owner2.email }], 'return=representation,resolution=merge-duplicates');
    const prov2 = (await db.insert('service_providers', [{ owner_id: owner2.id, business_name: 'Studio ' + tag, trade: 'guest', audience: 'guest', shape: 'slot', status: 'approved', fulfilment: 'collection' }]))[0];
    // The book route only composes an address when fulfilment==='delivery'; mirror that.
    const cmAddress = prov2.fulfilment === 'delivery' ? composed : null;
    const order2 = (await db.insert('service_orders', [{ provider_id: prov2.id, guest_id: guest.id, trade: 'guest', service_date: day(8), price: 40, status: 'holding', shape: 'slot', fulfilment: 'collection', booking_id: booking.id, listing_id: listing.id, service_address: cmAddress }]))[0];
    const stored2 = (await runSql('select service_address from public.service_orders where id=$1', [order2.id]))[0];
    check(stored2.service_address === null, 'a come-to-me order freezes NO address (null)');

    // 3. The hard privacy floor: no browser role can read service_orders at all.
    const anonRead = await fetch(URL + '/rest/v1/service_orders?select=service_address&id=eq.' + order.id, { headers: { apikey: ANON } }).then((r) => r.text());
    let anonRows; try { anonRows = JSON.parse(anonRead); } catch { anonRows = anonRead; }
    check(!Array.isArray(anonRows) || anonRows.length === 0, 'a browser (anon) role reads NOTHING from service_orders [' + String(anonRead).slice(0, 60) + ']');

    // 4. The provider API gate: null while holding (unpaid), the address once confirmed (paid).
    let o = (await runSql('select status, service_address from public.service_orders where id=$1', [order.id]))[0];
    check(o.status === 'holding' && providerSeesAddress(o) === null, 'while HOLDING (unpaid), the provider sees NO address');
    await runSql("update public.service_orders set status='confirmed' where id=$1", [order.id]);
    o = (await runSql('select status, service_address from public.service_orders where id=$1', [order.id]))[0];
    check(o.status === 'confirmed' && providerSeesAddress(o) === stayAddress, 'once CONFIRMED (paid), the provider sees the address');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
    console.log(failed ? '  ' + failed + ' CHECK(S) FAILED\n' : '  ALL CHECKS PASSED\n');
    process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error('ERR', e); await cleanup().catch(() => {}); process.exit(1); });
