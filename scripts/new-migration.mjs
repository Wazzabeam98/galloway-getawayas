// Start a migration with a timestamp nobody else is going to pick.
//
//   node scripts/new-migration.mjs "an application is not an account"
//
// WHY THIS EXISTS RATHER THAN A LINE IN A README
//
// The convention was a round hour, and two sessions collided on one twice in a
// single day — 20260901120000, then 20260901180000, hours apart. There are 24
// round hours in a day and 86,400 seconds, so the fix is simply to use the
// clock. But a convention people have to remember is a convention people forget
// at the worst moment, and the worst moment here is a red CI check on somebody
// else's branch.
//
// So it is a command. tests/migration-files.test.ts still refuses a round hour
// on anything new, because a generator nobody runs enforces nothing.

import fs from 'node:fs';

const title = process.argv.slice(2).join(' ').trim();

if (!title) {
    console.error('\nUsage: node scripts/new-migration.mjs "what it does"\n');
    process.exit(1);
}

// The real clock, in UTC, to the second.
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

if (!slug) {
    console.error('\nThat title has no letters or digits in it.\n');
    process.exit(1);
}

const name = stamp + '_' + slug + '.sql';
const dir = new URL('../supabase/migrations/', import.meta.url);
const file = new URL(name, dir);

if (fs.existsSync(file)) {
    console.error('\n' + name + ' already exists. Wait a second and run it again.\n');
    process.exit(1);
}

// A clash is now vanishingly unlikely rather than impossible, so it is still
// checked — against the folder, which is the only place a sibling could be.
const clash = fs.readdirSync(dir).find((n) => n.startsWith(stamp + '_'));
if (clash) {
    console.error('\n' + stamp + ' is already used by ' + clash + '. Wait a second and run it again.\n');
    process.exit(1);
}

fs.writeFileSync(file, `-- ${title}
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- Write the reason here rather than the mechanism: the SQL below already says
-- what it does. What it cannot say is what happens to somebody if it is not
-- applied, and that is what the next person needs.
--
-- PRE-FLIGHT, if this is destructive or could refuse to apply. A query whose
-- result decides whether to run it at all, and what the answer was when you
-- looked.

`);

console.log('\n  supabase/migrations/' + name + '\n');
console.log('  Dry run, then apply, PRODUCTION FIRST:');
console.log('    node scripts/migrate.mjs --target prod supabase/migrations/' + name);
console.log('    node scripts/migrate.mjs --target prod supabase/migrations/' + name + ' --apply');
console.log('    node scripts/migrate.mjs --target test supabase/migrations/' + name + ' --apply\n');
