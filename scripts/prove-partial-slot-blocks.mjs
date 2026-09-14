// Proof: a partial block holds a time range shut, via the SAME exclusion the
// bookings use. TEST only, re-runnable. Rows are read back from the database, not
// a screen.
//
// A block is a slot_sessions row with blocked = true, counted by
// slot_sessions_no_overlap (20260914194212). So:
//   - a booking whose interval overlaps a block is refused by the constraint;
//   - a booking outside it commits;
//   - a block that overlaps an existing booking is refused (never shadows a paid
//     slot silently);
//   - remove the block and the time is bookable again.
// This drives the constraint directly — the same authority the claim's seat CAS
// hits. The app-grid mirror (the guest never sees a covered start) is pinned by
// tests/slot-partial-blocks.test.ts.
//
// Run: node scripts/prove-partial-slot-blocks.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF, SEED_DOMAIN } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const tag = 'pblk-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

async function runSql(sql, params) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }

const DATE = '2026-10-06';
// Insert a slot_sessions row directly and report the SQLSTATE (null = success).
async function insertRow({ time, duration, seats, blocked }) {
    try {
        const rows = await runSql(
            `insert into public.slot_sessions
               (provider_id, session_date, session_time, duration_minutes, turnaround_minutes, seats_taken, capacity, blocked, private)
             values ($1,$2,$3,$4,0,$5,1,$6,false) returning id`,
            [PROVIDER, DATE, time, duration, seats, blocked],
        );
        return { id: rows[0].id, code: null };
    } catch (e) { return { id: null, code: e.code }; }
}
const countAt = async (time) => (await runSql(
    `select count(*)::int as n from public.slot_sessions where provider_id=$1 and session_date=$2 and session_time=$3`,
    [PROVIDER, DATE, time]))[0].n;

let PROVIDER = null;
async function cleanup() {
    const us = await db.auth('GET', '/admin/users?per_page=500');
    for (const u of (us.users || [])) if (u.email && u.email.includes(tag)) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const p of (provs || [])) await runSql('delete from public.slot_sessions where provider_id=$1', [p.id]).catch(() => {});
        await db.remove('service_providers', '?owner_id=eq.' + u.id).catch(() => {});
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}

async function main() {
    console.log('\n=== Proof: partial slot blocks — TEST ' + TEST_PROJECT_REF + ' ===\n');
    await applyFile('supabase/migrations/20260914194212_partial_slot_blocks_as_blocked_intervals.sql');
    await runSql("notify pgrst, 'reload schema'");
    await new Promise((r) => setTimeout(r, 800));
    await cleanup();

    const owner = await db.auth('POST', '/admin/users', { email: 'p-' + tag + '@' + SEED_DOMAIN, password: 'T-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: owner.id, email: 'p-' + tag + '@' + SEED_DOMAIN }], 'return=representation,resolution=merge-duplicates');
    PROVIDER = (await db.insert('service_providers', [{ owner_id: owner.id, business_name: 'Yoga ' + tag, trade: 'guest', audience: 'guest', shape: 'slot', status: 'approved' }]))[0].id;

    // 1. Create a partial block 12:00–13:00.
    const block = await insertRow({ time: '12:00', duration: 60, seats: 0, blocked: true });
    check(block.code === null && block.id, 'a partial block 12:00–13:00 was created');
    const blockRows = await runSql('select session_time, duration_minutes, blocked, seats_taken from public.slot_sessions where id=$1', [block.id]);
    check(blockRows[0].blocked === true && blockRows[0].seats_taken === 0 && Number(blockRows[0].duration_minutes) === 60,
        'read back from DB: blocked=true, seats_taken=0, duration=60');

    // 2. A booking INSIDE it (12:30, 30 min → [12:30,13:00)) is refused by the exclusion.
    const inside = await insertRow({ time: '12:30', duration: 30, seats: 1, blocked: false });
    check(inside.code === '23P01', 'a booking inside the block is REFUSED (exclusion_violation) [' + inside.code + ']');
    check((await countAt('12:30')) === 0, 'read back: nothing was written at 12:30');

    // 3. A booking OUTSIDE it (14:00, 60 min) commits.
    const outside = await insertRow({ time: '14:00', duration: 60, seats: 1, blocked: false });
    check(outside.code === null && outside.id, 'a booking outside the block SUCCEEDS');
    check((await countAt('14:00')) === 1, 'read back: the 14:00 booking is in the DB');

    // 3b. A block over that existing 14:00 booking is refused — never a silent shadow.
    const shadow = await insertRow({ time: '13:30', duration: 60, seats: 0, blocked: true });
    check(shadow.code === '23P01', 'a block overlapping the paid 14:00 booking is REFUSED [' + shadow.code + ']');

    // 4. Remove the block; the previously-refused 12:30 booking now commits.
    await runSql('delete from public.slot_sessions where id=$1', [block.id]);
    check((await countAt('12:00')) === 0, 'read back: the block is gone');
    const afterRemove = await insertRow({ time: '12:30', duration: 30, seats: 1, blocked: false });
    check(afterRemove.code === null && afterRemove.id, 'with the block removed, 12:30 is BOOKABLE again');
    check((await countAt('12:30')) === 1, 'read back: the 12:30 booking is now in the DB');

    console.log('\n--- teardown ---'); await cleanup(); console.log('  done.\n');
    console.log(failed ? '  ' + failed + ' CHECK(S) FAILED\n' : '  ALL CHECKS PASSED\n');
    process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error('ERR', e); await cleanup().catch(() => {}); process.exit(1); });
