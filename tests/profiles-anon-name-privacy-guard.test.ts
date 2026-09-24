// A logged-out visitor must never be able to read a person's legal name off
// profiles over the REST API. On 2026-09-24 the overnight audit proved the anon
// role still held a column-level SELECT grant on profiles.full_name,
// preferred_name and show_full_name, and the profiles SELECT policy is
// USING (true) for everyone — so `GET /rest/v1/profiles?select=full_name`
// returned every guest's and host's legal name. show_full_name was only a
// render-layer curtain in app code, not a real gate.
//
// 20260924174233_profiles_revoke_anon_name.sql revokes those three columns from
// anon; the public surfaces that show a name now read them through the service
// role and send a first name only. This guard asserts the revoke stays revoked:
// if a later migration re-grants any of these to anon, or a fresh env forgets
// the revoke, this fails by name. The authenticated grant is intentionally left
// alone (checked separately in select-grant-decision-guard.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// Columns a stranger must not be able to SELECT (they carry, or gate, a surname).
const ANON_FORBIDDEN = ['full_name', 'preferred_name', 'show_full_name'];

function testDbUrl(): string | null {
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

const url = testDbUrl();

test('profiles: anon cannot SELECT the name columns (no surname leak over REST)',
    { skip: url ? false : 'no TEST db configured — apply the migration and re-run against test' },
    async () => {
        const pg = require('pg');
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let anonGranted: Set<string>;
        try {
            anonGranted = new Set((await client.query(
                "select column_name from information_schema.column_privileges "
                + "where table_name='profiles' and table_schema='public' "
                + "and grantee='anon' and privilege_type='SELECT'",
            )).rows.map((r: any) => r.column_name));
        } finally { await client.end(); }

        const leaked = ANON_FORBIDDEN.filter((c) => anonGranted.has(c));
        assert.deepEqual(
            leaked, [],
            'anon can SELECT these profiles name columns over the REST API — a logged-out\n'
            + 'visitor can read legal names. Revoke them (see\n'
            + '20260924174233_profiles_revoke_anon_name.sql):\n  ' + leaked.join('\n  '),
        );
    });
