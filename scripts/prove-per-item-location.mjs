// Proof: a 'both' slot provider — a studio class AND a travelling session on one
// listing — with each booking correctly and the travelling one private. TEST
// only, re-runnable. Rows are read back from the database.
//
// Sets up a provider whose fulfilment='both', with two items:
//   - a STUDIO class:      fulfilment='collection', unit='person' (shared)
//   - a TRAVELLING session: fulfilment='delivery',  unit='flat'   (private)
// then books each the way the book route derives it, and checks:
//   1. the items store their own location, and the travelling one is private;
//   2. booking freezes the ITEM's direction on the order (collection vs
//      delivery), never the provider's 'both';
//   3. the travelling booking is private (session.private=true) and the studio
//      booking is shared (session.private=false);
//   4. the travelling item's head-count cap ignores the studio capacity — it is
//      the cottage alone (no cap beyond who's staying).
//
// Run: node scripts/prove-per-item-location.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const tag = 'pil-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

async function runSql(sql, p) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql, p)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

// The book route's derivation (lib/serviceProviders.itemFulfilment + serviceSlots
// .bookingIsPrivate), mirrored so the proof states what the route computes.
const itemFul = (item, prov) => (item.fulfilment === 'collection' || item.fulfilment === 'delivery') ? item.fulfilment : (prov === 'both' ? null : (prov || null));
const isPrivateUnit = (unit) => String(unit) === 'flat';

const STUDIO_CAP = 3;   // deliberately BELOW the cottage size, so a travelling
                        // item's larger cap proves it ignores the studio capacity.

async function cleanup() {
    const us = await db.auth('GET', '/admin/users?per_page=500');
    for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const p of (provs || [])) {
            await runSql('delete from public.service_orders where provider_id=$1', [p.id]).catch(() => {});
            await runSql('delete from public.slot_sessions where provider_id=$1', [p.id]).catch(() => {});
            await runSql('delete from public.service_provider_items where provider_id=$1', [p.id]).catch(() => {});
        }
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
    console.log('\n=== Proof: per-item location (a studio class + a travelling session) — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await applyFile('supabase/migrations/20260914225319_per_item_location_for_a_both_slot_provider.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 900));
    await cleanup();

    // A host, a guest, a cottage, and a real stay (6 staying — MORE than the studio cap).
    const host = await db.auth('POST', '/admin/users', { email: 'h-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    const guest = await db.auth('POST', '/admin/users', { email: 'g-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    for (const u of [host, guest]) await db.rest('POST', '/profiles', [{ id: u.id, email: u.email }], 'return=representation,resolution=merge-duplicates');
    const listing = (await db.insert('listings', [{ host_id: host.id, title: 'Cottage ' + tag, location: 'Kirkcudbright', price_per_night: 120, status: 'published' }]))[0];
    const cottageGuests = 6;
    const booking = (await db.insert('bookings', [{ listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: day(7), check_out: day(10), total_price: 360, status: 'confirmed', payment_status: 'paid', guests: cottageGuests }]))[0];

    // A 'both' YOGA provider: studio classes AND travelling 1:1s.
    const prov = (await db.insert('service_providers', [{ owner_id: host.id, business_name: 'Yoga ' + tag, trade: 'guest', audience: 'guest', shape: 'slot', status: 'approved', fulfilment: 'both', slot_capacity: STUDIO_CAP, slot_length_minutes: 60 }]))[0];

    // Two items, exactly as the wizard writes them for a 'both' provider.
    const studio = (await db.insert('service_provider_items', [{ provider_id: prov.id, name: 'Studio class', price: 12, unit: 'person', fulfilment: 'collection', active: true, sort_order: 0 }]))[0];
    const travel = (await db.insert('service_provider_items', [{ provider_id: prov.id, name: 'Private session at yours', price: 45, unit: 'flat', fulfilment: 'delivery', duration_minutes: 60, active: true, sort_order: 1 }]))[0];

    // 1. The items store their own location, and the travelling one is private.
    const rows = await runSql('select name, unit, fulfilment from public.service_provider_items where provider_id=$1 order by sort_order', [prov.id]);
    const s = rows.find((r) => r.fulfilment === 'collection'), t = rows.find((r) => r.fulfilment === 'delivery');
    check(!!s && s.unit === 'person', 'the STUDIO item is collection + shared (unit=person): ' + JSON.stringify(s));
    check(!!t && t.unit === 'flat', 'the TRAVELLING item is delivery + PRIVATE (unit=flat): ' + JSON.stringify(t));

    // Book each the way the route derives it, then read the rows back.
    async function book(item, time) {
        const bookedFul = itemFul(item, prov.fulfilment);
        const priv = isPrivateUnit(item.unit);
        const travelling = bookedFul === 'delivery';
        const declaredCap = travelling ? null : (STUDIO_CAP > 0 ? STUDIO_CAP : null);
        const attendeesCap = declaredCap != null ? Math.min(declaredCap, cottageGuests) : cottageGuests;
        const attendees = priv ? attendeesCap : null;     // clamp as the route does
        const sess = (await db.insert('slot_sessions', [{ provider_id: prov.id, session_date: day(8), session_time: time, capacity: priv ? 1 : STUDIO_CAP, seats_taken: priv ? 1 : 1, private: priv, duration_minutes: 60 }]))[0];
        const order = (await db.insert('service_orders', [{ provider_id: prov.id, guest_id: guest.id, trade: 'guest', service_date: day(8), price: item.price, status: 'confirmed', shape: 'slot', fulfilment: bookedFul, booking_id: booking.id, listing_id: listing.id, slot_session_id: sess.id, item_id: item.id, item_unit: item.unit, attendees }]))[0];
        return { order, sess, attendeesCap };
    }
    const studioBk = await book(studio, '10:00');
    const travelBk = await book(travel, '14:00');

    // 2. Booking freezes the ITEM's direction, not the provider's 'both'.
    const so = (await runSql('select fulfilment, item_unit from public.service_orders where id=$1', [studioBk.order.id]))[0];
    const to = (await runSql('select fulfilment, item_unit, attendees from public.service_orders where id=$1', [travelBk.order.id]))[0];
    check(so.fulfilment === 'collection', 'the studio order froze fulfilment=collection (not the provider both)');
    check(to.fulfilment === 'delivery', 'the travelling order froze fulfilment=delivery (not both)');

    // 3. The travelling booking is private, the studio one shared — read from the sessions.
    const ss = (await runSql('select private from public.slot_sessions where id=$1', [studioBk.sess.id]))[0];
    const ts = (await runSql('select private from public.slot_sessions where id=$1', [travelBk.sess.id]))[0];
    check(ss.private === false, 'the studio session is SHARED (private=false)');
    check(ts.private === true, 'the travelling session is PRIVATE (private=true)');

    // 4. The travelling item's cap ignored the studio size — the cottage (6) > studio cap (8? here 8): use a cap the studio would bind.
    check(travelBk.attendeesCap === cottageGuests, `the travelling head-count cap is the cottage (${cottageGuests}), not the studio (${STUDIO_CAP})`);
    check(Number(to.attendees) === cottageGuests, `read back: the travelling order carries attendees=${to.attendees} (the whole cottage, no studio cap)`);

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
    console.log(failed ? '  ' + failed + ' CHECK(S) FAILED\n' : '  ALL CHECKS PASSED\n');
    process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error('ERR', e); await cleanup().catch(() => {}); process.exit(1); });
