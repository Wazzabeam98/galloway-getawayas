// Say, once, what has already been applied — and say that we are asserting it.
//
// WHY A ONE-OFF SCRIPT RATHER THAN A MIGRATION
//
// A migration would have to hardcode the list of every file that existed when
// it was written, and would then be wrong for anybody who ran it later. This
// reads the folder at the moment it runs, which is the only correct list.
//
// WHAT IT IS AND IS NOT CLAIMING
//
// Every row it writes is `backfilled = true` with a NULL checksum, and
// `--status` prints those under "ASSUMED, NOT OBSERVED". Nobody watched these
// run and there is no record to import; a checksum invented now would be the
// checksum of the file today, which says nothing about the file when it ran and
// would silently turn an assumption into an apparent observation.
//
// The assumption is well founded rather than convenient. On 1 September 2026
// all 4,334 schema facts in `public` — columns, indexes, constraints, policies,
// RLS flags, functions, triggers, views, extensions and every table and column
// grant — were compared between production and test and found identical, along
// with every storage bucket and policy. Both matched this folder.
//
// It is still an assumption, and the ledger says so for as long as those rows
// live.
//
//   node scripts/backfill-migrations.mjs --target prod
//   node scripts/backfill-migrations.mjs --target test   (default)
//
// Safe to re-run: it inserts only what is missing and never overwrites a row
// the runner observed.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const at = args.indexOf('--target');
const targetName = at >= 0 ? args[at + 1] : 'test';

if (!['prod', 'test'].includes(targetName)) {
    console.error('\nREFUSED: --target is prod or test.\n');
    process.exit(1);
}

const BASIS = 'backfilled 1 Sep 2026; production and test compared and identical across 4,334 schema facts';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();

if (!files.length) {
    console.error('\nREFUSED: no migration files found. Run this from the repo.\n');
    process.exit(1);
}

// Built as one statement so it goes through migrate.mjs, which is the only
// thing in this repo allowed to hold a database URL and the only thing that
// refuses to point at the wrong project.
const values = files
    .map((n) => "('" + n.replace(/'/g, "''") + "', null, true, '" + BASIS + "')")
    .join(',\n           ');

const sql =
    'insert into public.schema_migrations (filename, checksum, backfilled, note)\n' +
    '    values ' + values + '\n' +
    // Never overwrite a row the runner wrote. An observation outranks an
    // assertion, always, and re-running this must not downgrade one.
    '    on conflict (filename) do nothing;';

const tmp = new URL('../supabase/.backfill.tmp.sql', import.meta.url);
fs.writeFileSync(tmp, sql);

console.log('\n  ' + files.length + ' migration files to assert on ' + targetName + '.');

try {
    const out = execFileSync(
        process.execPath,
        ['scripts/migrate.mjs', '--target', targetName, tmp.pathname, '--apply'],
        { encoding: 'utf8' }
    );
    console.log(out);
} catch (err) {
    console.error(String((err && err.stdout) || '') + String((err && err.stderr) || ''));
    process.exit(1);
} finally {
    fs.unlinkSync(tmp);
}

console.log('  Done. Every row is marked backfilled — see --status.\n');
