// The documents make checkable claims. These check them.
//
// WHY THIS EXISTS
//
// On 1 September 2026, five claims in MAINTENANCE.md and OUTSTANDING.md were
// false at the same time — including one the same file corrected three hundred
// lines further down, and a Tailwind rule that had stopped being true when
// `./lib/**` was added to the config's content globs. Nobody had done anything
// wrong; the documents simply had no way to fail.
//
// That is the exact shape both documents exist to warn about, which is why it
// is worth spending a test on.
//
// WHAT THIS CANNOT DO, AND SAYS SO RATHER THAN PRETENDING
//
// Most of what is in those files is judgement, history, or a fact about a
// Supabase project setting that no API reaches without a management token. The
// most expensive stale claim of the week — whether production had custom SMTP —
// is in that last category. None of it is checkable here, and a checker that
// implied otherwise would be worse than none.
//
// So this checks three narrow, mechanical things, and the dates.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = ['MAINTENANCE.md', 'OUTSTANDING.md', 'CLAUDE.md'];

/** Days after which a section's claims are worth re-reading. A warning, never a failure. */
const STALE_AFTER_DAYS = 60;

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel: string): boolean {
    // `lib/clawback` in prose means `lib/clawback.ts`. A doc should not have to
    // spell out an extension to be checkable.
    for (const ext of ['', '.ts', '.tsx', '.mjs', '.cjs', '.sql', '.json']) {
        if (fs.existsSync(path.join(ROOT, rel + ext))) return true;
    }
    return false;
}

/* --------------------------------------------------------------- the dates */

// Every `## ` section says when its claims were last checked. This does not
// make them true — it makes them ageing, which is the most a date can do, and
// it turns "is this still right?" from unanswerable into a queue.
test('every section in MAINTENANCE.md says when it was last checked', () => {
    const lines = read('MAINTENANCE.md').split('\n');
    const undated: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (!/^## /.test(lines[i])) continue;
        // The date is on its own line within the few lines after the heading.
        const window = lines.slice(i + 1, i + 5).join('\n');
        if (!/^checked: \d{4}-\d{2}-\d{2}$/m.test(window)) undated.push(lines[i].slice(3));
    }

    assert.deepEqual(
        undated, [],
        'These sections do not say when they were last checked:\n  ' + undated.join('\n  ')
        + '\n\nAdd a line reading  checked: YYYY-MM-DD  under the heading. An undated'
        + '\nclaim cannot be aged, and an unaged claim is believed for ever.'
    );
});

test('sections whose claims have aged are named, but never fail the build', () => {
    const lines = read('MAINTENANCE.md').split('\n');
    const stale: string[] = [];
    const now = Date.now();

    for (let i = 0; i < lines.length; i++) {
        if (!/^## /.test(lines[i])) continue;
        const window = lines.slice(i + 1, i + 5).join('\n');
        const found = window.match(/^checked: (\d{4}-\d{2}-\d{2})$/m);
        if (!found) continue;

        const days = Math.floor((now - new Date(found[1]).getTime()) / 86400000);
        if (days > STALE_AFTER_DAYS) stale.push(`${lines[i].slice(3)} — ${days} days`);
    }

    if (stale.length) {
        console.warn(
            '\n  MAINTENANCE.md sections not checked in over ' + STALE_AFTER_DAYS + ' days:\n    '
            + stale.join('\n    ')
            + '\n  Re-read them, then move the date. Not a failure — the passage of time'
            + '\n  is not a reason to break somebody else’s build.\n'
        );
    }

    // Deliberately no assertion. See above.
    assert.ok(true);
});

/* ---------------------------------------------------- the mechanical claims */

test('every repo path named in the documents exists', () => {
    const missing: string[] = [];

    for (const doc of DOCS) {
        const body = read(doc);
        const cited = body.match(/`(lib|app|scripts|components|tests|supabase|e2e|config)\/[A-Za-z0-9_./[\]-]+`/g) || [];
        for (const raw of Array.from(new Set(cited))) {
            const rel = raw.slice(1, -1);
            // A path under a gitignored working directory is not a claim about
            // the repo — supabase/.temp is written by the CLI and absent on a
            // fresh checkout.
            if (rel.startsWith('supabase/.temp/')) continue;
            if (!exists(rel)) missing.push(doc + ': ' + rel);
        }
    }

    assert.deepEqual(
        missing, [],
        'These files are named in the documents and do not exist:\n  ' + missing.join('\n  ')
        + '\n\nEither the file moved and the note did not, or the note describes'
        + '\nsomething that was never built. Both are worth knowing.'
    );
});

test('every npm script named in the documents exists', () => {
    const pkg = JSON.parse(read('package.json'));
    const missing: string[] = [];

    for (const doc of DOCS) {
        const cited = read(doc).match(/npm run ([a-z:]+)/g) || [];
        for (const raw of Array.from(new Set(cited))) {
            const name = raw.replace('npm run ', '');
            if (!pkg.scripts[name]) missing.push(doc + ': npm run ' + name);
        }
    }

    assert.deepEqual(
        missing, [],
        'These commands are given in the documents and are not in package.json:\n  '
        + missing.join('\n  ')
    );
});

test('every commit named in the documents is a commit', () => {
    // SKIPPED ON A SHALLOW CLONE, OUT LOUD.
    //
    // actions/checkout takes fetch-depth 1 by default, so CI holds one commit
    // and every cited SHA would fail for a reason that has nothing to do with
    // the documents. Passing quietly instead would make this a guard whose
    // success proves nothing — the shape MAINTENANCE.md opens with. It runs
    // locally and in the pre-push hook, which is where the notes get written.
    let shallow = false;
    try {
        shallow = execSync('git rev-parse --is-shallow-repository', { cwd: ROOT })
            .toString().trim() === 'true';
    } catch (err) {
        shallow = true;
    }

    if (shallow) {
        console.warn('\n  Commit references not checked: shallow clone. Runs locally.\n');
        assert.ok(true);
        return;
    }

    const unknown: string[] = [];

    for (const doc of DOCS) {
        const cited = read(doc).match(/`[0-9a-f]{7,40}`/g) || [];
        for (const raw of Array.from(new Set(cited))) {
            const sha = raw.slice(1, -1);
            // A 40-char hex string in these documents is a token or a hash, not
            // a commit; only the short form is ever used for one here.
            if (sha.length > 12) continue;
            try {
                execSync(`git cat-file -e ${sha}^{commit}`, { cwd: ROOT, stdio: 'ignore' });
            } catch (err) {
                unknown.push(doc + ': ' + sha);
            }
        }
    }

    assert.deepEqual(
        unknown, [],
        'These commits are named in the documents and are not in this history:\n  '
        + unknown.join('\n  ')
        + '\n\nA rebase or a squash can do this. The claim around it is probably'
        + '\nstill true, but the evidence for it no longer resolves.'
    );
});

/* ------------------------------------------------- the generated header */

test('the OUTSTANDING.md header is generated, not typed', () => {
    // It used to read "Live on production: 43c5158. Tests 933 pass." Both were
    // true when somebody typed them and neither was true a day later. The
    // numbers now come from the repo.
    //
    // This asserts the block is THERE, and deliberately not that it is current:
    // the count inside it comes from running this very suite, so a test that
    // compared them would be asserting on its own output. Staleness is handled
    // the honest way — by nobody having to remember, because
    // `node scripts/doc-header.mjs --write` fills it in.
    const body = read('OUTSTANDING.md');

    assert.ok(
        body.includes('<!-- generated: do not edit by hand -->')
        && body.includes('<!-- /generated -->'),
        'The generated block is gone from OUTSTANDING.md. Facts that have to be'
        + '\nretyped are facts that go stale. Put the markers back and run:'
        + '\n    node scripts/doc-header.mjs --write'
    );

    const start = body.indexOf('<!-- generated: do not edit by hand -->');
    const end = body.indexOf('<!-- /generated -->');
    assert.ok(end > start, 'the generated markers are the wrong way round');
    assert.match(
        body.slice(start, end), /\| master \| `[0-9a-f]{7,}`/,
        'the generated block does not name a commit — re-run scripts/doc-header.mjs --write'
    );
});
