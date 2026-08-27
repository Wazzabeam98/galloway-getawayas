import { defineConfig } from '@playwright/test';

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
// DEFAULTS TO THE PREVIEW, NOT PRODUCTION. This signs somebody up. Pointed at
// production it would put junk applications in the real queue and real accounts
// in the real auth table. The preview is backed by the test Supabase project,
// which is where invented tradesmen belong.
export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL
            || 'https://galloway-getawayas-git-services-phase-one-wazzabeam98s-projects.vercel.app',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
