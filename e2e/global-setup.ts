// Refusing to run against the wrong thing.
//
// The checks themselves used to live here. They now live in
// `scripts/target.mjs`, because having them here was the bug: this suite was
// guarded and `scripts/journeys.mjs`, one folder away doing the same dangerous
// thing, was not — and it spent days green against a build fifteen commits
// behind master, on a deployment too old to even have /api/health.
//
// One implementation, imported by every runner, and
// `tests/runner-targets.test.ts` fails the build if a runner is added that
// finds its own target instead of asking for one. This file is now just the
// Playwright-shaped wrapper: a refusal is thrown rather than exited, so the
// whole run fails and reports properly, which is the point — a suite that
// quietly tests nothing is the failure being designed out.

import type { FullConfig } from '@playwright/test';
// @ts-ignore — CommonJS, deliberately shared with the .mjs runners. See the
// note at the top of that file: Playwright compiles this to CommonJS and
// requires it, and requiring ESM is what broke the suite.
import { assertSafeTarget } from '../scripts/target.cjs';

export default async function globalSetup(config: FullConfig) {
    const baseURL =
        (config.projects[0]?.use as any)?.baseURL || process.env.PLAYWRIGHT_BASE_URL;

    // Throws RefusedError on production, the production database, or a build
    // behind master. PLAYWRIGHT_ALLOW_STALE=1 (or ALLOW_STALE=1) permits the
    // last of those, per run, loudly.
    await assertSafeTarget(baseURL, { runner: 'the e2e suite' });
}
