// Every payment scenario, in one command.
//
//   npm run scenarios
//
// WHY THIS EXISTS
//
// Running the standing suite used to be eight commands and a rule you had to
// remember — reseed between runners, or the second one fails on state the
// first left behind. So it was not run. Between 21 and 31 August 2026 nobody
// ran it at all, and in that window PR #57 broke scenario 22 in a way that
// scenario had been written to catch. Three sessions touched the payout path
// in those ten days; each proved its own change and none ran this.
//
// One command, always the same order, always reseeded. What it costs is a few
// minutes; what it buys is knowing rather than assuming.
//
// It writes SCENARIO-RESULTS.json as it goes, and tests/scenario-coverage
// fails if the money-path files move on without it.

import { spawn } from 'node:child_process';
import { resolveTarget, LOCAL_URL } from './target.cjs';
import { readResults } from './scenario-report.cjs';

// Checked once, here, before anything is seeded: never production, never the
// production database, never a build behind master.
const SITE = await resolveTarget({
    runner: 'scripts/scenarios.mjs',
    envNames: ['SITE_URL'],
    fallback: LOCAL_URL,
});

// Order matters. Each runner leaves bookings paid out, cancelled or in debt,
// so every one gets a fresh seed first.
const RUNNERS = [
    ['payout', 'scripts/payout-scenarios.mjs'],
    ['refund', 'scripts/refund-scenarios.mjs'],
    ['balance', 'scripts/balance-scenarios.mjs'],
    ['crosscutting', 'scripts/crosscutting-scenarios.mjs'],
];

function run(file, args = []) {
    return new Promise(function (resolve) {
        const child = spawn(process.execPath, [file, ...args], {
            stdio: 'inherit',
            env: { ...process.env, SITE_URL: SITE },
        });
        child.on('close', function (code) { resolve(code === null ? 1 : code); });
    });
}

const rule = '='.repeat(72);
const outcomes = [];

for (const [name, file] of RUNNERS) {
    console.log('\n' + rule);
    console.log('SEEDING for ' + name);
    console.log(rule);

    const seeded = await run('scripts/seed-payments.mjs');
    if (seeded !== 0) {
        console.error('\nseeding failed before ' + name + ' — stopping here.');
        outcomes.push({ name, code: seeded, note: 'seed failed' });
        break;
    }

    console.log('\n' + rule);
    console.log('RUNNING ' + name);
    console.log(rule);

    const code = await run(file);
    outcomes.push({ name, code });
}

// ------------------------------------------------------------------ summary

const results = readResults();

console.log('\n' + rule);
console.log('WHERE YOU ACTUALLY STAND');
console.log(rule);

let totalPassed = 0;
let totalFailed = 0;
let totalUntestable = 0;

for (const [name] of RUNNERS) {
    const r = results && results.runners && results.runners[name];
    if (!r) {
        console.log('  ' + name.padEnd(14) + 'DID NOT RUN');
        continue;
    }
    totalPassed += r.passed;
    totalFailed += r.failed;
    totalUntestable += r.untestable;

    console.log(
        '  ' + name.padEnd(14)
        + String(r.passed).padStart(2) + ' passed  '
        + String(r.failed).padStart(2) + ' failed  '
        + String(r.untestable).padStart(2) + ' not testable here'
    );
    for (const s of r.scenarios) {
        if (s.status === 'passed') continue;
        console.log('       ' + s.status.toUpperCase() + ' ' + s.number + '. ' + s.title);
        for (const c of s.failedChecks) console.log('              - ' + c);
    }
}

console.log(rule);
console.log(
    '  ' + totalPassed + ' passed, ' + totalFailed + ' failed, '
    + totalUntestable + ' not testable here'
);
console.log('  written to SCENARIO-RESULTS.json — commit it, it is the evidence');
console.log(rule + '\n');

const worst = outcomes.find(function (o) { return o.code !== 0; });
process.exit(worst || totalFailed > 0 ? 1 : 0);
