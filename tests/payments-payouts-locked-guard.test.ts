// payments and payouts are service-role-only. This guards that the migration
// which revokes the browser-role write grants stays in place — the tables were
// one CREATE POLICY away from a browser being able to mint a payout, and the
// revoke is what removes that fault-line.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

test('payments and payouts revoke browser-role writes', () => {
    const sql = fs.readFileSync(
        path.join(ROOT, 'supabase/migrations/20260903181045_payments_payouts_are_service_role_only.sql'),
        'utf8',
    ).replace(/\s+/g, ' ');
    for (const table of ['payments', 'payouts']) {
        assert.match(
            sql,
            new RegExp('revoke[^;]*on\\s+"?public"?\\."?' + table + '"?\\s+from\\s+"?anon"?\\s*,\\s*"?authenticated"?', 'i'),
            table + ' no longer revokes INSERT/UPDATE from the browser roles — a money table is writable again the moment a write policy is added.',
        );
    }
});
