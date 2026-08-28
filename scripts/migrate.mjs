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
//   node scripts/migrate.mjs supabase/migrations/20260831093000_thing.sql
//       Dry run. Guards, then the plan, then stop.
//
//   node scripts/migrate.mjs supabase/migrations/20260831093000_thing.sql --apply
//       Run it.
//
//   node scripts/migrate.mjs <file> --apply --read "select ..."
//       Run it, then read the result back.
//
//   node scripts/migrate.mjs --sql "select ..."
//       A read-only query. Refuses anything that writes.

import fs from 'node:fs';
import pg from 'pg';
import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';

// galloway-getaways-test. Production is hviwjxigqivjfhmhpjiy, named
// supabase-pink-elephant, and is not this script's business.
const PROD_REF = 'hviwjxigqivjfhmhpjiy';
const PROD_NAME = 'pink-elephant';

// TWO TARGETS, AND PRODUCTION IS NEVER THE DEFAULT.
//
// This began refusing production outright. That rule was lifted deliberately on
// 27 Aug 2026 — not worn away — so production is reachable now, and reachable
// only by naming it:
//
//   --target prod
//
// It has its own variable, SUPABASE_PROD_DB_URL, so a production string never
// sits in a slot called TEST and cannot be picked up by a command that forgot
// to say which database it meant. Each target checks that its URL really is the
// database it claims to be, so the two cannot be crossed over.
const TARGETS = {
    test: { name: 'TEST',       ref: TEST_PROJECT_REF, env: 'SUPABASE_TEST_DB_URL' },
    prod: { name: 'PRODUCTION', ref: PROD_REF,         env: 'SUPABASE_PROD_DB_URL' },
};

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const valueOf = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : null;
};
// The file is the one bare argument that is not the VALUE of a flag. Listing
// the value-taking flags in one place, because adding a new one and forgetting
// it here is how `--target prod` came to be treated as a filename.
const VALUE_FLAGS = ['--sql', '--read', '--target'];
const file = (() => {
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) continue;
        if (i > 0 && VALUE_FLAGS.includes(args[i - 1])) continue;
        return args[i];
    }
    return undefined;
})();

function die(message) {
    console.error('\nREFUSED: ' + message + '\n');
    process.exit(1);
}

/* ------------------------------------------------------------------ the URL */

const env = loadEnv();

const targetName = valueOf('target') || 'test';
const target = TARGETS[targetName];
if (!target) die(`unknown --target "${targetName}". It is test or prod.`);

const url = env[target.env] || process.env[target.env];

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
        target.env + ' is not set.\n' +
        '  Put it in .env.local (gitignored), as one line:\n' +
        '  ' + target.env + '=postgresql://postgres.' + target.ref + ':<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'
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
// The crossover check, both ways. A production string in the test slot is as
// wrong as the reverse, and either would be a very quiet way to write to the
// wrong database.
const otherRef = targetName === 'test' ? PROD_REF : TEST_PROJECT_REF;
if (url.includes(otherRef) || (targetName === 'test' && url.toLowerCase().includes(PROD_NAME))) {
    die(
        target.env + ' holds a connection string for the OTHER project.\n' +
        '  --target ' + targetName + ' expects ' + target.ref + '.'
    );
}
if (!url.includes(target.ref)) {
    die(
        target.env + ' is not the ' + target.name + ' project.\n' +
        '  Expected it to contain ' + target.ref + '.'
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

console.log('\n  ' + (targetName === 'prod' ? '*** PRODUCTION ***' : 'target') + '   ' + redacted);
console.log('  source   ' + (file || 'inline --sql'));
if (structural.length) console.log('  note     structural, loses no data: ' + structural.join(', '));
if (destructive.length) console.log('  WARNING  LOSES DATA: ' + destructive.join(', '));

// A read-only --sql just runs. Requiring --apply to SELECT something taught
// the flag to be typed by reflex, which is the one thing it must never become:
// it is the word that stands between a migration file and the database.
const readOnlyQuery = !!inlineSql && !writes;

if (!flag('apply') && !readOnlyQuery) {
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

// WHY node-postgres AND NOT `supabase db query`.
//
// `supabase db query -f file.sql` sends the file as one PREPARED statement, and
// Postgres refuses more than one command in a prepared statement:
//
//     cannot insert multiple commands into a prepared statement
//
// Every migration in this folder is more than one command, so that path could
// never have applied any of them. It went unnoticed because the only things
// ever run through it were single read-only SELECTs and dry runs — the runner
// had never actually applied a migration anywhere when it was called working.
//
// node-postgres sends a query with no parameters over the SIMPLE protocol,
// which permits multiple commands. It also reports which statement failed,
// rather than the file.
async function connect() {
    const client = new pg.Client({
        connectionString: dbUrl,
        // The pooler presents a certificate for the pooler host rather than the
        // project, so strict verification fails on a connection that is fine.
        ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return client;
}

/**
 * Run a whole migration file, in a transaction.
 *
 * All of it or none of it. A file that fails half way through leaves a schema
 * that matches no migration and no rollback to reach for — which on production
 * is the worst place to be doing arithmetic about what did and did not run.
 */
async function applyFile(path) {
    const sqlText = fs.readFileSync(path, 'utf8');
    const client = await connect();
    try {
        await client.query('begin');
        const results = await client.query(sqlText);
        await client.query('commit');
        const list = Array.isArray(results) ? results : [results];
        return list
            .map((r) => (r && r.command) ? r.command + (r.rowCount ? ' (' + r.rowCount + ')' : '') : null)
            .filter(Boolean);
    } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
    } finally {
        await client.end().catch(() => {});
    }
}

async function readQuery(sqlText) {
    const client = await connect();
    try {
        const res = await client.query(sqlText);
        const rows = (Array.isArray(res) ? res[res.length - 1] : res).rows || [];
        return rows;
    } finally {
        await client.end().catch(() => {});
    }
}

if (readOnlyQuery) {
    try {
        const rows = await readQuery(inlineSql);
        console.log(JSON.stringify(rows, null, 2));
        console.log('');
        process.exit(0);
    } catch (err) {
        console.error('\n  FAILED: ' + String(err.message).split(dbUrl).join(redacted) + '\n');
        process.exit(1);
    }
}

try {
    console.log('\n  applying…');
    const commands = file
        ? await applyFile(file)
        : await applyFile.call(null, (() => { throw new Error('inline writes are not supported — put it in a file'); })());
    console.log('  ' + commands.length + ' statement(s): ' + commands.join(', '));
    console.log('  committed.');

    const readBack = valueOf('read');
    if (readBack) {
        console.log('\n  reading back:');
        console.log(JSON.stringify(await readQuery(readBack), null, 2));
    }
    console.log('');
} catch (err) {
    // Never let a failure echo the URL back out.
    const msg = String((err && err.message) || err).split(dbUrl).join(redacted);
    console.error('\n  FAILED (rolled back): ' + msg.trim());
    if (err && err.position) console.error('  at character ' + err.position + ' of the file');
    if (err && err.hint) console.error('  hint: ' + err.hint);
    console.error('');
    process.exit(1);
}
