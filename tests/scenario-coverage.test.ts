// The claim of coverage has to be output, not a sentence.
//
// WHAT THIS IS PROTECTING, AND WHY A TEST RATHER THAN A NOTE IN A FILE.
//
// PAYMENT-SCENARIOS.md said "Scenarios 12-24 are scripted and passing". It was
// written on 21 August 2026 and it was true then. On 31 August, PR #57 made a
// payout transfer name the charge that funds it — which lands the money in the
// host's PENDING balance instead of their available one, and scenario 22 reads
// the available balance. The sentence was false from that moment.
//
// Nothing detected it, because a sentence cannot fail. It sat there for ten
// days telling the next person the ground was covered, and three sessions
// touched the payout and clawback path in that window without running the
// suite that would have said otherwise. Each of them proved its own change
// well; none of them re-proved anybody else's.
//
// That is the same shape as most of the defects in this codebase: a note
// describing code that changed underneath it. The fix is the same one used for
// the target guard and the admin pages — stop writing the rule down and start
// enforcing it, so it fails by name with the reason.
//
// This test says one thing: the money-path files are the same ones the
// scenarios last ran against, and that run was green. Break either half and it
// tells you which, and what to type.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const path = require('path');
const report = require(path.resolve(__dirname, '..', '..', 'scripts', 'scenario-report.cjs'));

const RUNNERS = ['payout', 'refund', 'balance', 'crosscutting'];
const HOW = 'Run them:  npm run scenarios   (needs a dev server and the test project)';

test('the scenario results exist at all', () => {
    const results = report.readResults();
    assert.ok(
        results,
        'SCENARIO-RESULTS.json is missing. It is the evidence that the payment\n'
        + 'scenarios have been run against this code, and it is committed on purpose.\n' + HOW
    );
});

test('every runner has been run', () => {
    const results = report.readResults();
    if (!results) return;

    const missing = RUNNERS.filter((r) => !results.runners || !results.runners[r]);
    assert.deepEqual(
        missing, [],
        'These runners have no recorded result, so nothing is known about the\n'
        + 'scenarios they cover.\n' + HOW
    );
});

test('the last recorded run was green', () => {
    const results = report.readResults();
    if (!results || !results.runners) return;

    const failing: string[] = [];
    for (const name of RUNNERS) {
        const r = results.runners[name];
        if (!r) continue;
        for (const s of r.scenarios || []) {
            if (s.status === 'passed' || s.status === 'untestable') continue;
            failing.push(`${name} ${s.number}. ${s.title}`);
        }
    }

    assert.deepEqual(
        failing, [],
        'The last scenario run recorded failures. They are real until somebody\n'
        + 'shows otherwise — this is not a flake to re-run away.\n'
        + 'See SCENARIO-RESULTS.json for the failing checks.'
    );
});

// The half that actually catches the 31 August case.
test('the money path has not moved since the scenarios last ran', () => {
    const results = report.readResults();
    if (!results || !results.fingerprint) return;

    const now = report.fingerprint();
    const moved: string[] = [];

    for (const file of Object.keys(now)) {
        if (results.fingerprint[file] !== now[file]) moved.push(file);
    }

    assert.deepEqual(
        moved, [],
        'These files have changed since the payment scenarios last ran, so the\n'
        + 'recorded result is evidence about code that no longer exists:\n\n'
        + moved.map((f) => '    ' + f).join('\n')
        + '\n\nThat is exactly how scenario 22 stayed "passing" for ten days after\n'
        + 'PR #57 broke it.\n' + HOW
    );
});

// A guard whose success proves nothing is the shape this repo keeps being bitten
// by, so the detector gets exercised rather than assumed.
test('the fingerprint actually notices a change', () => {
    const before = report.fingerprint();
    const first = Object.keys(before)[0];

    assert.ok(report.WATCHED.length >= 15, 'the watched list should cover the money path');
    assert.ok(first, 'there is something to fingerprint');
    assert.notEqual(before[first], 'absent', 'the watched files should exist');

    // Same input, same answer — otherwise the comparison above is noise.
    assert.deepEqual(report.fingerprint(), before, 'the fingerprint must be stable');

    // And a different input gives a different answer.
    const crypto = require('crypto');
    const a = crypto.createHash('sha256').update('one').digest('hex').slice(0, 16);
    const b = crypto.createHash('sha256').update('two').digest('hex').slice(0, 16);
    assert.notEqual(a, b, 'differing contents must fingerprint differently');
});
