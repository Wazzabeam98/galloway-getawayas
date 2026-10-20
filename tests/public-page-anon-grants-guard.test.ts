// A column a PUBLIC page reads must be granted SELECT to the `anon` Postgres
// role — or the whole read is refused for a logged-out visitor and the page
// 404s.
//
// THE BUG THIS CATCHES. On 19 October 2026 a migration added
// listings.cancellation_custom_days and granted it to `authenticated` only. The
// public listing page (app/homes/[id]) selects it with the anon Supabase client
// for a logged-out visitor, so PostgREST refused the entire row and every
// listing page 404'd for signed-out users — past a green build and green tests
// (#426). The DB half of this guard skipped in CI then; it runs there now, off
// the SUPABASE_TEST_DB_URL repo secret (tests/_testDb.ts).
//
// WHAT IT COVERS.
//   SOURCES      every anon-client select a logged-out visitor triggers, by
//                table. Embedded resources inside a select — host:profiles(...),
//                profiles!inner(...) — are parsed out and checked against THEIR
//                table's anon grants, because PostgREST refuses the whole read
//                when an embedded column is not readable either.
//   PROFILES     every read of `profiles` through a browser-role client (anything
//                not the service role), and every embed of profiles anywhere, must
//                carry a written decision: registered in SOURCES (logged-out, so
//                checked against anon) or in SIGNED_IN_PROFILE_READS with the
//                reason it only ever runs as `authenticated` (whose grants
//                select-grant-decision-guard checks). A new one fails by file
//                until somebody decides — profiles is the table where a wrong
//                grant either 404s a public page or leaks a surname
//                (profiles-anon-name-privacy-guard).
//
// WHY THE PUBLIC EXPERIENCE PAGES ARE NOT HERE. They read through the SERVICE
// ROLE (adminClient), which is not subject to anon column grants, so there is
// nothing to assert. A NEW anon read on any table belongs in SOURCES.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDbUrl, withTestDb, liveColumns, columnsGrantedTo } from './_testDb';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// The anon-client reads, each as (file, base table, how-to-find-the-column-list).
// These ARE the decision, in writing — when a page's select grows a column (or
// an embed), the DB half below catches it if anon cannot read it.
type Source = { file: string; table: string; label: string; pattern: RegExp };
const SOURCES: Source[] = [
    {
        file: 'app/homes/[id]/page.tsx',
        table: 'listings',
        label: 'LISTING_PAGE_COLUMNS (the listing page)',
        pattern: /const LISTING_PAGE_COLUMNS = '([^']*)'/,
    },
    {
        file: 'app/homes/[id]/page.tsx',
        table: 'listings',
        label: 'the listing page generateMetadata select',
        pattern: /\.select\(\s*'(title, description, location, images[^']*)'\s*\)/,
    },
    {
        file: 'app/page.tsx',
        table: 'listings',
        label: 'the homepage listings select',
        pattern: /\.from\('listings'\)\s*\.select\(\s*'([^']*)'\s*\)/,
    },
    {
        file: 'app/holiday-cottages/[area]/page.tsx',
        table: 'listings',
        label: 'the cottage-browse (area) listings select',
        pattern: /\.from\('listings'\)\s*\.select\(\s*'([^']*)'\s*\)/,
    },
];

// Files that read `profiles` through a browser-role client, and why that read
// only ever runs signed in (so `anon` grants do not apply). Checked as a set:
// a file that starts reading profiles this way fails until it is added here
// or to SOURCES; a file that stops is dropped from here by the same test.
const SIGNED_IN_PROFILE_READS: Record<string, string> = {
    'app/account/page.tsx': 'the account page — redirects to sign-in without a session',
    'app/dashboard/calendar/page.tsx': 'host dashboard — signed-in host only',
    'app/dashboard/reviews/page.tsx': 'host dashboard — signed-in host only',
    'app/edit-listing/[id]/page.tsx': 'listing editor — signed-in host/co-host only',
    'app/review/[bookingId]/page.tsx': 'review a stay — reads the booking first, which needs the signed-in guest',
    'components/BookingActions.tsx': 'booking actions on a signed-in trip/dashboard page',
    'components/account/PhoneRow.tsx': 'account settings row — signed in',
    'components/auth/AuthPanel.tsx': 'runs after the sign-in succeeds, for the session user\'s own row',
    'components/auth/EmailFirstStep.tsx': 'runs after the sign-in succeeds, for the session user\'s own row',
    'components/auth/FinishSignUpGate.tsx': 'the session user\'s own row — renders only with a session',
    'components/base/Navbar.tsx': 'guarded by data.session.user — logged-out visitors never reach the read',
    'components/services/ProviderSignUp.tsx': 'provider sign-up after the account step — signed in',
    'lib/access.ts': 'requireAdmin and friends — getUser() first, notFound() without one',
};

// Clients that are the service role. Anything else calling .from('profiles') is
// a browser-role read (anon or authenticated) and needs a decision above.
const SERVICE_ROLE_CLIENTS = new Set(['admin', 'adminClient()', 'serviceClient', 'supabaseAdmin']);

// ---- parsing a PostgREST select list ------------------------------------------

// Split on top-level commas only — a comma inside host:profiles(a, b) is not a
// separator for the outer list.
function splitTopLevel(list: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of list) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
}

// A select list → { table: columns } for the base table and every embedded
// resource in it, recursively. `alias:col` reads col; `col::text` reads col;
// `data->>key` reads data. An embed is `[alias:]table[!hint](...)`, with an
// optional `...` spread in front.
export function readsOf(list: string, baseTable: string, into: Map<string, Set<string>> = new Map()): Map<string, Set<string>> {
    if (!into.has(baseTable)) into.set(baseTable, new Set());
    for (const raw of splitTopLevel(list)) {
        const item = raw.replace(/^\.\.\./, '').replace(/^["'`]|["'`]$/g, '');
        const open = item.indexOf('(');
        if (open !== -1 && item.endsWith(')')) {
            const head = item.slice(0, open).trim();
            const resource = (head.includes(':') ? head.slice(head.indexOf(':') + 1) : head).split('!')[0].trim();
            readsOf(item.slice(open + 1, -1), resource, into);
            continue;
        }
        let col = item.includes(':') && !item.includes('::') ? item.slice(item.indexOf(':') + 1) : item;
        col = col.split('::')[0].split('->')[0].trim();
        if (col) into.get(baseTable)!.add(col);
    }
    return into;
}

function extract(source: Source): string | null {
    const src = fs.readFileSync(path.join(ROOT, source.file), 'utf8');
    const m = src.match(source.pattern);
    return m ? m[1] : null;
}

// ---- STATIC HALF — runs everywhere, including CI and the web-editor paste path.

test('the select parser reads embedded resources against their own table', () => {
    const reads = readsOf('id, title, host:profiles!listings_host_id_fkey(first_name, avatar_url), cohort:listing_access(user_id, who:profiles(first_name)), price::text', 'listings');
    assert.deepEqual([...reads.get('listings')!].sort(), ['id', 'price', 'title']);
    assert.deepEqual([...reads.get('profiles')!].sort(), ['avatar_url', 'first_name']);
    assert.deepEqual([...reads.get('listing_access')!], ['user_id']);
});

// Each public select must still be found and parse to real columns. If a page is
// refactored so a pattern stops matching, this fails rather than letting the
// guard go quietly blind.
for (const source of SOURCES) {
    test(`public select is still readable by the guard: ${source.label}`, () => {
        const list = extract(source);
        const cols = list ? readsOf(list, source.table).get(source.table)! : new Set();
        assert.ok(
            cols.size > 0,
            `could not find/parse the column list for "${source.label}" in ${source.file}.\n`
            + `  The guard reads it to check anon can read every column. If the select was renamed or\n`
            + `  reshaped, update SOURCES in this test so the check keeps covering it.`,
        );
        assert.ok(!cols.has('*'), `"${source.label}" selects * — anon holds no table-level grant, so name the columns`);
    });
}

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir + '/' + e.name;
        if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel, out); }
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
    return out;
}

// Admin screens and admin API routes are signed-in admins by construction.
const SCANNED = ['app', 'components', 'lib'].flatMap((d) => walk(d))
    .filter((f) => !f.startsWith('app/admin/') && !f.startsWith('app/api/admin/'));

test('every browser-role read of profiles has a written anon/signed-in decision', () => {
    const registered = new Set(SOURCES.map((s) => s.file));
    const reading = new Set<string>();
    for (const file of SCANNED) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const re = /([A-Za-z_$][\w$]*(?:\(\))?)\s*\.from\(\s*['"]profiles['"]\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
            if (!SERVICE_ROLE_CLIENTS.has(m[1])) reading.add(file);
        }
    }
    const undecided = [...reading].filter((f) => !(f in SIGNED_IN_PROFILE_READS) && !registered.has(f)).sort();
    assert.deepEqual(undecided, [],
        'These files read profiles through a browser-role client with no written decision. If a\n'
        + 'logged-out visitor can reach the read, add it to SOURCES (its columns are then checked against\n'
        + 'the live anon grants); if it only runs signed in, add it to SIGNED_IN_PROFILE_READS with why:\n  '
        + undecided.join('\n  '));
    const stale = Object.keys(SIGNED_IN_PROFILE_READS).filter((f) => !reading.has(f)).sort();
    assert.deepEqual(stale, [], 'These SIGNED_IN_PROFILE_READS entries no longer read profiles — remove them:\n  ' + stale.join('\n  '));
});

test('every embedded profiles(...) select is registered', () => {
    const registered = new Set(SOURCES.map((s) => s.file));
    const embedding: string[] = [];
    for (const file of SCANNED) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        // Inside a quoted select list: `host:profiles(`, `profiles!fk(`, `profiles(`.
        if (/['"`][^'"`\n]*\bprofiles\s*(!\w+\s*)?\(/.test(src) && !registered.has(file) && !(file in SIGNED_IN_PROFILE_READS)) {
            embedding.push(file);
        }
    }
    assert.deepEqual(embedding.sort(), [],
        'These files embed profiles inside a select. An embedded column anon cannot read refuses the WHOLE\n'
        + 'row for a logged-out visitor. Register the select in SOURCES (checked against anon), or in\n'
        + 'SIGNED_IN_PROFILE_READS with why it only runs signed in:\n  ' + embedding.join('\n  '));
});

// ---- DB HALF — wherever a TEST Supabase is configured (the CI repo secret, or
// .env.local locally and on pre-push).
const url = testDbUrl();

test('every column a public page selects — embeds included — is granted to anon',
    { skip: url ? false : 'no TEST db configured — static checks still run' },
    async () => {
        // Union of every public read, per table, with where each column came from
        // so a failure names the page to fix.
        const wanted = new Map<string, Map<string, string>>();
        for (const source of SOURCES) {
            const list = extract(source);
            if (!list) continue;
            for (const [table, cols] of readsOf(list, source.table)) {
                if (!wanted.has(table)) wanted.set(table, new Map());
                for (const col of cols) if (!wanted.get(table)!.has(col)) wanted.get(table)!.set(col, source.label);
            }
        }

        const problems = await withTestDb(url!, async (client) => {
            const out: string[] = [];
            for (const [table, cols] of wanted) {
                const live = await liveColumns(client, table);
                if (live.length === 0) {
                    out.push(`${table}: not a table on TEST — an embed must name the table (host:profiles(...)), not an FK column`);
                    continue;
                }
                const anon = await columnsGrantedTo(client, table, 'anon', 'SELECT');
                for (const [col, where] of cols) {
                    if (!anon.has(col)) out.push(`${table}.${col}  (selected by ${where})`);
                }
            }
            return out;
        });

        assert.deepEqual(
            problems,
            [],
            'These columns are read by a PUBLIC page as the anon role but are NOT granted SELECT to\n'
            + 'anon — a logged-out visitor\'s read is refused and the page 404s. Grant each to anon in a\n'
            + 'migration (grant select (<col>) on public.<table> to anon; notify pgrst, \'reload schema\';),\n'
            + 'unless it is a name column profiles-anon-name-privacy-guard forbids — then read it server-side:\n  '
            + problems.join('\n  '),
        );
    });
