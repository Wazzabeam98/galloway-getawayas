// Whole-table grant decisions: tables the browser must never reach at all.
//
// The column guards (select-grant-decision-guard, provider-writable-columns-
// guard) decide column by column for the two tables the browser reads in part.
// Some tables hold nothing a browser should see or write in any column — a push
// subscription is a key to somebody's lock screen — and for those the decision
// is the whole table: RLS on, no policies, every grant to anon and
// authenticated revoked, reached only through a server route with the service
// role. This file is that decision in writing, with the reason.
//
// Two halves, the same as the column guard:
//   - static, always (CI included): the migration that creates each table says
//     so in SQL — RLS on, revokes for both browser roles, no policy, no grant
//   - live, where a TEST database is configured (.env.local
//     SUPABASE_TEST_DB_URL): the table really has RLS on, no policies and no
//     anon/authenticated privilege
//
// Add a table here when you create one the browser must never touch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDbUrl, tableGrantsTo } from './_testDb';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

type ServiceOnly = { table: string; migration: string; reason: string };

const SERVICE_ROLE_ONLY: ServiceOnly[] = [
    {
        table: 'push_subscriptions',
        migration: '20261019145415_push_subscriptions.sql',
        reason: 'endpoint + keys are enough to push to that person\'s phone; written by /api/push/subscribe, read by lib/push.ts, both with the service role',
    },
    {
        table: 'push_outbox',
        migration: '20261019170805_push_outbox_and_push_preferences.sql',
        reason: 'who is pushed and when, for every event on the site; written by the email layer and database triggers, sent and read only by the push job with the service role',
    },
    {
        table: 'payout_destinations_seen',
        migration: '20261019170805_push_outbox_and_push_preferences.sql',
        reason: 'a fingerprint of each connected account\'s payout destination, for the payout-details-changed alert; read and written only by the push job',
    },
    {
        table: 'email_outbox',
        migration: '20261020151334_email_outbox.sql',
        reason: 'the recipient and rendered body of every email awaiting a retry after a failed send; written by the email layer and retried by the push job, both with the service role',
    },
];

const code = (sql: string) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

for (const t of SERVICE_ROLE_ONLY) {
    test(`${t.table}: its migration makes it service-role only`, () => {
        assert.ok(t.reason.length > 20, 'a service-role-only table needs its reason written down');
        const sql = code(fs.readFileSync(path.join(ROOT, 'supabase/migrations', t.migration), 'utf8'));
        const name = 'public\\.' + t.table;
        assert.match(sql, new RegExp('create table if not exists ' + name + '\\b'));
        assert.match(sql, new RegExp('alter table ' + name + ' enable row level security;'));
        assert.match(sql, new RegExp('revoke all on table ' + name + ' from anon;'));
        assert.match(sql, new RegExp('revoke all on table ' + name + ' from authenticated;'));
        assert.doesNotMatch(sql, new RegExp('create policy[^;]* on ' + name + '\\b'), 'no policy: nobody but the service role');
        assert.doesNotMatch(sql, new RegExp('grant [^;]* on (table )?' + name + ' to [^;]*\\b(anon|authenticated|public)\\b'), 'never granted to a browser role');
    });

    test(`${t.table}: no later migration grants it to a browser role or adds a policy`, () => {
        const later = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
            .filter((f: string) => f > t.migration && f.endsWith('.sql'));
        for (const f of later) {
            const sql = code(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));
            assert.doesNotMatch(sql, new RegExp('grant [^;]* on (table )?(public\\.)?' + t.table + ' to [^;]*\\b(anon|authenticated|public)\\b'), f);
            assert.doesNotMatch(sql, new RegExp('create policy[^;]* on (public\\.)?' + t.table + '\\b'), f);
        }
    });
}

for (const t of SERVICE_ROLE_ONLY) {
    const url = testDbUrl();
    test(`${t.table}: live — RLS on, no policies, nothing for anon or authenticated`,
        { skip: url ? false : 'no TEST db configured — the static half still ran' },
        async () => {
            const pg = require('pg');
            const client = new pg.Client({ connectionString: url });
            await client.connect();
            try {
                const rls = await client.query(
                    `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = $1`, [t.table]);
                if (rls.rows.length === 0) return; // not applied to TEST yet; the static half holds
                assert.equal(rls.rows[0].relrowsecurity, true, 'RLS is on');
                const pol = await client.query(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename = $1`, [t.table]);
                assert.equal(pol.rows[0].n, 0, 'no policies');
                const grants = await tableGrantsTo(client, t.table, ['anon', 'authenticated', 'PUBLIC']);
                assert.deepEqual(grants, [], 'no privilege for a browser role');
            } finally {
                await client.end();
            }
        });
}
