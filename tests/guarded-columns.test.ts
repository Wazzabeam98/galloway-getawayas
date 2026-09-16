// The detector behind `migrate.mjs --write-registry` — it decides, from a
// migration's SQL alone, which columns land on a guarded table and whether the
// migration grants them to `authenticated`. A miss here means a guarded column
// slips through unclassified (the shared-DB guard then reddens master), or a
// non-guarded column raises a false alarm. The parsing is the risky part, so it
// is pinned without a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const path = require('path');
const fs = require('fs');
// Resolve scripts/ whether this runs from the compiled .test-build/tests (../..)
// or straight from tests/ (../).
function repoScript(name: string) {
    for (const ups of [['..', '..'], ['..']]) {
        const p = path.resolve(__dirname, ...ups, 'scripts', name);
        if (fs.existsSync(p)) return require(p);
    }
    throw new Error('cannot locate scripts/' + name);
}
const { detectGuardedColumns } = repoScript('guardedColumns.cjs');

test('a plain add-column on a guarded table, no grant, is REVOKED/PLATFORM by default', () => {
    const sql = 'alter table "public"."service_providers" add column if not exists "owner_paused" boolean not null default false;';
    assert.deepEqual(detectGuardedColumns(sql), [
        { table: 'service_providers', column: 'owner_paused', selectGranted: false, writeGranted: false },
    ]);
});

test('a granted column reads as GRANTED / PROVIDER_WRITABLE', () => {
    const sql = [
        'alter table "public"."service_providers" add column if not exists "slot_min_people" integer;',
        'grant select ("slot_min_people") on "public"."service_providers" to "authenticated";',
    ].join('\n');
    assert.deepEqual(detectGuardedColumns(sql), [
        { table: 'service_providers', column: 'slot_min_people', selectGranted: true, writeGranted: false },
    ]);
});

test('insert/update grants set writeGranted; select alone does not', () => {
    const sql = [
        'alter table "public"."service_providers" add column "x" text;',
        'grant insert, update ("x") on "public"."service_providers" to "authenticated";',
    ].join('\n');
    assert.deepEqual(detectGuardedColumns(sql), [
        { table: 'service_providers', column: 'x', selectGranted: false, writeGranted: true },
    ]);
});

test('profiles is guarded too', () => {
    const sql = 'alter table "public"."profiles" add column "nickname" text;';
    assert.deepEqual(detectGuardedColumns(sql), [
        { table: 'profiles', column: 'nickname', selectGranted: false, writeGranted: false },
    ]);
});

test('a column on a NON-guarded table is ignored (no false alarm)', () => {
    const sql = 'alter table "public"."service_provider_items" add column "capacity" integer;';
    assert.deepEqual(detectGuardedColumns(sql), []);
});

test('several columns in one alter are all found, and deduped', () => {
    const sql = 'alter table "public"."service_providers"\n  add column "a" text,\n  add column if not exists "b" integer;';
    const cols = detectGuardedColumns(sql).map((c: any) => c.column).sort();
    assert.deepEqual(cols, ['a', 'b']);
});

test('a migration that only grants (no add column) finds nothing to classify', () => {
    const sql = 'grant select ("business_name") on "public"."service_providers" to "authenticated";';
    assert.deepEqual(detectGuardedColumns(sql), []);
});

test('case and unquoted identifiers still parse', () => {
    const sql = 'ALTER TABLE public.service_providers ADD COLUMN owner_flag boolean;';
    assert.deepEqual(detectGuardedColumns(sql), [
        { table: 'service_providers', column: 'owner_flag', selectGranted: false, writeGranted: false },
    ]);
});
