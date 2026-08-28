import { defineConfig } from '@playwright/test';
// @ts-ignore — CommonJS, deliberately shared with the .mjs runners.
//
// .cjs, not .mjs. Playwright compiles this config to CommonJS and `require`s
// whatever it imports; requiring an ESM file dies with "exports is not defined
// in ES module scope" and the whole suite cannot start. That happened.
import { PREVIEW_URL } from './scripts/target.cjs';

// Driving the real form in a real browser.
//
// Everything else in this repo checks the sign-up from underneath: the unit
// suite tests the rules, scripts/journeys.mjs posts to /api/services/apply
// directly. Both were green through two faults that a person found in a minute,
// because neither had ever pressed the button:
//
//   the confirmation link carried the wrong trade, so the draft was looked for
//   under a key nothing had written
//
//   a SUCCESSFUL application put the applicant on step two with no
//   confirmation, so a sent application and a refused one looked identical
//
// Both were client-side, and both are the same shape: the round trip ends
// somewhere the work is not.
//
// WHERE IT POINTS, AND WHY IT IS NOT MASTER.
//
// This signs somebody up. Pointed at production it would put junk applications
// in the real queue and real accounts in the real auth table.
//
// The obvious target — master's own preview — does not exist. Vercel lists
// galloway-getawayas-git-master-… among the PRODUCTION aliases, so master's
// branch URL and the live site are the same deployment. There is no preview of
// master to point at.
//
// So there is a long-lived branch that exists only to be deployed as a preview:
// `e2e-preview`, kept at master by `npm run e2e:sync`. It is backed by the test
// Supabase project, which is where invented tradesmen belong.
//
// A branch off master rots, and that rot is exactly how this suite came to be
// green against an eight-commit-old build. So the URL below is not trusted on
// its own: e2e/global-setup.ts asks the deployment what it is before any test
// runs, and refuses to go on if it is production, if it is writing to the
// production database, or if it is behind master.
export default defineConfig({
    testDir: './e2e',
    // Runs before anything else and throws if the target is wrong. A refusal
    // here fails the whole run rather than skipping tests, which is the point:
    // a suite that quietly tests nothing is the failure being designed out.
    globalSetup: './e2e/global-setup.ts',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        // PREVIEW_URL is imported, not written here. scripts/target.mjs is the
        // only file in the repo allowed to contain a site URL, so that a new
        // runner cannot quietly acquire a target of its own — which is how
        // journeys.mjs came to be pointed at a merged branch for fifteen
        // commits. Enforced by tests/runner-targets.test.ts.
        baseURL: process.env.PLAYWRIGHT_BASE_URL || PREVIEW_URL,
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
