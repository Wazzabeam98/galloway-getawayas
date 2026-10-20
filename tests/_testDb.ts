// The one place the schema guards find the TEST database and read grants off it.
//
// WHY THIS EXISTS. Every DB half of the schema guards used to read
// SUPABASE_TEST_DB_URL out of .env.local and nothing else. CI has no .env.local,
// so in the required check each of those halves skipped — green, and checking
// nothing. That is how #426's logged-out 404 (a listings column granted to
// `authenticated` but not `anon`) got past a green check. The URL is now taken
// from the environment first, which is where checks.yml puts the repo secret,
// and .env.local second for local runs and the pre-push hook.
//
// WHY THE CATALOG AND NOT information_schema. CI connects as `ci_schema_reader`,
// a TEST-only login that can read the catalog and nothing else: no table data,
// no membership of anon/authenticated, read-only transactions. The
// information_schema privilege views only show grants the CURRENT role is party
// to, so for that login they come back empty and every guard would pass while
// seeing nothing. pg_attribute/pg_class are readable by any role, and
// has_column_privilege('anon', …) answers "can anon read this" for whoever asks
// — the same question PostgREST effectively puts when a logged-out page selects.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// The TEST project's ref. A URL for any other project is refused loudly rather
// than used: these guards must never be pointed at production by a mis-pasted
// secret (the listings guard has always checked this; now they all do).
const TEST_PROJECT_REF = 'yefoqcabuijcowoqewtc';

export function testDbUrl(): string | null {
    let value = (process.env.SUPABASE_TEST_DB_URL || '').trim();
    if (!value) {
        try {
            const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
                .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
            value = line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : '';
        } catch { value = ''; }
    }
    if (!value) return null;
    if (!value.includes(TEST_PROJECT_REF)) {
        throw new Error('SUPABASE_TEST_DB_URL does not point at the TEST project (' + TEST_PROJECT_REF + ') — refusing to run schema guards against it');
    }
    return value;
}

export async function withTestDb<T>(url: string, fn: (client: any) => Promise<T>): Promise<T> {
    const pg = require('pg');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}

/** Every live column of public.<table>, or [] if the table is not on TEST yet. */
export async function liveColumns(client: any, table: string): Promise<string[]> {
    const rows = (await client.query(
        `select a.attname as col from pg_attribute a
          where a.attrelid = to_regclass('public.' || quote_ident($1))
            and a.attnum > 0 and not a.attisdropped
          order by a.attnum`,
        [table],
    )).rows;
    return rows.map((r: any) => String(r.col));
}

/** The columns of public.<table> that <role> holds <privilege> on, table-level grants included. */
export async function columnsGrantedTo(client: any, table: string, role: string, privilege: string): Promise<Set<string>> {
    const rows = (await client.query(
        `select a.attname as col from pg_attribute a
          where a.attrelid = to_regclass('public.' || quote_ident($1))
            and a.attnum > 0 and not a.attisdropped
            and has_column_privilege($2, a.attrelid, a.attnum, $3)`,
        [table, role, privilege],
    )).rows;
    return new Set(rows.map((r: any) => String(r.col)));
}

/** Direct table-level grants on public.<table> to any of <roles> ('PUBLIC' for the public pseudo-role). */
export async function tableGrantsTo(client: any, table: string, roles: string[]): Promise<{ grantee: string; privilege_type: string }[]> {
    return (await client.query(
        `select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
                x.privilege_type
           from pg_class c, aclexplode(c.relacl) x
          where c.oid = to_regclass('public.' || quote_ident($1))
            and (case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end) = any($2)`,
        [table, roles],
    )).rows;
}
