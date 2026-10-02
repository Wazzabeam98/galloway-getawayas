// The shared test database and the schema-drift guards are coupled: the guards
// read the LIVE test DB and check it against master's registry (the two guard
// tests). So the moment a migration adds a column to a guarded table
// (service_providers / profiles) and it's applied to the shared test DB, that
// column MUST be classified in the registry on master — or master and every
// branch cut from it go red on a column that isn't theirs.
//
// This module is what makes that hold rather than depend on someone remembering
// a second step: migrate.mjs uses detectGuardedColumns() to notice the case, and
// writeRegistryStub() to write the classification into the two guard tests for
// you (you supply granted-vs-revoked and the reason). See scripts/README.md.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELECT_GUARD = path.join(ROOT, 'tests', 'select-grant-decision-guard.test.ts');
const WRITE_GUARD = path.join(ROOT, 'tests', 'provider-writable-columns-guard.test.ts');

// The select-grant guard covers both tables; the write-grant guard covers only
// service_providers (profiles has no owner-writable allow-list of this shape).
const SELECT_TABLES = ['service_providers', 'profiles'];
const WRITE_TABLE = 'service_providers';

// Every new column an ALTER adds to a guarded table, and whether THIS migration
// also grants it to `authenticated` (SELECT ⇒ the read is intended GRANTED;
// INSERT/UPDATE ⇒ the write is intended PROVIDER_WRITABLE). A migration that
// grants nothing means the safe default: REVOKED / PLATFORM_ONLY.
function detectGuardedColumns(sql) {
    if (!sql) return [];
    const found = [];
    const alterRe = /alter\s+table\s+(?:only\s+)?"?public"?\s*\.\s*"?(service_providers|profiles)"?([\s\S]*?);/gi;
    let m;
    while ((m = alterRe.exec(sql)) !== null) {
        const table = m[1];
        const colRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
        let c;
        while ((c = colRe.exec(m[2])) !== null) found.push({ table, column: c[1] });
    }
    // Grants in the same migration: grant <privs> (col, col) on ... <table> to authenticated
    const sel = new Set(), wr = new Set();
    const grantRe = /grant\s+([a-z,\s]+?)\s*\(([^)]*)\)\s+on\s+(?:table\s+)?"?public"?\s*\.\s*"?(service_providers|profiles)"?\s+to\s+"?authenticated"?/gi;
    let g;
    while ((g = grantRe.exec(sql)) !== null) {
        const privs = g[1].toLowerCase();
        const cols = g[2].split(',').map((s) => s.replace(/["'\s]/g, '')).filter(Boolean);
        for (const col of cols) {
            const key = g[3] + '.' + col;
            if (/\bselect\b/.test(privs)) sel.add(key);
            if (/\binsert\b/.test(privs) || /\bupdate\b/.test(privs)) wr.add(key);
        }
    }
    const seen = new Set();
    return found
        .filter((o) => { const k = o.table + '.' + o.column; if (seen.has(k)) return false; seen.add(k); return true; })
        .map((o) => ({
            ...o,
            selectGranted: sel.has(o.table + '.' + o.column),
            writeGranted: wr.has(o.table + '.' + o.column),
        }));
}

// The slice of the select guard for one table (from `table: 'x'` to the next).
function selectTableBlock(src, table) {
    const start = src.indexOf(`table: '${table}'`);
    if (start < 0) return { start: -1, end: -1, text: '' };
    let end = src.indexOf('table:', start + 1);
    if (end < 0) end = src.length;
    return { start, end, text: src.slice(start, end) };
}

function isSelectClassified(src, table, column) {
    const b = selectTableBlock(src, table).text;
    return new RegExp(`'${column}'`).test(b) || new RegExp(`(^|\\s)${column}:`).test(b);
}
function isWriteClassified(src, column) {
    const writable = src.slice(src.indexOf('PROVIDER_WRITABLE'), src.indexOf('PLATFORM_ONLY'));
    const platform = src.slice(src.indexOf('const PLATFORM_ONLY'));
    return new RegExp(`'${column}'`).test(writable) || new RegExp(`(^|\\s)${column}:`).test(platform);
}

// Which detected columns are NOT yet classified in the committed guards.
function unclassified(sql) {
    const selSrc = fs.readFileSync(SELECT_GUARD, 'utf8');
    const wrSrc = fs.readFileSync(WRITE_GUARD, 'utf8');
    return detectGuardedColumns(sql).filter((c) => {
        const needsSelect = SELECT_TABLES.includes(c.table) && !isSelectClassified(selSrc, c.table, c.column);
        const needsWrite = c.table === WRITE_TABLE && !isWriteClassified(wrSrc, c.column);
        return needsSelect || needsWrite;
    });
}

// Insert a member into a Set literal / a key into an object literal, right after
// its opening `anchor`, matching the indentation of the existing first member.
function insertAfterAnchor(src, anchorIndex, line) {
    const nl = src.indexOf('\n', anchorIndex);
    // indentation of the following line (the set/object's existing first entry)
    const after = src.slice(nl + 1);
    const indent = (after.match(/^(\s*)/) || ['', '            '])[1] || '            ';
    return src.slice(0, nl + 1) + indent + line + '\n' + src.slice(nl + 1);
}

// Write the classification for ONE column into both guards as needed. `select`
// is 'granted' | 'revoked'; `write` is 'writable' | 'platform' (service_providers
// only). A revoked / platform-only entry requires a reason (the guard fails on a
// blank one, and the reason is the privacy decision in writing).
function writeRegistryStub({ table, column, select, write, reason }) {
    if ((select === 'revoked' || write === 'platform') && !(reason && reason.trim())) {
        throw new Error('a revoked / platform-only column needs a --reason (it is the decision, in writing).');
    }
    const esc = (reason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const changed = [];

    // --- select guard ---
    if (SELECT_TABLES.includes(table)) {
        let s = fs.readFileSync(SELECT_GUARD, 'utf8');
        if (!isSelectClassified(s, table, column)) {
            const block = selectTableBlock(s, table);
            const rel = select === 'granted' ? 'granted: new Set([' : 'revoked: {';
            const anchorIndex = s.indexOf(rel, block.start);
            const line = select === 'granted' ? `'${column}',` : `${column}: '${esc}',`;
            s = insertAfterAnchor(s, anchorIndex, line);
            fs.writeFileSync(SELECT_GUARD, s);
            changed.push(`select-guard: ${table}.${column} -> ${select === 'granted' ? 'GRANTED' : 'REVOKED'}`);
        }
    }

    // --- write guard (service_providers only) ---
    if (table === WRITE_TABLE) {
        let s = fs.readFileSync(WRITE_GUARD, 'utf8');
        if (!isWriteClassified(s, column)) {
            const anchorIndex = write === 'writable'
                ? s.indexOf('PROVIDER_WRITABLE = new Set([')
                : s.indexOf('const PLATFORM_ONLY');
            const line = write === 'writable' ? `'${column}',` : `${column}: '${esc}',`;
            // For PLATFORM_ONLY the anchor is `= {` on the next line; step to it.
            const from = write === 'writable' ? anchorIndex : s.indexOf('{', anchorIndex);
            s = insertAfterAnchor(s, from, line);
            fs.writeFileSync(WRITE_GUARD, s);
            changed.push(`write-guard: ${column} -> ${write === 'writable' ? 'PROVIDER_WRITABLE' : 'PLATFORM_ONLY'}`);
        }
    }
    return changed;
}

module.exports = { detectGuardedColumns, unclassified, writeRegistryStub, isSelectClassified, isWriteClassified };
