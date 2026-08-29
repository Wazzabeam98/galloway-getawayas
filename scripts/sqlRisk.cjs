// What a piece of SQL would do to your data, decided in one place.
//
// WHY IT IS A MODULE AND NOT TWENTY LINES INSIDE migrate.mjs
//
// It was inside migrate.mjs, and the only way to test it was to run the
// script — which loads .env.local and dies without it, so the tests passed
// locally and failed in CI where there are no credentials. A rule that can
// only be exercised by the thing that needs credentials is a rule with no
// tests, and this one decides whether a migration is allowed to drop a table.
//
// WHY .cjs, LIKE scripts/target.cjs
//
// Two kinds of caller. migrate.mjs is ESM; the test suite is compiled to
// CommonJS, and on Node 20 CommonJS cannot require an ESM file. CommonJS is
// the format both can load. Same reasoning, same file extension, and the
// comment in target.cjs explains it at more length.

// Statements that lose rows or columns. These need --destructive typed as well
// as --apply.
const LOSES_DATA = [
    [/\bdrop\s+table\b/, 'drop table'],
    [/\bdrop\s+schema\b/, 'drop schema'],
    [/\bdrop\s+database\b/, 'drop database'],
    [/\bdrop\s+owned\b/, 'drop owned'],
    [/\btruncate\b/, 'truncate'],
    [/\balter\s+table[\s\S]{0,120}?\bdrop\s+column\b/, 'drop column'],
    [/\bdelete\s+from\b(?![\s\S]{0,200}?\bwhere\b)/, 'delete without a where'],
];

// Structural changes that lose no data. Reported in the plan, no extra flag —
// half this folder does them.
const STRUCTURAL = [
    [/\bdrop\s+policy\b/, 'drop policy'],
    [/\bdrop\s+constraint\b/, 'drop constraint'],
    [/\bdrop\s+function\b/, 'drop function'],
    [/\bdrop\s+trigger\b/, 'drop trigger'],
    [/\bdrop\s+index\b/, 'drop index'],
    [/\brevoke\b/, 'revoke'],
];

/**
 * Comments and quoted strings removed, so a statement DESCRIBED in a comment
 * is not mistaken for one being run — the migrations in this folder quote
 * their own old constraints in the header.
 *
 * `keepBodies` decides whether $$...$$ survives. For naming statements in the
 * plan it should not; for deciding whether data is lost it must, because the
 * body of a `do $$ ... $$` block is code that runs, not a string. A truncate
 * hidden in one used to walk straight past this guard — found by running one,
 * which waved it through and truncated a table on the test project.
 */
function strip(sql, keepBodies) {
    let out = String(sql)
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/'[^']*'/g, "''");

    if (!keepBodies) out = out.replace(/\$\$[\s\S]*?\$\$/g, ' $$body$$ ');

    return out.toLowerCase();
}

/**
 * What this SQL would do.
 *
 * `destructive` is the list of data-loss reasons; empty means no extra flag is
 * needed. `structural` is for the plan.
 *
 * GRANTS AND REVOKES ARE CUT OUT BEFORE THE DATA-LOSS SCAN. The words in them
 * mean the opposite of how they read: `revoke truncate on table profiles from
 * anon` REMOVES the ability to truncate, and the plain /\btruncate\b/ above
 * takes it for a truncation and demands --destructive. That is not a small
 * annoyance — the way a guard stops meaning anything is by asking for the
 * magic word on things that plainly do not need it, until typing the magic
 * word is a reflex. A permission statement cannot lose a row by construction.
 * `revoke` stays in STRUCTURAL, so it is still named in the plan.
 */
function classify(sql) {
    const forPlan = strip(sql, false);
    const forDataLoss = strip(sql, true).replace(/\b(grant|revoke)\b[\s\S]*?(;|$)/g, ' ');

    return {
        destructive: LOSES_DATA.filter(([re]) => re.test(forDataLoss)).map(([, name]) => name),
        structural: STRUCTURAL.filter(([re]) => re.test(forPlan)).map(([, name]) => name),
        writes: /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/.test(forPlan),
        bare: forPlan,
    };
}

module.exports = { classify, LOSES_DATA, STRUCTURAL };
