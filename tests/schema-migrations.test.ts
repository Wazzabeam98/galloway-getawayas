// The ledger's rules, held where they can be checked without a database.
//
// WHAT THIS CAN AND CANNOT DO
//
// It cannot ask production whether a migration has been applied — CI has no
// credentials for it and should not. That check is `--status`, run by a person,
// and the honest version of this ledger is checkable rather than enforced.
//
// What it CAN hold is everything that lives in this repo: that the runner
// records what it applies, in the same transaction, only for real migrations;
// that the backfill never claims to have observed anything; and that no two
// migrations share a timestamp, which is what started all of this.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

test('the runner records what it applies, in the same transaction', () => {
    const code = read('scripts/migrate.mjs');

    const insertAt = code.indexOf('insert into public.schema_migrations');
    const commitAt = code.indexOf("await client.query('commit')");

    assert.ok(insertAt > 0, 'the runner must write a ledger row at all');
    assert.ok(
        insertAt < commitAt,
        'the ledger row has to be inside the transaction. Written after the commit it can '
        + 'fail on its own, and then the schema has moved while the record says it has not — '
        + 'which is the exact state this table exists to end.'
    );
});

test('the runner takes a checksum of what it applied', () => {
    const code = read('scripts/migrate.mjs');
    assert.match(code, /checksumOf\(sqlText\)/,
        'without the file’s contents at apply time, an edit afterwards is undetectable');
});

test('only files in supabase/migrations are recorded as migrations', () => {
    // The runner will apply any .sql path it is handed. The first backfill run
    // recorded its own temporary file, which is how this rule stopped being an
    // assumption.
    const code = read('scripts/migrate.mjs');
    assert.match(code, /inMigrationsFolder/,
        'a probe or a one-off fix is not a migration and must not enter the ledger');
});

test('the backfill never claims to have observed anything', () => {
    const code = read('scripts/backfill-migrations.mjs');

    assert.match(code, /backfilled/, 'every backfilled row has to be marked as one');
    assert.match(code, /null, true,/,
        'the checksum must be NULL for a backfilled row: a checksum taken now describes the '
        + 'file today, says nothing about the file when it ran, and would quietly turn an '
        + 'assumption into an apparent observation');
    assert.match(code, /do nothing/,
        'an observation outranks an assertion — re-running the backfill must never downgrade one');
});

test('--status separates what was observed from what was assumed', () => {
    const code = read('scripts/migrate.mjs');
    assert.match(code, /ASSUMED, NOT OBSERVED/);
    assert.match(code, /OBSERVED/);
    assert.match(code, /EDITED SINCE IT RAN/);
    assert.match(code, /OUTSTANDING/);
});

test('the pre-push hook warns about migrations and never refuses on them', () => {
    const hook = read('scripts/hooks/pre-push');

    const noteAt = hook.indexOf('the test database is behind this checkout');
    assert.ok(noteAt > 0, 'the hook should say something about an outstanding migration');

    // Everything after the note must not exit non-zero. A check that depends on
    // a network and a password in .env.local must not be able to stop a push:
    // the moment it can, --no-verify becomes reflex and the tests and build stop
    // being checked too.
    const after = hook.slice(noteAt);
    assert.doesNotMatch(after, /exit 1/,
        'the migration note must not be able to fail a push');

    assert.match(hook, /--target test --status/, 'it checks test');
    assert.doesNotMatch(hook, /--target prod --status > /,
        'it must not run the production check automatically — that stays a human decision');
});

// The timestamp-collision rule and the filename-shape rule are NOT repeated
// here. tests/migration-files.test.ts has held both since before this ledger
// existed, and a second copy of a rule is two places for it to drift — which is
// the failure this whole file is about. I wrote them out before checking, and
// CI reported the same test name twice, which is how I found out.
