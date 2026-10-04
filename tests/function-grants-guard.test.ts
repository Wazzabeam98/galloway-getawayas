// No function in the public schema may be callable by the browser roles unless
// it is on this list, with the reason a real caller needs it.
//
// WHY THIS EXISTS. Supabase grants EXECUTE on every new function directly to
// anon and authenticated (its default privileges), and `revoke all ... from
// public` does not remove those direct grants. Until 20261004133346 that left 26
// public functions on production callable with the public site key — account
// deactivation and erasure, the booking-expiry and review-publishing jobs,
// rating recalculation. 20261004133346 revoked them and changed the default for
// functions created by postgres; this test is the wall for everything else
// (a function created by supabase_admin, a migration that grants by hand, a
// grant someone adds "just to make it work").
//
// TO ADD ONE: put it in ALLOWED with the role(s) and a reason naming its caller
// and saying how it limits itself to the caller's own data. Trigger functions
// and cron jobs never belong here — a trigger fires without the caller holding
// EXECUTE, and pg_cron runs as postgres. Server routes call rpc() with the
// service key, which keeps EXECUTE everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

type Role = 'anon' | 'authenticated';
const ALLOWED: Record<string, { roles: Role[]; reason: string }> = {
    'may_read_listing(uuid,uuid)': {
        roles: ['anon', 'authenticated'],
        reason: 'listings_readable SELECT policy applies to every role (public listing pages); answers only about auth.uid()',
    },
    'owns_order(uuid)': {
        roles: ['authenticated'],
        reason: 'booking_guests "order guests readable" policy (authenticated only); answers only about auth.uid()',
    },
    'is_order_message_participant(uuid)': {
        roles: ['authenticated'],
        reason: 'messages view/send policies (authenticated only); answers only about auth.uid()',
    },
    'order_reviewable_by(uuid,uuid)': {
        roles: ['authenticated'],
        reason: 'reviews INSERT policy passes auth.uid(); returns false for any other user id',
    },
    'submit_service_provider(uuid)': {
        roles: ['authenticated'],
        reason: 'provider sign-up wizard submits for review; raises unless the listing is the caller\'s own',
    },
    'deactivate_own_account()': {
        roles: ['authenticated'],
        reason: 'app/api/account/deactivate calls it as the signed-in user; acts on auth.uid() only',
    },
    'anonymise_own_account()': {
        roles: ['authenticated'],
        reason: 'app/api/account/delete calls it as the signed-in user; acts on auth.uid() only',
    },
};

const MIGRATION = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20261004133346_lock_definer_function_grants.sql'), 'utf8');

test('every allowed function carries a reason and at least one role', () => {
    for (const [fn, { roles, reason }] of Object.entries(ALLOWED)) {
        assert.ok(reason && reason.trim().length > 20, fn + ' needs a written reason');
        assert.ok(roles.length > 0, fn + ' lists no role');
    }
});

test('the migration grants back exactly the allowlist, by role', () => {
    const grants = [...MIGRATION.matchAll(/grant execute on function public\.([a-z_]+)\(([^)]*)\)\s+to ([a-z_, ]+);/g)]
        .map((m) => ({ fn: m[1] + '(' + m[2].replace(/\s+/g, '') + ')', roles: m[3].split(',').map((r) => r.trim()) }));
    const granted: Record<string, string[]> = {};
    for (const g of grants) granted[g.fn] = g.roles.filter((r) => r === 'anon' || r === 'authenticated');
    assert.deepEqual(
        Object.keys(granted).sort(), Object.keys(ALLOWED).sort(),
        'the migration and the allowlist must name the same functions');
    for (const [fn, { roles }] of Object.entries(ALLOWED)) {
        assert.deepEqual(granted[fn].sort(), [...roles].sort(), fn + ': roles differ between migration and allowlist');
    }
});

test('the migration fixes the root cause: postgres default privileges drop the browser roles', () => {
    assert.match(MIGRATION, /alter default privileges for role postgres\s+revoke execute on functions from public, anon, authenticated;/);
    assert.match(MIGRATION, /alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;/);
});

// DB half — the gate. Reads the live TEST grants, so a function created later
// that nobody decided about fails by name.
function testDbUrl(): string | null {
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

const url = testDbUrl();

test('no public function is executable by anon or authenticated unless it is on the allowlist for that role',
    { skip: url ? false : 'no TEST db configured — the static checks above still run' },
    async () => {
        const pg = require('pg');
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let rows: any[];
        try {
            rows = (await client.query(`
                select p.oid::regprocedure::text as sig,
                       has_function_privilege('anon', p.oid, 'execute') as anon,
                       has_function_privilege('authenticated', p.oid, 'execute') as authd
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                   and (has_function_privilege('anon', p.oid, 'execute')
                        or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows;
        } finally { await client.end(); }

        const problems: string[] = [];
        for (const r of rows) {
            const allowed = ALLOWED[r.sig];
            if (r.anon && !(allowed && allowed.roles.includes('anon'))) problems.push(r.sig + ' — executable by anon');
            if (r.authd && !(allowed && allowed.roles.includes('authenticated'))) problems.push(r.sig + ' — executable by authenticated');
        }
        assert.deepEqual(problems.sort(), [],
            'These functions are callable from the browser without a written decision. Revoke them\n'
            + '(`revoke execute on function public.<fn> from anon, authenticated;`), or add them to ALLOWED\n'
            + 'in tests/function-grants-guard.test.ts with the caller and why it is safe:\n  '
            + problems.join('\n  '));
    });

test('postgres no longer grants new public functions to the browser roles by default',
    { skip: url ? false : 'no TEST db configured' },
    async () => {
        const pg = require('pg');
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let acls: string[];
        try {
            acls = (await client.query(`
                select coalesce(defaclacl::text, '') as acl from pg_default_acl
                 where defaclobjtype = 'f' and pg_get_userbyid(defaclrole) = 'postgres'
                   and (defaclnamespace = 'public'::regnamespace or defaclnamespace = 0)`)).rows.map((r: any) => r.acl);
        } finally { await client.end(); }
        assert.ok(acls.length > 0, 'expected a default-privileges entry for postgres');
        for (const acl of acls) {
            assert.doesNotMatch(acl, /(^|[{,])(anon|authenticated)=|(^|[{,])=X/, 'postgres default privileges still grant functions to: ' + acl);
        }
    });
