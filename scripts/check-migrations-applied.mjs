// The deploy-time migration gate.
//
// WHAT IT IS FOR
//
// The rule is "a migration reaches production before the code that needs it".
// Nothing enforced it: CI holds no database credentials on purpose, and the
// pre-push hook checks TEST and is skipped entirely by the GitHub web-editor
// path. So a branch carrying a migration could reach production with the code
// ahead of the schema — the insert is refused, the browser reports success,
// and the row simply is not there. It happened three times in a week.
//
// Vercel is the one gate that sits across BOTH routes to production — a local
// push and a web edit both end in a Vercel production build. This runs as the
// first step of `npm run build`. On a Vercel PRODUCTION build it refuses to
// build code whose migrations have not reached production. Everywhere else —
// preview, CI, local — it exits 0 and gets out of the way.
//
// FAIL OPEN, ALWAYS. The ONLY non-zero exit is "a migration is provably
// outstanding on production". Every other path — not a production deploy, not
// configured, cannot reach the database, an unexpected error — exits 0. A gate
// that blocks because it is itself broken is worse than no gate, and it would
// block exactly the unrelated 11pm hotfix it was never meant to touch.
//
// THE 11pm ESCAPE HATCH. `[skip-migration-gate]` in the commit message ships
// the deploy anyway, warning loudly. That is the deliberate override — the code
// goes out ahead of its schema, so use it only when that schema is behind a
// flag or you are about to apply it. Mirrors the admin-merge philosophy in
// CLAUDE.md: being able to ship at 11pm is worth more than a gate people route
// around.
//
// WHAT IT NEEDS: MIGRATION_STATUS_DB_URL in Vercel's Production environment —
// the connection string of the read-only `migration_gate` role, which can read
// public.schema_migrations and nothing else. See MAINTENANCE.md.

import fs from 'node:fs';
import path from 'node:path';

const OK = 0;
const BLOCK = 1;

function pass(message) {
    if (message) console.log('[migration-gate] ' + message);
    process.exit(OK);
}

async function main() {
    // Production deploys only. A preview build reads the test database, which
    // the migration runner keeps current, so there is nothing to gate there.
    if (process.env.VERCEL_ENV !== 'production') {
        pass(process.env.VERCEL ? 'skipped — not a production deploy' : undefined);
        return;
    }

    // The deliberate override.
    const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';
    if (commitMessage.includes('[skip-migration-gate]')) {
        console.warn('[migration-gate] OVERRIDDEN by [skip-migration-gate] — shipping code that may be ahead of its schema.');
        pass(undefined);
        return;
    }

    // Not configured yet → inert. This lets the PR that introduces the gate
    // merge and deploy before the env var exists, and means removing the env
    // var disables the gate rather than wedging every deploy.
    const dbUrl = process.env.MIGRATION_STATUS_DB_URL;
    if (!dbUrl) {
        pass('skipped — MIGRATION_STATUS_DB_URL is not set, so the gate is inactive');
        return;
    }

    // The migration files the repo carries.
    let files;
    try {
        const dir = path.join(process.cwd(), 'supabase', 'migrations');
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    } catch (err) {
        pass('skipped — could not read supabase/migrations (' + (err && err.message) + ')');
        return;
    }
    if (!files.length) {
        pass('no migration files to check');
        return;
    }

    // What production has actually applied. Bounded timeouts, and any failure
    // fails open — a database we cannot reach must not block a deploy.
    let applied;
    try {
        const pg = (await import('pg')).default;
        const client = new pg.Client({
            connectionString: dbUrl,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 8000,
            query_timeout: 8000,
            statement_timeout: 8000,
        });
        await client.connect();
        const result = await client.query('select filename from public.schema_migrations');
        await client.end();
        applied = new Set(result.rows.map((r) => r.filename));
    } catch (err) {
        pass('skipped — could not read the production ledger (' + (err && err.message) + '), failing open');
        return;
    }

    const outstanding = files.filter((f) => !applied.has(f)).sort();
    if (outstanding.length === 0) {
        pass('production is up to date — ' + files.length + ' migrations all applied');
        return;
    }

    // The one place this blocks.
    console.error('');
    console.error('[migration-gate] BLOCKED: this deploy carries migrations that production has not applied:');
    console.error('');
    outstanding.forEach((f) => console.error('    ' + f));
    console.error('');
    console.error('Apply them to production BEFORE this code ships — the rule is migration-first:');
    console.error('');
    outstanding.forEach((f) => console.error('    node scripts/migrate.mjs --target prod --apply supabase/migrations/' + f));
    console.error('');
    console.error('Then redeploy. If this migration is unrelated to your change and you must ship now,');
    console.error('add [skip-migration-gate] to your commit message. That ships the code ahead of its');
    console.error('schema, so only do it when the schema is behind a flag or you are about to apply it.');
    console.error('');
    process.exit(BLOCK);
}

main().catch((err) => {
    // Nothing above should throw past its own catch, but if it does: fail open.
    console.warn('[migration-gate] unexpected error, failing open: ' + (err && err.message));
    process.exit(OK);
});
