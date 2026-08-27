// Apply a migration to the TEST project, and read the result back.
//
// This exists so migrations stop being pasted into the dashboard by hand. It
// runs SQL against one database and refuses, loudly, to run it against any
// other.
//
// ---------------------------------------------------------------------------
// SETUP — one line in .env.local, which is gitignored
// ---------------------------------------------------------------------------
//
//   SUPABASE_TEST_DB_URL=postgresql://postgres.yefoqcabuijcowoqewtc:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
//
// The name says TEST on purpose: a production string sitting in a slot called
// SUPABASE_TEST_DB_URL is wrong on its face, and the guards below refuse it
// anyway. Nothing here ever prints the URL — only a redacted form.
//
// ---------------------------------------------------------------------------
// WHAT IT WILL NOT DO
// ---------------------------------------------------------------------------
//
//   * It will not touch production. The URL must carry the test project ref,
//     and is refused outright if it carries the production ref or that
//     project's name. Both halves are checked: a string can only pass by being
//     the test database.
//
//   * It will not run anything by accident. With no --apply it is a DRY RUN:
//     it prints what it would run and stops. Applying is an explicit word.
//
//   * It will not quietly destroy data. Statements that lose rows or columns
//     need --destructive ON TOP OF --apply, so nothing irreversible happens
//     without somebody having typed the word. Structural changes that lose no
//     data — dropping a policy, a constraint, an index — are reported in the
//     plan but do not need the extra flag, because half this folder does them.
//
// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------
//
//   node scripts/migrate.mjs supabase/migrations/20260831_thing.sql
//       Dry run. Guards, then the plan, then stop.
//
//   node scripts/migrate.mjs supabase/migrations/20260831_thing.sql --apply
//       Run it.
//
//   node scripts/migrate.mjs <file> --apply --read "select ..."
//       Run it, then read the result back.
//
//   node scripts/migrate.mjs --sql "select ..."
//       A read-only query. Refuses anything that writes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';

const run = promisify(execFile);

// galloway-getaways-test. Production is hviwjxigqivjfhmhpjiy, named
// supabase-pink-elephant, and is not this script's business.
const PROD_REF = 'hviwjxigqivjfhmhpjiy';
const PROD_NAME = 'pink-elephant';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const valueOf = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : null;
};
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--read' && args[args.indexOf(a) - 1] !== '--sql');

function die(message) {
    console.error('\nREFUSED: ' + message + '\n');
    process.exit(1);
}

/* ------------------------------------------------------------------ the URL */

const env = loadEnv();
const url = env.SUPABASE_TEST_DB_URL || process.env.SUPABASE_TEST_DB_URL;

// Two lines with the same key is not an error to a .env parser — the last one
// simply wins, silently. That is a bad way to find out why the password you
// pasted is being ignored, so it is said out loud instead.
try {
    const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const times = raw.split('\n').filter((l) => l.trim().startsWith('SUPABASE_TEST_DB_URL=')).length;
    if (times > 1) {
        die(
            'SUPABASE_TEST_DB_URL appears ' + times + ' times in .env.local.\n' +
            '  The last one wins and the others are ignored. Delete the spares.'
        );
    }
} catch (err) {
    if (err && err.message && err.message.startsWith('SUPABASE_TEST_DB_URL appears')) throw err;
}

if (!url) {
    die(
        'SUPABASE_TEST_DB_URL is not set.\n' +
        '  Put it in .env.local (gitignored), as one line:\n' +
        '  SUPABASE_TEST_DB_URL=postgresql://postgres.' + TEST_PROJECT_REF + ':<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'
    );
}
// "I have not pasted it yet", in every spelling that has actually turned up.
//
// Matching the whole URL was the wrong test and let two through: the string
// always contains the word "postgres", and a placeholder like
// PASTE_PASSWORD_HERE contains neither "your" nor angle brackets. So the
// PASSWORD COMPONENT is what gets examined, and anything reading like an
// instruction rather than a secret is refused.
//
// A real password containing the word "password" would be refused too. That is
// a password worth being refused.
const passwordPart = (() => {
    const m = url.match(/:\/\/[^:]+:([^@]*)@/);
    return m ? m[1] : '';
})();

if (!passwordPart) {
    die('SUPABASE_TEST_DB_URL has no password in it.');
}
if (/password|paste|placeholder|your|here|example|xxx+|<|>|\[|\]/i.test(passwordPart)) {
    die(
        'SUPABASE_TEST_DB_URL still has a placeholder where the password goes.\n' +
        '  It is ' + passwordPart.length + ' characters and reads like an instruction, not a secret.'
    );
}
if (url.includes(PROD_REF) || url.toLowerCase().includes(PROD_NAME)) {
    die('that connection string is PRODUCTION. This script does not run against production, ever.');
}
if (!url.includes(TEST_PROJECT_REF)) {
    die(
        'that connection string is not the test project.\n' +
        '  Expected it to contain ' + TEST_PROJECT_REF + '.'
    );
}

// Everything printed from here on is safe to paste into a chat window.
const redacted = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:********@');

// The --db-url flag wants the password percent-encoded.
function encodePassword(raw) {
    return raw.replace(/:\/\/([^:]+):([^@]*)@/, (_m, user, pw) => '://' + user + ':' + encodeURIComponent(pw) + '@');
}
const dbUrl = encodePassword(url);

/* ------------------------------------------------------- reading the SQL */

const inlineSql = valueOf('sql');
if (!file && !inlineSql) {
    die('nothing to run. Give a migration file, or --sql "select ...".');
}

const sql = inlineSql ?? fs.readFileSync(file, 'utf8');

// Comments and quoted strings are stripped before scanning, so a statement
// described in a comment is not mistaken for one being run — this folder's
// migrations quote their own old constraints in the header.
const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^']*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, ' $$body$$ ')
    .toLowerCase();

const LOSES_DATA = [
    [/\bdrop\s+table\b/, 'drop table'],
    [/\bdrop\s+schema\b/, 'drop schema'],
    [/\bdrop\s+database\b/, 'drop database'],
    [/\bdrop\s+owned\b/, 'drop owned'],
    [/\btruncate\b/, 'truncate'],
    [/\balter\s+table[\s\S]{0,120}?\bdrop\s+column\b/, 'drop column'],
    [/\bdelete\s+from\b(?![\s\S]{0,200}?\bwhere\b)/, 'delete without a where'],
];

const STRUCTURAL = [
    [/\bdrop\s+policy\b/, 'drop policy'],
    [/\bdrop\s+constraint\b/, 'drop constraint'],
    [/\bdrop\s+function\b/, 'drop function'],
    [/\bdrop\s+trigger\b/, 'drop trigger'],
    [/\bdrop\s+index\b/, 'drop index'],
    [/\brevoke\b/, 'revoke'],
];

const destructive = LOSES_DATA.filter(([re]) => re.test(bare)).map(([, name]) => name);
const structural = STRUCTURAL.filter(([re]) => re.test(bare)).map(([, name]) => name);

const writes = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/.test(bare);

if (inlineSql && writes && !flag('apply')) {
    die('--sql is for reading. That query writes; put it in a migration file and use --apply.');
}

/* ------------------------------------------------------------------ plan */

console.log('\n  target   ' + redacted);
console.log('  source   ' + (file || 'inline --sql'));
if (structural.length) console.log('  note     structural, loses no data: ' + structural.join(', '));
if (destructive.length) console.log('  WARNING  LOSES DATA: ' + destructive.join(', '));

if (!flag('apply')) {
    console.log('\n  dry run — nothing was executed. Add --apply to run it.\n');
    process.exit(0);
}

if (destructive.length && !flag('destructive')) {
    die(
        'this would lose data (' + destructive.join(', ') + ').\n' +
        '  Say so out loud: add --destructive as well as --apply.'
    );
}

/* ----------------------------------------------------------------- run it */

async function query({ sqlFile, sqlText }) {
    const argv = ['db', 'query', '--db-url', dbUrl];
    if (sqlFile) argv.push('-f', sqlFile);
    else argv.push(sqlText);
    const { stdout, stderr } = await run('supabase', argv, { maxBuffer: 10 * 1024 * 1024 });
    if (stderr && stderr.trim() && !/A new version/.test(stderr)) console.error(stderr.trim());
    return stdout;
}

try {
    console.log('\n  applying…');
    const out = await query(file ? { sqlFile: file } : { sqlText: inlineSql });
    if (out.trim()) console.log(out.trim());
    console.log('  done.');

    const readBack = valueOf('read');
    if (readBack) {
        console.log('\n  reading back:');
        const back = await query({ sqlText: readBack });
        console.log(back.trim());
    }
    console.log('');
} catch (err) {
    const msg = String(err.stderr || err.message || err);
    // Never let a failure echo the URL back out.
    console.error('\n  FAILED: ' + msg.split(dbUrl).join(redacted).trim() + '\n');
    process.exit(1);
}
