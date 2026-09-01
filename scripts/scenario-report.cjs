// What the scenario runs actually proved, and when — as output rather than prose.
//
// WHY THIS EXISTS
//
// PAYMENT-SCENARIOS.md said "Scenarios 12-24 are scripted and passing" from
// 21 August 2026. On 31 August, PR #57 made a payout transfer name the charge
// that funds it, which moves the money into the host's PENDING balance instead
// of their available one — and scenario 22 reads the available balance. That
// sentence was false from that moment. Nothing detected it, because a sentence
// cannot fail. It was still there on 1 September, ten days later, telling the
// next person the ground was covered.
//
// Three sessions touched the payout and clawback path on 31 August. Each built
// a bespoke harness and proved its own change well. None ran the standing
// suite, which existed, had been green, and would have failed.
//
// So the claim stops being a sentence. The runners write down what they
// actually did, against which files, and a test refuses to let the record go
// stale in silence.
//
// .cjs so the test build can require it and the ESM runners can import it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = 'SCENARIO-RESULTS.json';

// THE FILES THESE SCENARIOS ARE EVIDENCE ABOUT.
//
// Change any of them and the last run stopped being evidence about the code
// you now have. That is the whole rule. The list is the money path the four
// runners actually exercise, plus the seeder and the runners themselves —
// a fixture that changes invalidates the result just as surely as the code.
const WATCHED = [
    'app/api/cron/host-payouts/route.ts',
    'app/api/cron/balance-charges/route.ts',
    'app/api/stripe/refund/route.ts',
    'app/api/stripe/checkout/route.ts',
    'app/api/stripe/webhook/route.ts',
    'app/api/bookings/cancel/route.ts',
    'app/api/bookings/host-refund/route.ts',
    'lib/clawback.ts',
    'lib/payoutSource.ts',
    'lib/payoutTiming.ts',
    'lib/hostDebt.ts',
    'lib/refundSpread.ts',
    'lib/fees.ts',
    'lib/pricing.ts',
    'lib/cancellation.ts',
    'scripts/seed-payments.mjs',
    'scripts/payout-scenarios.mjs',
    'scripts/refund-scenarios.mjs',
    'scripts/balance-scenarios.mjs',
    'scripts/crosscutting-scenarios.mjs',
];

/**
 * A hash per watched file.
 *
 * Per file rather than one total, so a failure can name what moved instead of
 * saying "something did". Contents, not modification times: a fresh checkout
 * and a CI runner have neither the same mtimes nor the same clock, and this
 * has to mean the same thing everywhere.
 */
function fingerprint() {
    const out = {};
    for (const rel of WATCHED) {
        const full = path.join(ROOT, rel);
        out[rel] = fs.existsSync(full)
            ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16)
            : 'absent';
    }
    return out;
}

function resultsPath() {
    return path.join(ROOT, RESULTS_FILE);
}

function readResults() {
    try {
        return JSON.parse(fs.readFileSync(resultsPath(), 'utf8'));
    } catch (err) {
        return null;
    }
}

/**
 * Record one runner's outcome.
 *
 * Called by the runner itself, at the end, whether it passed or failed —
 * a failed run is evidence too, and hiding it would put the record back to
 * being a claim about a good day.
 */
function writeRunnerResults(runner, target, scenarios) {
    const existing = readResults() || { runners: {} };

    const tally = { passed: 0, failed: 0, untestable: 0 };
    const rows = scenarios.map(function (s) {
        const status = s.status || 'passed';
        if (status === 'passed') tally.passed++;
        else if (status === 'untestable') tally.untestable++;
        else tally.failed++;
        return {
            number: String(s.number),
            title: s.title,
            status: status,
            failedChecks: (s.checks || [])
                .filter(function (c) { return !c.ok; })
                .map(function (c) { return c.description; }),
        };
    });

    existing.runners = existing.runners || {};
    existing.runners[runner] = {
        ranAt: new Date().toISOString(),
        target: target,
        passed: tally.passed,
        failed: tally.failed,
        untestable: tally.untestable,
        scenarios: rows,
    };

    existing.updatedAt = new Date().toISOString();
    existing.fingerprint = fingerprint();

    fs.writeFileSync(resultsPath(), JSON.stringify(existing, null, 2) + '\n');
    return existing.runners[runner];
}

module.exports = { WATCHED, RESULTS_FILE, fingerprint, readResults, resultsPath, writeRunnerResults };
