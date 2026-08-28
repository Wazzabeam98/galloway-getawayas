// The shape supabase/migrations has to hold, so applying the folder is safe.
//
// Two separate hazards, both found on 28 August 2026 and both latent for days.
//
// ORDER. Every migration was named with a date only — `20260822_thing.sql` —
// and eight of them shared the prefix 20260822. Anything applying the folder
// sorts by filename, so the order within a day was decided by the first letter
// of the description. That is not a theoretical worry: it had already gone
// wrong. `trade_registration` was written on the 25th but named for the 26th,
// so it sorted after two migrations written a day later than it was.
//
// The names now carry the full timestamp the file was actually committed at,
// which is why some dates moved: the old prefixes recorded the date somebody
// intended, not the date the SQL was written.
//
// FILES THAT MUST NOT RUN. Two worksheets were sitting in the same folder. One
// opens "NOT SAFE TO RUN AS-IS" and expects a person to hand-write four
// UPDATEs; the other is headed "STEP 2 OF 2. DO NOT RUN THIS YET" and DROPS
// COLUMNS. Anything applying the directory would have run both. They live in
// supabase/manual/ now, and this test keeps that kind of file out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

// tests run from .test-build/tests, so the repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');

function migrations(): string[] {
    return fs.readdirSync(DIR).filter((n: string) => n.endsWith('.sql')).sort();
}

test('every migration is named with a full 14-digit timestamp', () => {
    const wrong = migrations().filter((n) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(n));

    assert.deepEqual(
        wrong, [],
        'These are not <YYYYMMDDHHMMSS>_name.sql:\n  ' + wrong.join('\n  ')
        + '\n\nA date-only prefix leaves the order within that day to alphabetical'
        + '\nsorting, which has already put a migration before one written a day earlier.'
    );
});

test('no two migrations share a timestamp', () => {
    const seen: Record<string, string[]> = {};
    for (const name of migrations()) {
        const stamp = name.slice(0, 14);
        (seen[stamp] = seen[stamp] || []).push(name);
    }
    const clashes = Object.keys(seen).filter((s) => seen[s].length > 1);

    assert.deepEqual(
        clashes, [],
        'These timestamps are used more than once, so their order is undefined:\n  '
        + clashes.map((s) => seen[s].join('  and  ')).join('\n  ')
    );
});

test('nothing in migrations says it must not be run', () => {
    // The exact hazard: a file that drops columns under a heading telling you
    // not to yet, sitting where anything applying the folder would find it.
    const REFUSALS = /NOT SAFE TO RUN|DO NOT RUN|DO NOT APPLY/i;

    const offenders = migrations().filter((name) =>
        REFUSALS.test(fs.readFileSync(path.join(DIR, name), 'utf8'))
    );

    assert.deepEqual(
        offenders, [],
        'These carry a do-not-run warning and are in the folder anyway:\n  '
        + offenders.join('\n  ')
        + '\n\nA worksheet is not a migration. Put it in supabase/manual/ — see the'
        + '\nREADME there.'
    );
});

test('the manual folder still holds the two that were moved out of the way', () => {
    // Not decoration: if these ever come back to migrations/ the rule above
    // catches them, but if they are simply deleted the reason they existed —
    // an add-deploy-then-drop pair with its drop deliberately held back — goes
    // with them.
    const manual = fs.readdirSync(path.join(ROOT, 'supabase', 'manual'));

    for (const name of ['backfill_listing_street_address.sql', 'drop_listing_text_time_columns.sql']) {
        assert.ok(manual.includes(name), `supabase/manual/${name} has gone missing`);
    }
});

test('migrations are ordered the same way a directory apply would order them', () => {
    // Sorting by filename and sorting by timestamp must give the same answer.
    // They did not before: the old names made those two orders disagree, which
    // is the whole bug.
    const byName = migrations();
    const byStamp = [...byName].sort((a, b) => Number(a.slice(0, 14)) - Number(b.slice(0, 14)));

    assert.deepEqual(byName, byStamp, 'filename order and timestamp order disagree');
});
