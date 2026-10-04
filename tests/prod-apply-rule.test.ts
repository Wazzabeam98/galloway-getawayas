// When scripts/migrate.mjs may apply a migration to PRODUCTION.
//
// Sessions may apply production migrations themselves (Liam, 4 October 2026),
// but only from the branch the migration lives on, with the file committed
// there, and never with --destructive. The rule lives in
// scripts/prodApplyRule.cjs so it can be loaded here without .env.local or a
// database — the same reason sqlRisk.cjs exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const path = require('path');
/* eslint-disable @typescript-eslint/no-var-requires */
const { prodApplyProblem } = require(
    path.resolve(__dirname, '..', '..', 'scripts', 'prodApplyRule.cjs')
);

const ok = {
    targetName: 'prod',
    apply: true,
    destructiveFlag: false,
    branch: 'fix/hidden-listing-no-bookings',
    fileCommittedUnchanged: true,
};

test('a committed migration on its own branch may be applied to production', () => {
    assert.equal(prodApplyProblem(ok), null);
});

test('never from master or main — the superseded-migration accident', () => {
    assert.match(prodApplyProblem({ ...ok, branch: 'master' }), /never master/);
    assert.match(prodApplyProblem({ ...ok, branch: 'main' }), /never main/);
});

test('never from a detached HEAD, which names no branch', () => {
    assert.match(prodApplyProblem({ ...ok, branch: 'HEAD' }), /detached/);
    assert.match(prodApplyProblem({ ...ok, branch: null }), /detached/);
});

test('never an uncommitted or edited file — production gets what the PR shows', () => {
    assert.match(prodApplyProblem({ ...ok, fileCommittedUnchanged: false }), /not committed/);
});

test('never --destructive on production, even from the right branch', () => {
    assert.match(prodApplyProblem({ ...ok, destructiveFlag: true }), /never used on production/);
});

test('TEST and non-applying runs are not touched by this rule', () => {
    assert.equal(prodApplyProblem({ ...ok, targetName: 'test', branch: 'master', destructiveFlag: true }), null);
    assert.equal(prodApplyProblem({ ...ok, apply: false, branch: 'master' }), null);
});
