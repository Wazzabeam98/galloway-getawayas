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
//
//   node scripts/migrate.mjs --target prod <file> --record --note "why" \
//       --check "select to_regclass('public.foo') is not null"
//       Somebody else applied it, by hand or from a branch that predates the
//       ledger. Writes the row as an ASSUMPTION so --status stops calling it
//       outstanding — but ONLY if --check proves the change is present first
//       (one truthy value, read-only). The check is stored, and --status re-runs
//       it on every read, so a schema that later drifts from it is caught loudly
//       rather than passing as a silent tick.

import fs from 'node:fs';
import pg from 'pg';
import crypto from 'node:crypto';
import pathModule from 'node:path';
import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';
import { createRequire } from 'node:module';

// .cjs for the same reason scripts/target.cjs is: the test suite is CommonJS
// and on Node 20 CommonJS cannot require an ESM file.
const { classify } = createRequire(import.meta.url)('./sqlRisk.cjs');

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
const VALUE_FLAGS = ['--sql', '--read', '--target', '--note', '--check'];
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
// --status asks a question rather than running anything, so it is the one mode
// that legitimately arrives with no file and no SQL.
if (!file && !inlineSql && !flag('status')) {
    die('nothing to run. Give a migration file, --sql "select ...", or --status.');
}

// --record writes a ledger row for a migration somebody else applied. It reads
// no SQL and executes none, so it must not be dragged through the classifier or
// the --apply gate below.
const sql = (flag('status') || flag('record')) ? '' : (inlineSql ?? fs.readFileSync(file, 'utf8'));

// What this SQL would do — see scripts/sqlRisk.cjs. It lives there rather than
// here because the only way to test it in this file was to run this script,
// which needs .env.local; the tests passed locally and failed in CI, which is
// no test at all for a rule that decides whether a migration may drop a table.
const { destructive, structural, writes, bare } = classify(sql);

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

// --status is read-only and must not be told to add --apply. It is a question,
// and requiring the word that stands between a migration and the database in
// order to ask a question is how that word becomes reflex.
if (!flag('apply') && !readOnlyQuery && !flag('status') && !flag('record')) {
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
/**
 * Exit without cutting stdout off mid-sentence.
 *
 * process.exit() does not wait for a PIPED stdout to drain. Straight to a
 * terminal it looks fine, because that write is synchronous; piped into a file
 * or read by another script it is not, and the tail is simply lost. A large
 * --sql result therefore came back as truncated JSON with a zero exit status —
 * no error anywhere, just an object that stops mid-key.
 *
 * Found on 1 September 2026 by scripts/schema-diff.mjs, which reads about 4,300
 * rows through this and got roughly a third of them. Nothing before that had
 * ever asked this runner for more output than a pipe buffer holds.
 */
async function finish(code) {
    await new Promise((resolve) => process.stdout.write('', resolve));
    process.exit(code);
}

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
function checksumOf(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

async function applyFile(path) {
    const sqlText = fs.readFileSync(path, 'utf8');
    const client = await connect();
    try {
        await client.query('begin');
        const results = await client.query(sqlText);

        // THE LEDGER ROW GOES IN THE SAME TRANSACTION AS THE DDL.
        //
        // Not after it. A separate write can fail on its own, and then the
        // schema has moved and the record says it has not — which is precisely
        // the state this table exists to end, recreated by the thing meant to
        // end it. In one transaction they cannot disagree: either both happened
        // or neither did.
        //
        // Guarded on the table existing, because the migration that CREATES it
        // has to be able to run before it exists. That one is recorded by the
        // backfill, like everything else written before this idea.
        //
        // The checksum is the file's bytes as they are at this moment. If the
        // file is edited afterwards, --status can say so; without it, an edited
        // migration is invisible.
        const { rows: hasLedger } = await client.query(
            "select to_regclass('public.schema_migrations') is not null as present"
        );

        // ONLY FILES FROM supabase/migrations ARE MIGRATIONS.
        //
        // The runner will happily apply any .sql path it is given — a probe, a
        // one-off fix, the temporary file scripts/backfill-migrations.mjs
        // builds — and none of those is a migration. The first backfill run
        // recorded its own temp file, which is how this rule came to be
        // written down rather than assumed.
        const inMigrationsFolder =
            pathModule.resolve(pathModule.dirname(path))
            === pathModule.resolve(pathModule.dirname(new URL('../supabase/migrations/x', import.meta.url).pathname));

        if (hasLedger[0] && hasLedger[0].present && inMigrationsFolder) {
            await client.query(
                `insert into public.schema_migrations (filename, checksum, backfilled, note)
                 values ($1, $2, false, null)
                 on conflict (filename) do update
                   set applied_at = now(), checksum = excluded.checksum, backfilled = false`,
                [pathModule.basename(path), checksumOf(sqlText)]
            );
        }

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

/* ---------------------------------------------------------------- --record */

// "I have checked, this one has already been applied. Write it down."
//
// WHY THIS EXISTS
//
// Two sessions work on this repo and only one of them goes through this runner.
// A migration applied by hand — in the Supabase SQL editor, or by a branch cut
// before the ledger existed — leaves the schema changed and the ledger silent,
// so --status calls it OUTSTANDING for ever.
//
// That is worse than it sounds. The warning is on the pre-push hook, and a
// warning that is wrong every time is a warning people stop reading — at which
// point the genuinely outstanding migration goes past unnoticed, which is the
// exact failure the ledger was built to prevent. It happened on 1 September:
// 20260902090000_one_form_guest.sql read as outstanding on both projects and
// was applied on both.
//
// WHAT IT DOES NOT DO
//
// It does not check. It cannot: there is no general way to ask a database
// whether a particular file has been run, which is why this table exists at all.
// So it records an ASSERTION — backfilled = true, exactly like the original
// backfill — and --status keeps printing it under "assumed, not observed".
//
// The note is required for the same reason. "Verified from the schema on
// 1 Sept: index present, column present" is a sentence somebody can check. An
// unexplained row is the thing this whole table was built to stop.
//
// AND NO CHECKSUM. Storing today's hash would say "the file matched when it was
// applied", which is not something we know — we were not there. Null is the
// honest answer and --status already treats it as un-checkable.
if (flag('record')) {
    const name = pathModule.basename(file || '');
    const note = valueOf('note');

    if (!file) die('--record needs the migration file it is recording.');

    const inFolder = fs.existsSync(
        new URL('../supabase/migrations/' + name, import.meta.url)
    );
    if (!inFolder) {
        die('there is no supabase/migrations/' + name + '.\n'
            + '  --record writes down a migration from the folder. If the file has been\n'
            + '  renamed, record it under the name the folder uses now.');
    }

    if (!note) {
        die('--record needs --note "why you believe this has already been applied".\n'
            + '  An unexplained row is what this table exists to stop. Say what you\n'
            + '  checked:  --note "verified from the schema on 1 Sept — index present"');
    }

    // --record USED to take the operator's word for it: it wrote a ledger row
    // without asking the database anything, so a wrong belief became a silent
    // lie the gate could not catch (status exits clean on an assumption). Now it
    // must PROVE the claim first. --check is a read-only query that asserts the
    // migration's effect is present — a column, an index, a grant, a constraint.
    // It has to return a single truthy value (true, or a count > 0). If it comes
    // back false, empty, or errors, NOTHING is written: an unverifiable record is
    // exactly the footgun this flag exists to remove.
    const check = valueOf('check');
    if (!check) {
        die('--record needs --check "<read-only SQL that proves it is applied>".\n'
            + '  The row is only worth writing if the schema actually shows the change.\n'
            + '  The query must return one truthy value — refused otherwise. Examples:\n'
            + "    --check \"select to_regclass('public.foo') is not null\"\n"
            + "    --check \"select count(*) > 0 from information_schema.columns\n"
            + "             where table_name='bookings' and column_name='free_cancel_until'\"\n"
            + '  It is stored with the row, so --status can re-run it and catch the day\n'
            + '  the schema drifts away from what you recorded.');
    }
    const { writes: checkWrites } = classify(check);
    if (checkWrites) {
        die('--check is a read-only assertion. That query writes. It must only ASK\n'
            + '  whether the change is present, never make one.');
    }

    const client = await connect();
    try {
        // Self-bootstrap the column so a fresh ledger, and the read just below,
        // never trip over its absence.
        await client.query('alter table public.schema_migrations add column if not exists verify_sql text');

        // Run the proof FIRST, before deciding whether this is a new record or a
        // check being attached to one already in the ledger. Either way the rule
        // is the same: the change must be present now, or nothing is written.
        let ok = false;
        try {
            await client.query('begin');
            const r = await client.query(check);
            await client.query('rollback');
            const rows = r.rows || [];
            if (rows.length) {
                const first = rows[0][Object.keys(rows[0])[0]];
                ok = first === true || (typeof first === 'number' && first > 0)
                    || (typeof first === 'bigint' && first > 0n)
                    || (typeof first === 'string' && first !== '' && first !== 'f' && first !== '0');
            }
        } catch (err) {
            await client.query('rollback').catch(() => {});
            die('the --check query errored, so nothing was written:\n  '
                + String(err.message).split(dbUrl).join(redacted)
                + '\n  Fix the check, or if the migration is genuinely NOT applied, apply it.');
        }
        if (!ok) {
            die('the --check came back false/empty on ' + target.name + ', so the change is\n'
                + '  NOT present. Nothing written — this is the footgun working. Either the\n'
                + '  migration has not actually been applied, or the check is wrong.');
        }

        const already = await client.query(
            'select backfilled, verify_sql from public.schema_migrations where filename = $1', [name]
        );

        if (!already.rows.length) {
            // A genuinely new record.
            await client.query(
                `insert into public.schema_migrations (filename, checksum, backfilled, note, verify_sql)
                 values ($1, null, true, $2, $3)`,
                [name, note, check]
            );
            console.log('\n  Verified and recorded ' + name + ' on ' + target.name + '.');
            console.log('  The --check passed, so the change is present now. Stored as an');
            console.log('  ASSUMPTION (backfilled, no checksum) — but --status will RE-RUN the');
            console.log('  check and shout if the schema ever drifts from it.');
        } else if (!already.rows[0].backfilled) {
            // Already an OBSERVATION — the runner watched it run and holds a
            // checksum. That is stronger than any after-the-fact --check, so we
            // leave it alone rather than downgrade it to an assumption.
            console.log('\n  ' + name + ' is already recorded by this runner as an OBSERVATION');
            console.log('  (it has a checksum). That is stronger than a --check — nothing to do.\n');
            process.exit(0);
        } else if (already.rows[0].verify_sql === check) {
            console.log('\n  ' + name + ' already carries exactly this check, and it still passes.');
            console.log('  Nothing to do.\n');
            process.exit(0);
        } else {
            // THE ATTACH PATH. A legacy assumption (backfilled, no checksum, and
            // either no check or a different one) — the 73 the 1 Sept backfill
            // left un-verifiable. The check passed, so bring it under continuous
            // verification: --status will re-run this from now on.
            const wasNull = already.rows[0].verify_sql == null;
            await client.query(
                'update public.schema_migrations set verify_sql = $2, note = $3 where filename = $1',
                [name, check, note]
            );
            console.log('\n  ' + (wasNull ? 'Attached a check to' : 'Updated the check on')
                + ' a legacy assumption: ' + name + ' on ' + target.name + '.');
            console.log('  The --check passed, so the change IS present. It is no longer a blind');
            console.log('  assumption — --status re-runs this check and shouts if it ever fails.');
        }

        console.log('  note:  ' + note);
        console.log('  check: ' + check + '\n');
    } finally {
        await client.end().catch(() => {});
    }

    process.exit(0);
}

/* ---------------------------------------------------------------- --status */

// What this database says has run, against what the folder says should have.
//
// Read-only, and it answers three different questions that are easy to confuse:
//
//   OUTSTANDING  in the folder, not in the ledger. Something to run.
//   EDITED       in both, but the file no longer matches what was applied.
//                Nobody finds this by reading: the file looks right and the
//                schema does not match it.
//   UNKNOWN      in the ledger as an assumption rather than an observation.
//
// The third is printed as prominently as the other two on purpose. Every
// migration written before the ledger existed is an assertion made from the
// state of the schema, and a status screen that showed those as plain ticks
// would be claiming somebody watched them run. Nobody did.
if (flag('status')) {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const onDisk = fs.readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort();

    let ledger;
    try {
        // verify_sql only exists once a --record --check has run against this
        // database, so read it conditionally rather than assume the column.
        const hasVerify = (await readQuery(
            "select count(*) n from information_schema.columns "
            + "where table_schema='public' and table_name='schema_migrations' "
            + "and column_name='verify_sql'"
        ))[0].n > 0;
        ledger = await readQuery(
            'select filename, applied_at, checksum, backfilled, note, '
            + (hasVerify ? 'verify_sql ' : 'null::text as verify_sql ')
            + 'from public.schema_migrations order by filename'
        );
    } catch (err) {
        console.error(
            '\n  Could not read public.schema_migrations on ' + target.name + '.'
            + '\n  ' + String(err.message).split(dbUrl).join(redacted)
            + '\n\n  If the table does not exist yet, apply'
            + '\n  supabase/migrations/20260901180000_a_record_of_what_has_run.sql first.\n'
        );
        process.exit(1);
    }

    const known = new Map(ledger.map((r) => [r.filename, r]));

    const outstanding = [];
    const edited = [];
    const assumed = [];
    let observed = 0;

    for (const name of onDisk) {
        const row = known.get(name);
        if (!row) { outstanding.push(name); continue; }

        if (row.backfilled) { assumed.push(name); continue; }

        const now = crypto.createHash('sha256')
            .update(fs.readFileSync(new URL(name, dir), 'utf8'))
            .digest('hex');

        if (row.checksum && row.checksum !== now) edited.push({ name, was: row.checksum, is: now });
        else observed++;
    }

    // Re-run the stored proof for every assumption that has one. A --record now
    // writes the --check that verified it, so the gate is no longer blind to
    // assumptions: if the schema has since drifted away from what was recorded,
    // the check comes back false HERE and this stops being a silent tick. The
    // legacy backfill rows carry no check (verify_sql is null) and stay in the
    // quiet "assumed, not observed" list — there is nothing to re-run for them.
    const assumedFailing = [];
    const assumedVerified = [];
    const assumedLegacy = [];
    for (const name of assumed) {
        const vsql = known.get(name).verify_sql;
        if (!vsql) { assumedLegacy.push(name); continue; }
        try {
            const r = await readQuery(vsql);
            const rows = Array.isArray(r) ? r : [];
            const first = rows.length ? rows[0][Object.keys(rows[0])[0]] : null;
            const ok = first === true || (typeof first === 'number' && first > 0)
                || (typeof first === 'bigint' && first > 0n)
                || (typeof first === 'string' && first !== '' && first !== 'f' && first !== '0');
            (ok ? assumedVerified : assumedFailing).push({ name, vsql });
        } catch (err) {
            assumedFailing.push({ name, vsql, error: String(err.message).split(dbUrl).join(redacted) });
        }
    }

    // In the ledger and not on disk. A deleted or renamed migration file.
    const orphaned = ledger.map((r) => r.filename).filter((n) => !onDisk.includes(n));

    const rule = '  ' + '-'.repeat(68);
    console.log('\n  ' + target.name + ' — ' + onDisk.length + ' migration files, '
        + ledger.length + ' rows in the ledger');
    console.log(rule);

    if (outstanding.length) {
        console.log('\n  OUTSTANDING — in the folder, never applied here (' + outstanding.length + ')');
        outstanding.forEach((n) => console.log('      ' + n));
        console.log('\n      Run each with:  node scripts/migrate.mjs --target '
            + targetName + ' supabase/migrations/<file> --apply');
        // A backfill only knows the folder as it was when it ran. A migration
        // somebody else merged afterwards is genuinely applied and genuinely
        // absent from the ledger, and it shows up here looking identical to one
        // that was never run. This listing errs towards telling you to check,
        // which is the right direction — but it should say which kind of
        // "outstanding" it cannot tell apart. Watched happening on 1 September
        // 2026 with another session's migration.
        console.log('\n      If you think one of these has already run, check the schema before');
        console.log('      re-applying it. A backfill only recorded the folder as it was at the');
        console.log('      time, so a migration merged since is applied and unrecorded — and the');
        console.log('      other session applies migrations by hand, which never writes a row.');
        console.log('');
        console.log('      Once you have checked the schema and it IS applied, say so:');
        console.log('        node scripts/migrate.mjs --target ' + targetName + ' \\');
        console.log('          supabase/migrations/<file> --record --note "what you checked"');
        console.log('');
        console.log('      That records it as an assumption, not an observation. It is worth');
        console.log('      doing rather than ignoring: a warning that is wrong every time is a');
        console.log('      warning people stop reading, and then the real one goes past.');
    }

    if (edited.length) {
        console.log('\n  EDITED SINCE IT RAN (' + edited.length + ')');
        console.log('      The file no longer matches what was applied. The schema here is');
        console.log('      NOT what these files describe, and reading them will not show it.');
        edited.forEach((e) => console.log('      ' + e.name
            + '\n          applied: ' + e.was.slice(0, 16)
            + '\n          file now: ' + e.is.slice(0, 16)));
    }

    if (orphaned.length) {
        console.log('\n  IN THE LEDGER, NOT IN THE FOLDER (' + orphaned.length + ')');
        console.log('      Renamed or deleted after it ran. Harmless if deliberate.');
        orphaned.forEach((n) => console.log('      ' + n));
    }

    if (assumedFailing.length) {
        console.log('\n  ASSUMED — VERIFICATION NOW FAILS (' + assumedFailing.length + ')');
        console.log('      Recorded as applied, with a check that PROVED it at the time — and');
        console.log('      that check does NOT pass now. The schema has drifted away from what');
        console.log('      was recorded, or the change was never really there. This is the');
        console.log('      thing the ledger exists to catch. Do not trust these as applied.');
        assumedFailing.forEach((a) => {
            console.log('      ' + a.name);
            console.log('          check: ' + a.vsql);
            if (a.error) console.log('          errored: ' + a.error);
        });
    }

    if (assumedVerified.length) {
        console.log('\n  ASSUMED, RE-VERIFIED NOW (' + assumedVerified.length + ')');
        console.log('      Backfilled, no checksum — but each carries a --check that still');
        console.log('      passes, so the change IS present. Trustworthy as far as the check goes.');
        assumedVerified.forEach((a) => console.log('      ' + a.name));
    }

    if (assumedLegacy.length) {
        console.log('\n  ASSUMED, NOT OBSERVED (' + assumedLegacy.length + ')');
        console.log('      Backfilled with no check and no checksum. Nobody watched these run');
        console.log('      and an edit to any of them cannot be detected. They are here because');
        console.log('      the schema said so once, not because the runner saw it. Re-record any');
        console.log('      that matter with --check to bring them under continuous verification.');
        const note = assumedLegacy.map((n) => known.get(n).note).find(Boolean);
        if (note) console.log('      Basis (example): ' + note);
    }

    console.log('\n  OBSERVED — applied by this runner, checksum matches (' + observed + ')');

    console.log('\n' + rule);
    if (!outstanding.length && !edited.length && !assumedFailing.length) {
        console.log('  Nothing outstanding, nothing edited, no verification failing.'
            + (assumed.length ? ' ' + assumed.length + ' of the ' + onDisk.length
                + ' are assumptions (' + assumedVerified.length + ' re-verified, '
                + assumedLegacy.length + ' legacy), above.' : ''));
    } else {
        console.log('  ' + outstanding.length + ' outstanding, ' + edited.length + ' edited, '
            + assumedFailing.length + ' with a failing verification.');
    }
    console.log('');

    process.exit(outstanding.length || edited.length || assumedFailing.length ? 1 : 0);
}

if (readOnlyQuery) {
    try {
        const rows = await readQuery(inlineSql);
        console.log(JSON.stringify(rows, null, 2));
        console.log('');
        await finish(0);
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
