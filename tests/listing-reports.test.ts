// The one shared rule for a valid listing report. The modal and the server
// route both run validateReport, so this pins the behaviour they agree on:
// a reason that must be one of the fixed keys, and a detail line that must be
// present. A report that passed the client but failed the server (or the other
// way round) is exactly the drift this guards against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    validateReport,
    REPORT_REASONS,
    REPORT_DETAILS_MAX,
    reasonLabel,
} = require('../lib/listingReports');

test('accepts a known reason with detail, trimmed', () => {
    const r = validateReport({ reason: 'scam', details: '  it asks to pay off-site  ' });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'scam');
    assert.equal(r.details, 'it asks to pay off-site');
});

test('rejects a missing or unknown reason', () => {
    assert.equal(validateReport({ details: 'something' }).ok, false);
    assert.equal(validateReport({ reason: '', details: 'something' }).ok, false);
    assert.equal(validateReport({ reason: 'not_a_real_key', details: 'something' }).ok, false);
});

test('rejects an empty or whitespace-only detail', () => {
    assert.equal(validateReport({ reason: 'offensive', details: '' }).ok, false);
    assert.equal(validateReport({ reason: 'offensive', details: '   ' }).ok, false);
    assert.equal(validateReport({ reason: 'offensive' }).ok, false);
});

test('ignores non-string input without throwing', () => {
    assert.equal(validateReport({ reason: 123 as any, details: {} as any }).ok, false);
    assert.equal(validateReport({} as any).ok, false);
});

test('caps detail at REPORT_DETAILS_MAX', () => {
    const long = 'x'.repeat(REPORT_DETAILS_MAX + 500);
    const r = validateReport({ reason: 'something_else', details: long });
    assert.equal(r.ok, true);
    assert.equal(r.details.length, REPORT_DETAILS_MAX);
});

test('every reason key has a label, and the five mirror Airbnb', () => {
    assert.equal(REPORT_REASONS.length, 5);
    const keys = REPORT_REASONS.map((r: any) => r.key);
    assert.deepEqual(keys, [
        'inaccurate_incorrect', 'not_real_place', 'scam', 'offensive', 'something_else',
    ]);
    for (const r of REPORT_REASONS) {
        assert.equal(typeof r.label, 'string');
        assert.ok(r.label.length > 0);
        assert.equal(reasonLabel(r.key), r.label);
    }
    // An unknown key falls back to itself rather than throwing.
    assert.equal(reasonLabel('mystery'), 'mystery');
});

// "It's not a real place to stay" only fits a holiday let. An experience and a
// trade profile reuse the same report form, so that one reason is worded for
// what is being reported — the stored key stays the same.
test('each kind of report offers a "not real" reason that fits it', () => {
    const { reasonsFor, reasonLabel } = require('@/lib/listingReports');
    const labels = (t: string) => reasonsFor(t).map((r: any) => r.label);
    assert.ok(labels('listing').includes('It’s not a real place to stay'));
    assert.ok(labels('experience').includes('It’s not a real experience'));
    assert.ok(labels('trade').includes('It’s not a real business'));
    for (const t of ['experience', 'trade']) {
        assert.ok(!labels(t).includes('It’s not a real place to stay'), t + ' must not offer the holiday-let wording');
    }
    // Same five reasons, same keys and order, whatever the kind.
    assert.deepEqual(reasonsFor('trade').map((r: any) => r.key), reasonsFor('listing').map((r: any) => r.key));
    assert.equal(reasonLabel('not_real_place', 'experience'), 'It’s not a real experience');
    // A holiday let, and any caller that doesn't say, keeps the original wording.
    assert.equal(reasonLabel('not_real_place'), 'It’s not a real place to stay');
});
