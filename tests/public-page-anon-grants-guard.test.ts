// A column a PUBLIC page reads must be granted SELECT to the `anon` Postgres
// role — or the whole read is refused for a logged-out visitor and the page
// 404s.
//
// THE BUG THIS CATCHES. On 19 October 2026 a migration added
// listings.cancellation_custom_days and granted it to `authenticated` only. The
// public listing page (app/homes/[id]) selects it with the anon Supabase client
// for a logged-out visitor, so PostgREST refused the entire row and every
// listing page 404'd for signed-out users — past a green build and green tests.
// This guard reproduces that class: it reads the column lists the public pages
// actually select from `listings` and fails, by name, on any column that is not
// granted to `anon` on the live schema.
//
// WHY ONLY `listings`. The public experience/marketplace pages read through the
// SERVICE ROLE (adminClient), which is not subject to anon column grants, so
// there is nothing to assert there. The only logged-out reads that run as `anon`
// are the three listings selects below (see the research in the PR). A NEW anon
// read on another table should be registered in SOURCES so it is covered too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// The anon-client reads on `listings`, each as a (file, how-to-find-the-column-
// list) pair. These ARE the decision, in writing — when a page's select grows a
// column, the DB half below catches it if anon cannot read it.
const SOURCES: { file: string; label: string; pattern: RegExp }[] = [
    {
        file: 'app/homes/[id]/page.tsx',
        label: 'LISTING_PAGE_COLUMNS (the listing page)',
        pattern: /const LISTING_PAGE_COLUMNS = '([^']*)'/,
    },
    {
        file: 'app/homes/[id]/page.tsx',
        label: 'the listing page generateMetadata select',
        pattern: /\.select\(\s*'(title, description, location, images[^']*)'\s*\)/,
    },
    {
        file: 'app/page.tsx',
        label: 'the homepage listings select',
        pattern: /\.from\('listings'\)\s*\.select\(\s*'([^']*)'\s*\)/,
    },
    {
        file: 'app/holiday-cottages/[area]/page.tsx',
        label: 'the cottage-browse (area) listings select',
        pattern: /\.from\('listings'\)\s*\.select\(\s*'([^']*)'\s*\)/,
    },
];

// A PostgREST column list → bare column names. Drops anything that is not a
// plain column (an embedded resource like `host:profiles(...)` or an alias),
// since those are not what a column grant governs.
function columnsOf(list: string): string[] {
    return list
        .split(',')
        .map((c) => c.trim().replace(/^["'`]|["'`]$/g, ''))
        .filter((c) => c && !c.includes('(') && !c.includes(':') && !c.includes(' '));
}

function extract(source: { file: string; label: string; pattern: RegExp }): string[] {
    const src = fs.readFileSync(path.join(ROOT, source.file), 'utf8');
    const m = src.match(source.pattern);
    if (!m) return [];
    return columnsOf(m[1]);
}

// STATIC HALF — runs everywhere, including CI and the web-editor paste path.
// Each public select must still be found and parse to real columns. If a page is
// refactored so a pattern stops matching, this fails rather than letting the
// guard go quietly blind.
for (const source of SOURCES) {
    test(`public select is still readable by the guard: ${source.label}`, () => {
        const cols = extract(source);
        assert.ok(
            cols.length > 0,
            `could not find/parse the column list for "${source.label}" in ${source.file}.\n`
            + `  The guard reads it to check anon can read every column. If the select was renamed or\n`
            + `  reshaped, update SOURCES in this test so the check keeps covering it.`,
        );
    });
}

// DB HALF — only where a TEST Supabase is configured (pre-push, local,
// CI-against-test). Skips when SUPABASE_TEST_DB_URL is unset, like the other
// schema guards.
function testDbUrl(): string | null {
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

async function anonSelectableColumns(url: string, table: string): Promise<Set<string>> {
    const pg = require('pg');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        const rows = (await client.query(
            "select column_name from information_schema.column_privileges "
            + "where table_name=$1 and grantee='anon' and privilege_type='SELECT'",
            [table],
        )).rows;
        return new Set(rows.map((r: any) => r.column_name));
    } finally {
        await client.end();
    }
}

test('every column a public page selects from listings is granted to anon',
    { skip: testDbUrl() ? false : 'no TEST db configured — static checks still run' },
    async () => {
        const url = testDbUrl()!;
        const anonGranted = await anonSelectableColumns(url, 'listings');

        // Union of every public listings select, with where each column came from
        // so a failure names the page to fix.
        const wanted = new Map<string, string>();
        for (const source of SOURCES) {
            for (const col of extract(source)) {
                if (!wanted.has(col)) wanted.set(col, source.label);
            }
        }

        const missing = [...wanted.entries()].filter(([col]) => !anonGranted.has(col));
        assert.deepEqual(
            missing.map(([col, where]) => `${col}  (selected by ${where})`),
            [],
            'These listings columns are read by a PUBLIC page as the anon role but are NOT granted\n'
            + 'SELECT to anon — a logged-out visitor\'s read is refused and the page 404s. Grant each to\n'
            + 'anon in a migration (grant select (<col>) on public.listings to anon; notify pgrst, \'reload schema\';):\n  '
            + missing.map(([col, where]) => `${col}  (selected by ${where})`).join('\n  '),
        );
    });
