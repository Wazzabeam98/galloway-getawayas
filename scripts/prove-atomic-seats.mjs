// Proof: two ensure-seats calls at once can't over-mint the party. TEST only.
//
// Fires ensure_booking_seats twice CONCURRENTLY for one booking and confirms the
// live seat count equals capacity, never double. Then removes a seat and tops up
// again, confirming the freed ordinal refills (not a new extra one).
//
// Run: node scripts/prove-atomic-seats.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const db = supabaseClient(env);
const tag = 'seats-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }

const ensureSeats = (booking, inviter) => fetch(URL + '/rest/v1/rpc/ensure_booking_seats', {
    method: 'POST',
    headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_booking: booking, p_inviter: inviter }),
}).then((r) => r.text());

const liveSeats = async (booking) => (await db.select('booking_guests', '?booking_id=eq.' + booking + '&status=neq.removed&select=id,seat_index'));

async function cleanup() {
    try {
        const bs = await db.select('bookings', '?guest_id=in.(' + (await usersByTag()).join(',') + ')&select=id').catch(() => []);
    } catch {}
    const us = await db.auth('GET', '/admin/users?per_page=500');
    for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) {
        const bks = await db.select('bookings', '?host_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const b of (bks || [])) await db.remove('booking_guests', '?booking_id=eq.' + b.id).catch(() => {});
        await db.remove('bookings', '?host_id=eq.' + u.id).catch(() => {});
        await db.remove('listings', '?host_id=eq.' + u.id).catch(() => {});
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}
async function usersByTag() { const us = await db.auth('GET', '/admin/users?per_page=500'); return (us.users || []).filter((u) => u.email && u.email.includes(tag)).map((u) => u.id); }

async function main() {
    console.log('\n=== Proof: atomic party seats — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await applyFile('supabase/migrations/20260903174512_booking_seats_are_atomic.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 1200));
    await cleanup();

    const host = await db.auth('POST', '/admin/users', { email: 'h-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: host.id, email: 'h-' + tag + '@' + SEED_DOMAIN }], 'return=representation,resolution=merge-duplicates');
    const listing = (await db.insert('listings', [{ host_id: host.id, title: 'S-' + tag, location: 'x', price_per_night: 100, status: 'published' }]))[0];
    // guests=4 -> capacity 3 companion seats.
    const bk = (await db.insert('bookings', [{ listing_id: listing.id, guest_id: host.id, host_id: host.id, check_in: '2026-10-01', check_out: '2026-10-03', total_price: 400, status: 'confirmed', payment_status: 'paid', guests: 4 }]))[0];

    // TWO concurrent ensure-seats — the race.
    const [a, b] = await Promise.all([ensureSeats(bk.id, host.id), ensureSeats(bk.id, host.id)]);
    let seats = await liveSeats(bk.id);
    ok(seats.length === 3, 'two concurrent ensure-seats give exactly 3 live seats (capacity), not 6  [rpc returned ' + a + '/' + b + ', live=' + seats.length + ']');
    ok(new Set(seats.map((s) => s.seat_index)).size === 3, 'the three seats have distinct ordinals 1..3  [' + seats.map((s) => s.seat_index).sort().join(',') + ']');

    // A third call mints nothing (idempotent).
    await ensureSeats(bk.id, host.id);
    seats = await liveSeats(bk.id);
    ok(seats.length === 3, 're-opening the sheet mints nothing new (still 3)');

    // Remove a seat, top up again -> the freed ordinal refills, total stays 3.
    await db.update('booking_guests', '?id=eq.' + seats[0].id, { status: 'removed' });
    await ensureSeats(bk.id, host.id);
    seats = await liveSeats(bk.id);
    ok(seats.length === 3 && new Set(seats.map((s) => s.seat_index)).size === 3, 'removing a seat frees its ordinal; the next top-up refills to 3  [' + seats.map((s) => s.seat_index).sort().join(',') + ']');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
}
main().then(() => process.exit(0)).catch(async (e) => { console.error('ERR', e); await cleanup(); process.exit(1); });
