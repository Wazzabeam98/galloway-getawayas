// Nobody may add a runner that skips the target guard.
//
// WHAT THIS IS PROTECTING, AND WHY A TEST RATHER THAN A NOTE IN A FILE.
//
// On 28 August 2026 the Playwright suite was given a guard: ask the deployment
// what it is, refuse production, refuse the production database, refuse a build
// behind master. It was written because that suite had been green for days
// against code eight commits old.
//
// `scripts/journeys.mjs` sat in the same folder doing the same dangerous thing
// — creating auth accounts, writing rows — with its target hardcoded to a
// feature-branch preview that had since been merged. Its 27 checks were
// passing against a build FIFTEEN commits behind master, on a deployment so
// old it did not have the /api/health route the guard reads. Same fault, same
// week, one folder apart, and the guard did not cover it because guards get
// added to the file being worked on.
//
// So the guard is not a habit any more, it is a shape the repo has to hold:
//
//   1. Only scripts/target.mjs may contain a preview or localhost URL. A new
//      runner therefore has nowhere to get a target from except the module
//      that checks it.
//   2. Any runner that talks to the site must import that module.
//   3. Only the guard, and the two Playwright files that hand a URL straight
//      to it, may read a target out of the environment.
//
// Break any of the three and this fails, by name, with the reason.
//
// Production is deliberately NOT part of rule 1. A literal production URL is
// refused at runtime by /api/health with no override available, so banning the
// string as well would catch honest uses — seed-payments.mjs puts the real
// company website into Stripe account metadata, which is not a target.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

// tests run from .test-build/tests, so the repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');

/** The one file allowed to know where anything lives. */
const GUARD = 'scripts/target.cjs';

/** Hand a URL straight to the guard and do nothing else with it. */
const PASSES_THROUGH = ['playwright.config.ts', 'e2e/global-setup.ts'];

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Every .mjs runner and every .ts file in the e2e harness, repo-relative. */
function harnessFiles(): string[] {
    const out: string[] = [];
    for (const dir of ['scripts', 'e2e']) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            if (/\.(mjs|cjs|ts)$/.test(name)) out.push(`${dir}/${name}`);
        }
    }
    out.push('playwright.config.ts');
    return out.sort();
}

// A full http(s) URL pointing at a Vercel deployment or a local dev server.
// Deliberately not `.vercel.app` on its own — check-deploy.mjs sorts hostnames
// by that suffix, which is reading a name, not naming a target.
const TARGET_URL = /https?:\/\/[^\s'"`]*(?:\.vercel\.app|localhost:\d+)/;

test('only the guard may name a preview or a local target', () => {
    const offenders: string[] = [];

    for (const rel of harnessFiles()) {
        if (rel === GUARD) continue;
        const body = read(rel);
        const hit = body.match(TARGET_URL);
        if (hit) offenders.push(`${rel}  ->  ${hit[0]}`);
    }

    assert.deepEqual(
        offenders, [],
        'A target URL is written outside ' + GUARD + ':\n  ' + offenders.join('\n  ')
        + '\n\nThis is how journeys.mjs came to be pointed at a merged branch for'
        + '\nfifteen commits. Import PREVIEW_URL or LOCAL_URL from ' + GUARD + ' instead.'
    );
});

test('every runner that talks to the site imports the guard', () => {
    // Hitting an /api/ path is the tell that a script talks to the site rather
    // than to Supabase, Stripe or git. It is what separates journeys.mjs and
    // the scenario runners from migrate.mjs and e2e-sync.mjs.
    const talkers = harnessFiles().filter(
        (rel) => rel !== GUARD && rel.startsWith('scripts/') && read(rel).includes('/api/')
    );

    // If this ever empties, the tell has stopped working and the rule below is
    // vacuously true — which is the failure mode this whole file exists for.
    assert.ok(
        talkers.length >= 6,
        `expected at least 6 site-talking runners, found ${talkers.length}: `
        + `the "/api/" tell has stopped identifying them, so this rule is now checking nothing`
    );

    const unguarded = talkers.filter((rel) => !read(rel).includes("from './target.cjs'"));

    assert.deepEqual(
        unguarded, [],
        'These runners reach the site without asking ' + GUARD + ' where to point:\n  '
        + unguarded.join('\n  ')
        + '\n\nUse resolveTarget({ runner, envNames, fallback }) so the run is refused'
        + '\nagainst production, the production database, or a stale build.'
    );
});

test('only the guard reads a target out of the environment', () => {
    const ENV_TARGET = /process\.env\.(SITE_URL|BASE_URL|PLAYWRIGHT_BASE_URL|ALLOW_STALE)\b/;

    const offenders: string[] = [];
    for (const rel of harnessFiles()) {
        if (rel === GUARD || PASSES_THROUGH.includes(rel)) continue;
        const hit = read(rel).match(ENV_TARGET);
        if (hit) offenders.push(`${rel}  ->  ${hit[0]}`);
    }

    assert.deepEqual(
        offenders, [],
        'A target is read from the environment outside ' + GUARD + ':\n  '
        + offenders.join('\n  ')
        + '\n\nAn env var is a target like any other and has to be checked. Name the'
        + '\nvariable in the envNames option instead of reading it directly.'
    );
});

test('the guard still refuses all three things it is for', () => {
    const body = read(GUARD);

    // Not a stand-in for exercising them — all four paths were run deliberately
    // when the Playwright guard was written. This catches a refusal being
    // softened to a warning during an unrelated tidy-up, which is silent.
    //
    // It asserts the title is an argument to refuse(), NOT merely that the
    // words appear. The first draft of this checked `body.includes(...)` and
    // was mutation-tested by turning `refuse('that is PRODUCTION'` into
    // `warn(['that is PRODUCTION'` — the guard stopped refusing production and
    // the test carried on passing, because the string was still in the file.
    // That is this repo's oldest test failure mode and it very nearly shipped
    // inside the file meant to prevent it.
    for (const [what, title] of [
        ['production', 'that is PRODUCTION'],
        ['the wrong database', 'that is the WRONG DATABASE'],
        ['a stale build', 'the target is STALE'],
        ['a build with no /api/health', 'the target predates this guard'],
    ]) {
        assert.match(
            body,
            new RegExp('refuse\\(\\s*[\'"`]' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
            `${GUARD} no longer REFUSES ${what} — the words may still be there, `
            + `but they are not attached to refuse()`
        );
    }

    // Staleness is the only one with an escape hatch, and it must stay the
    // only one: a flag that skipped the production check would be a way to
    // point a suite that creates accounts at the live site.
    const overridable = body.match(/ALLOW_STALE/g) || [];
    assert.ok(overridable.length > 0, 'the deliberate stale override has gone');
    assert.ok(
        !/ALLOW_PRODUCTION|ALLOW_WRONG_DB|SKIP_TARGET_CHECK/.test(body),
        'an override has been added for a refusal that must be absolute'
    );
});
