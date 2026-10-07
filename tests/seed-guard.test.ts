// The guard that stops the payment suite writing to the wrong database.
//
// WHY THIS EXISTS. `scripts/seed-lib.mjs` is imported by every seeder and every
// payment scenario runner, and `assertTestEnvironment()` is the thing between
// them and production. Nothing in the unit suite touched it, because it is ESM
// used only by command-line scripts — so when it broke, everything stayed green.
//
// It broke on 28 August 2026, in a one-line change made while fixing something
// else. TEST_PROJECT_REF moved into target.cjs and was brought back as:
//
//     export { TEST_PROJECT_REF } from './target.cjs';
//
// That is a PURE re-export. It forwards the name to importers and creates no
// local binding, so every use of it INSIDE seed-lib — including this guard —
// referenced an undefined identifier and threw ReferenceError. It failed
// closed, so nothing was written anywhere it should not have been, but every
// seeder and scenario runner stopped working and the unit suite noticed
// nothing. It was found by running one of the scripts, which is the only thing
// that ever exercises them.
//
// The check is deliberately behavioural rather than structural: it asks the
// guard to accept the test project and refuse production, which is the promise
// it makes. A test for "does the import look right" would have missed the
// original bug just as thoroughly as the suite did.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_LIB = path.join(ROOT, 'scripts', 'seed-lib.mjs');

const TEST_URL = 'https://yefoqcabuijcowoqewtc.supabase.co';
const PROD_URL = 'https://hviwjxigqivjfhmhpjiy.supabase.co';

/**
 * Run the guard in a real Node process against a made-up environment.
 *
 * A subprocess because seed-lib is ESM and these tests are compiled to
 * CommonJS, which cannot require it — the same module-system wall that caused
 * the bug being tested.
 */
function guard(env: Record<string, string>): { accepted: boolean; message: string } {
    const script = `
        import('${SEED_LIB.replace(/\\/g, '/')}').then((m) => {
            try {
                m.assertTestEnvironment(${JSON.stringify(env)});
                console.log('ACCEPTED');
            } catch (e) {
                console.log('REFUSED:' + e.message);
            }
        }).catch((e) => console.log('THREW_ON_IMPORT:' + e.message));
    `;
    const out = String(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 })).trim();
    return { accepted: out === 'ACCEPTED', message: out };
}

const testEnv = {
    NEXT_PUBLIC_SUPABASE_URL: TEST_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    STRIPE_SECRET_KEY: 'sk_test_something',
};

test('seed-lib loads at all', () => {
    // The bug it was written for did not look like a failing assertion. It
    // looked like every script dying with "TEST_PROJECT_REF is not defined".
    const { message } = guard(testEnv);
    assert.doesNotMatch(message, /THREW_ON_IMPORT/, 'seed-lib could not even be imported: ' + message);
    assert.doesNotMatch(message, /is not defined/, 'an identifier in seed-lib is unbound: ' + message);
});

test('the test project is accepted', () => {
    const { accepted, message } = guard(testEnv);
    assert.ok(accepted, 'the guard refused the test project, so nothing can run: ' + message);
});

test('the production project is refused', () => {
    // The whole point. Every seeder and scenario runner writes rows and moves
    // test money; pointed at production it would do both for real.
    const { accepted, message } = guard({ ...testEnv, NEXT_PUBLIC_SUPABASE_URL: PROD_URL });
    assert.equal(accepted, false, 'THE GUARD ACCEPTED PRODUCTION');
    assert.match(message, /not the test project/);
});

test('a live Stripe key is refused even on the test database', () => {
    // Right database, real money. Both halves have to hold.
    const { accepted, message } = guard({ ...testEnv, STRIPE_SECRET_KEY: 'sk_live_something' });
    assert.equal(accepted, false, 'THE GUARD ACCEPTED A LIVE STRIPE KEY');
    assert.match(message, /not a test key/);
});

/* ------------------------------------------------- the client refuses too */

function clientGuard(url: string): string {
    const script = `
        import('${SEED_LIB.replace(/\\/g, '/')}').then((m) => {
            try {
                m.supabaseClient({ NEXT_PUBLIC_SUPABASE_URL: ${JSON.stringify(url)}, SUPABASE_SERVICE_ROLE_KEY: 'k' });
                console.log('ACCEPTED');
            } catch (e) {
                console.log('REFUSED:' + e.message);
            }
        }).catch((e) => console.log('THREW_ON_IMPORT:' + e.message));
    `;
    return String(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 })).trim();
}

test('supabaseClient itself refuses production, whether or not the script asserted first', () => {
    // Every seeder and runner writes through this client. Guarding it means a
    // new script that forgets assertTestEnvironment still cannot reach
    // production — the way seed rows would get there.
    assert.equal(clientGuard(TEST_URL), 'ACCEPTED');
    const refused = clientGuard(PROD_URL);
    assert.match(refused, /^REFUSED:.*not the test project/, 'supabaseClient ACCEPTED PRODUCTION: ' + refused);
});

/* ----------------------------------- every script that holds the key is guarded */

// Scripts that take the service-role key and are allowed to reach production,
// each on purpose and each with its own check against the production ref.
// Adding to this list is a decision; say why on the line.
const PROD_ON_PURPOSE: Record<string, string> = {
    'write-side-allowed.mjs': 'security audit; --target prod, plants and removes its own canary',
    'write-side-rls.mjs': 'security audit; --target prod, plants and removes its own canary',
    'create-removed-bucket.mjs': 'one-off infrastructure: creates the private listings-removed bucket, no rows',
    'experience-review-gate.mjs': 'refuses the production ref by name itself',
};

test('no script holds the service-role key without a TEST-only guard', () => {
    // How seed data could reach production: a script reads .env.local, takes
    // the service key and writes, with nothing checking which project the URL
    // is. seed-town-experience-coverage.mjs did exactly that until 7 Oct 2026
    // (its only check was "is it supabase.co"). This fails the build for the
    // next one.
    const fs = require('fs');
    const dir = path.join(ROOT, 'scripts');
    const GUARDS = /assertTestEnvironment|assertTestSupabaseUrl|supabaseClient\(|TEST_PROJECT_REF|assertSafeTarget|resolveTarget/;
    const unguarded = fs.readdirSync(dir)
        .filter((f: string) => /\.(mjs|cjs|js)$/.test(f))
        .filter((f: string) => !PROD_ON_PURPOSE[f])
        .filter((f: string) => {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            return /SUPABASE_SERVICE_ROLE_KEY/.test(src) && !GUARDS.test(src);
        });
    assert.deepEqual(unguarded, [], 'these scripts can write to whatever project .env.local names: ' + unguarded.join(', '));
});
