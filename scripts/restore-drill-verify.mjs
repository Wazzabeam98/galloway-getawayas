// Verify a restored copy against its source, table by table.
//
// Used in two places with the same code, on purpose: the quarterly restore-drill
// GitHub Action runs it against a freshly restored throwaway, and a human can run
// it locally against a Docker restore to reproduce a failure. If the two ever
// disagreed the drill would prove nothing, so there is one script.
//
//   SOURCE_DB_URL=... TARGET_DB_URL=... node scripts/restore-drill-verify.mjs
//
// It writes restore-drill-result.json (the record the Action files and emails)
// and exits 0 on a clean match, 1 on any mismatch — so a red step in CI is a
// failed drill and nothing has to read the log to know it.
//
// What it checks:
//   * every table that exists in the SOURCE is present in the target, and its
//     row count matches exactly; and
//   * the listings content hash (id + title + location over every row) matches
//     end to end — a count can match while the bytes rotted, this catches that.
//
// It talks to Postgres through `psql`, not a driver, so it needs no dependency
// the Action would have to install beyond the client it already uses to dump and
// restore. Connection URLs carry a password; they are passed as arguments to
// psql and never printed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SOURCE = process.env.SOURCE_DB_URL;
const TARGET = process.env.TARGET_DB_URL;
const TRIGGER = process.env.DRILL_TRIGGER || 'manual';

function die(msg) {
    const result = {
        status: 'fail',
        trigger: TRIGGER,
        runAt: new Date().toISOString(),
        detail: msg,
        mismatches: [],
        tablesChecked: 0,
        listingsHashMatch: null,
        pgVersions: null,
    };
    fs.writeFileSync('restore-drill-result.json', JSON.stringify(result, null, 2));
    console.error('DRILL FAIL:', msg);
    process.exit(1);
}

if (!SOURCE || !TARGET) die('SOURCE_DB_URL and TARGET_DB_URL must both be set');

// One field-separated, tuples-only query. ON_ERROR_STOP so a bad query is a
// thrown error here, not an empty string that reads as "no rows".
function q(url, sql) {
    return execFileSync('psql', [url, '-tAF', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
}

// The tables to compare: everything in the application schemas. Read from each
// side independently so a table the restore failed to create shows up as missing
// rather than silently dropping out of the comparison.
const LIST_SQL =
    "select table_schema, table_name from information_schema.tables " +
    "where table_schema in ('public','storage') and table_type = 'BASE TABLE' " +
    "order by 1, 2";

function tableList(url) {
    return q(url, LIST_SQL)
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [schema, name] = line.split('');
            return { schema, name, key: `${schema}.${name}` };
        });
}

// One round trip for all counts: a union of count(*) per table, keyed by name.
function countMap(url, tables) {
    if (tables.length === 0) return {};
    const union = tables
        .map((t) => `select '${t.key}' as k, count(*) as c from "${t.schema}"."${t.name}"`)
        .join(' union all ');
    const out = {};
    for (const line of q(url, union).split('\n').filter(Boolean)) {
        const [k, c] = line.split('');
        out[k] = Number(c);
    }
    return out;
}

function serverVersion(url) {
    return q(url, 'show server_version').trim().split(/\s+/)[0];
}

// Content, not just counts: hash id + title + location over every listing in a
// stable order. A drift that leaves the row count intact but corrupts a value
// changes this hash.
const LISTINGS_HASH_SQL =
    "select md5(coalesce(string_agg(id::text || coalesce(title,'') || coalesce(location,''), ',' " +
    "order by id), '')) from public.listings";

let result;
try {
    const sourceTables = tableList(SOURCE);
    const targetTables = tableList(TARGET);
    const targetKeys = new Set(targetTables.map((t) => t.key));

    const sourceCounts = countMap(SOURCE, sourceTables);
    const targetCounts = countMap(TARGET, targetTables);

    const mismatches = [];
    for (const t of sourceTables) {
        if (!targetKeys.has(t.key)) {
            mismatches.push({ table: t.key, source: sourceCounts[t.key] ?? null, target: 'MISSING' });
            continue;
        }
        if (sourceCounts[t.key] !== targetCounts[t.key]) {
            mismatches.push({ table: t.key, source: sourceCounts[t.key], target: targetCounts[t.key] });
        }
    }

    const sourceHash = q(SOURCE, LISTINGS_HASH_SQL).trim();
    const targetHash = q(TARGET, LISTINGS_HASH_SQL).trim();
    const listingsHashMatch = sourceHash === targetHash;

    const pass = mismatches.length === 0 && listingsHashMatch;

    result = {
        status: pass ? 'pass' : 'fail',
        trigger: TRIGGER,
        runAt: new Date().toISOString(),
        tablesChecked: sourceTables.length,
        mismatches,
        listingsHashMatch,
        pgVersions: `source ${serverVersion(SOURCE)} / target ${serverVersion(TARGET)}`,
        detail: pass
            ? `All ${sourceTables.length} tables matched row-for-row and the listings content hash matched.`
            : `${mismatches.length} table mismatch(es)` +
              (listingsHashMatch ? '' : '; listings content hash DID NOT match') + '.',
    };
} catch (e) {
    die(`verification could not complete: ${e?.message || String(e)}`);
}

fs.writeFileSync('restore-drill-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'pass' ? 0 : 1);
