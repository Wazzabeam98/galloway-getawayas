// What a host owes may only be changed by the database function.
//
// It used to be moved from three places, all doing the same thing: read
// profiles.payout_balance_owed into JavaScript, add or subtract there, write
// the result back. Anything else touching the row between the read and the
// write was lost. Two debts of £40 and £25 arriving together left £40; ten of
// £10 left £20.
//
// The payout run was the worst of the three, because the gap between its read
// and its write is a network call to Stripe. A clawback landing while a
// transfer was in flight was overwritten by a total read before the money
// moved — demonstrated, £50 lost.
//
// This is the rule that says the arithmetic stays in the database. It is the
// same shape as tests/money-routes-report-failures and
// tests/admin-pages-guarded.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Comments stripped first — three tests in this repo have been fooled by the
// comment explaining why a thing was not done.
const code = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(path.relative(ROOT, full));
    }
    return out;
}

const FILES = [
    ...sourceFiles(path.join(ROOT, 'app')),
    ...sourceFiles(path.join(ROOT, 'lib')),
];

test('there are source files to check', () => {
    assert.ok(FILES.length > 50, 'found only ' + FILES.length + ' files — the scan is broken');
});

test('nothing writes payout_balance_owed directly', () => {
    const offenders: string[] = [];

    for (const rel of FILES) {
        const src = code(rel);
        if (!src.includes('payout_balance_owed')) continue;

        // A write is the column appearing as an object key being assigned —
        // `.update({ payout_balance_owed: ... })` or an insert carrying it.
        // Reading it (`select('… payout_balance_owed')`, `h.payout_balance_owed`)
        // is fine and stays.
        if (/payout_balance_owed\s*:/.test(src)) offenders.push(rel);
    }

    assert.deepEqual(
        offenders,
        [],
        'these write payout_balance_owed directly instead of calling the '
            + 'adjust_payout_balance function: ' + offenders.join(', ')
            + '. Read-add-write in JavaScript loses any change that lands in the gap.'
    );
});

test('the three places that move a debt all go through the function', () => {
    const movers = [
        'lib/clawback.ts',
        'app/api/stripe/refund/route.ts',
        'app/api/cron/host-payouts/route.ts',
    ];

    for (const rel of movers) {
        assert.ok(
            code(rel).includes('adjust_payout_balance'),
            rel + ' changes what a host owes but does not call adjust_payout_balance'
        );
    }
});

test('the migration revokes the function from the browser roles', () => {
    const sql = fs.readFileSync(
        path.join(ROOT, 'supabase', 'migrations', '20260831120000_host_debt_moves_atomically.sql'),
        'utf8'
    );

    // SECURITY DEFINER runs as the owner and ignores the caller's grants, and
    // Postgres grants EXECUTE to PUBLIC by default. A function that edits a
    // money column must not be reachable with the browser key.
    assert.match(sql, /security\s+definer/i, 'the function is not SECURITY DEFINER');
    for (const role of ['public', 'anon', 'authenticated']) {
        assert.match(
            sql,
            new RegExp('revoke all on function public\\.adjust_payout_balance\\(uuid, numeric\\) from ' + role, 'i'),
            'execute is not revoked from ' + role
        );
    }
});
