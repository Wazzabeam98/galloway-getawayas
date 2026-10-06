// Account closure must ANONYMISE, never hard-delete. The overnight audit
// (2026-09-24) proved delete_own_account() deleted auth.users and cascaded away
// booking/review/message history (or errored on a RESTRICT-linked money row).
// 20260924181742_anonymise_own_account.sql replaced it with
// anonymise_own_account() + admin_anonymise_account(uuid), and flipped
// bookings.guest_id/host_id from CASCADE to RESTRICT so a profile delete can
// never destroy history again.
//
// This guard (DB half, against TEST) asserts that end state: the new functions
// exist, the destructive old one is gone, and the two booking FKs are RESTRICT.
// The functional scrub itself is proven in a transaction-rollback check during
// development; here we lock the shape so a later migration can't regress it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function testDbUrl(): string | null {
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

const url = testDbUrl();

test('account closure anonymises: new functions exist, old delete is gone, booking FKs are RESTRICT',
    { skip: url ? false : 'no TEST db configured' },
    async () => {
        const pg = require('pg');
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let fns: Set<string>;
        let fkActions: Record<string, string>;
        try {
            fns = new Set((await client.query(
                "select proname from pg_proc where proname in "
                + "('anonymise_own_account','admin_anonymise_account','delete_own_account')",
            )).rows.map((r: any) => r.proname));
            fkActions = Object.fromEntries((await client.query(
                "select conname, confdeltype from pg_constraint "
                + "where conrelid='public.bookings'::regclass "
                + "and conname in ('bookings_guest_id_fkey','bookings_host_id_fkey')",
            )).rows.map((r: any) => [r.conname, r.confdeltype]));
        } finally { await client.end(); }

        assert.ok(fns.has('anonymise_own_account'), 'anonymise_own_account() is missing');
        assert.ok(fns.has('admin_anonymise_account'), 'admin_anonymise_account(uuid) is missing');
        assert.ok(!fns.has('delete_own_account'), 'delete_own_account() still exists — it hard-deletes and must be dropped');

        // confdeltype 'r' = RESTRICT, 'c' = CASCADE.
        assert.equal(fkActions['bookings_guest_id_fkey'], 'r', 'bookings.guest_id must be ON DELETE RESTRICT');
        assert.equal(fkActions['bookings_host_id_fkey'], 'r', 'bookings.host_id must be ON DELETE RESTRICT');
    });

// Deletion must block on EXACTLY what deactivation blocks on, so a permanent
// erasure can never leave a guest, host or provider relying on an account that
// has vanished. The one source of truth is account_deactivation_blockers; both
// the DB guard and the route's friendly pre-check must go through it. Pinned
// statically so the web-editor paste path can't quietly reintroduce the old
// booking-only count that missed experience orders and trade enquiries.
test('the latest deletion migration guards on the deactivation blocker set, not a bespoke booking count', () => {
    const sql = read('supabase/migrations/20261006081500_delete_uses_the_deactivation_blocker_set.sql');
    const fn = sql.slice(sql.indexOf('function public.admin_anonymise_account'));
    const guard = fn.slice(0, fn.indexOf('THE PERSON THEMSELVES'));
    assert.match(guard, /account_deactivation_blockers\(uid\)/,
        'the erasure guard must count account_deactivation_blockers(uid)');
    // The old shape — a direct count over bookings in the guard — must be gone.
    assert.doesNotMatch(guard, /from public\.bookings/,
        'the guard must not run its own bookings query; it defers to the shared blocker set');
});

test('the delete route pre-checks the deactivation blockers and answers 409 with the list', () => {
    const src = read('app/api/account/delete/route.ts');
    assert.match(src, /deactivationBlockers\(admin, uid\)/,
        'the route must use the shared deactivationBlockers helper');
    assert.match(src, /status:\s*409/, 'a blocked deletion must answer 409 so the account page can list the blockers');
    const block = src.indexOf('deactivationBlockers(admin, uid)');
    const rpc = src.indexOf("rpc('anonymise_own_account')");
    assert.ok(block > -1 && rpc > -1 && block < rpc, 'the block is checked before the scrub RPC');
});
