// Proof: the order freezes its fulfilment DIRECTION — a booking's "where" does
// not change when the provider edits their setup. TEST only, re-runnable.
//
// BUG:    the order page derived "where" from the provider's CURRENT fulfilment,
//         so an order booked come-to-me flipped to "comes to your cottage" the
//         moment the provider switched to travelling — a past booking silently
//         rewritten. Same class as the frozen-duration bug.
// FIX:    the direction is snapshotted onto service_orders.fulfilment at booking
//         and read from there, never from the provider's live value.
//
// This proves the DATA half end-to-end on the real TEST database: an order
// booked 'collection' stays 'collection' after the provider is switched to
// 'delivery'. The READ half — that the order page derives from the order, not
// the provider — is pinned by tests/order-location.test.ts against the shipping
// helper lib/orderLocation.ts, whose rule this script mirrors below.
//
// Run: node scripts/prove-fulfilment-frozen-on-order.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const tag = 'ffz-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }

// The exact rule the order page uses (lib/orderLocation.ts), inlined so this
// script can state the human conclusion. The unit test pins the real helper.
const comesToCottage = (o) => o.shape === 'comes_to_you' || (o.shape === 'slot' && o.fulfilment === 'delivery');

async function cleanup() {
    const us = await db.auth('GET', '/admin/users?per_page=500');
    for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const p of (provs || [])) await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
        await db.remove('service_providers', '?owner_id=eq.' + u.id).catch(() => {});
        await db.remove('service_orders', '?guest_id=eq.' + u.id).catch(() => {});
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}

async function main() {
    console.log('\n=== Proof: fulfilment frozen on the order — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await applyFile('supabase/migrations/20260914134207_freeze_fulfilment_direction_on_the_order.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 1200));
    await cleanup();

    // A provider set up COME-TO-ME (collection), and a guest.
    const owner = await db.auth('POST', '/admin/users', { email: 'p-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: owner.id, email: 'p-' + tag + '@' + SEED_DOMAIN }], 'return=representation,resolution=merge-duplicates');
    const prov = (await db.insert('service_providers', [{
        owner_id: owner.id, business_name: 'Studio ' + tag, trade: 'guest', audience: 'guest',
        shape: 'slot', status: 'approved', fulfilment: 'collection',
    }]))[0];

    const guest = await db.auth('POST', '/admin/users', { email: 'g-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: guest.id, email: 'g-' + tag + '@' + SEED_DOMAIN }], 'return=representation,resolution=merge-duplicates');

    // The order as the claim writes it: fulfilment snapshotted from the provider.
    const order = (await db.insert('service_orders', [{
        provider_id: prov.id, guest_id: guest.id, trade: 'guest', service_date: '2026-10-01',
        price: 50, status: 'confirmed', shape: 'slot', fulfilment: prov.fulfilment,
    }]))[0];

    console.log('--- booked come-to-me ---');
    check(order.fulfilment === 'collection', 'the order froze fulfilment=collection at booking');
    check(comesToCottage(order) === false, 'the order reads COME-TO-ME (not a cottage visit)');

    // THE PROVIDER SWITCHES TO TRAVELLING.
    await db.update('service_providers', '?id=eq.' + prov.id, { fulfilment: 'delivery' });
    const provNow = (await db.select('service_providers', '?id=eq.' + prov.id + '&select=fulfilment'))[0];
    const orderNow = (await db.select('service_orders', '?id=eq.' + order.id + '&select=shape,fulfilment'))[0];

    console.log('--- after the provider switches to travelling (delivery) ---');
    check(provNow.fulfilment === 'delivery', 'the provider now travels (setup really changed)');
    check(orderNow.fulfilment === 'collection', 'the ORDER still reads fulfilment=collection — frozen, not re-derived');
    check(comesToCottage(orderNow) === false, 'so the order STILL reads come-to-me after the switch');

    // Counter-proof: the old provider-derived path would have flipped it.
    check(comesToCottage({ shape: 'slot', fulfilment: provNow.fulfilment }) === true,
        'the OLD provider-derived rule would now (wrongly) read "comes to your cottage" — the bug this fixes');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
    console.log(failed ? '  ' + failed + ' CHECK(S) FAILED\n' : '  ALL CHECKS PASSED\n');
    process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
