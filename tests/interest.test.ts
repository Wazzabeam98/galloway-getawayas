// The one place that decides whether a register-interest body is valid, pinned
// without a server. A miss here is either a real registration bounced or junk
// stored — the route trusts this and does nothing else with the raw body.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseInterest, INTEREST_CATEGORIES, REGION_KEYS } from '../lib/interest';

const good = {
    category: 'holiday_let',
    name: 'Ada Host',
    email: 'ADA@Example.com',
    phone: '01557 000000',
    region: 'stewartry',
    notes: 'Two cottages near Kirkcudbright.',
};

test('a complete submission parses and normalises', () => {
    const r = parseInterest(good);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.category, 'holiday_let');
    assert.equal(r.value.name, 'Ada Host');
    // Email is lowercased so the dedupe index and every read agree.
    assert.equal(r.value.email, 'ada@example.com');
    assert.equal(r.value.region, 'stewartry');
    assert.equal(r.value.notes, 'Two cottages near Kirkcudbright.');
});

test('phone, region and notes are optional and come back null when blank', () => {
    const r = parseInterest({ category: 'tradesman', name: 'Bob', email: 'bob@trade.co', phone: '', region: '', notes: '' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.phone, null);
    assert.equal(r.value.region, null);
    assert.equal(r.value.notes, null);
});

test('a category outside the three is refused', () => {
    for (const bad of ['', 'holiday', 'admin', 'guest', undefined]) {
        const r = parseInterest({ ...good, category: bad });
        assert.equal(r.ok, false, 'category ' + JSON.stringify(bad) + ' should be refused');
    }
    // And the three real ones are accepted.
    for (const c of INTEREST_CATEGORIES) {
        assert.equal(parseInterest({ ...good, category: c }).ok, true);
    }
});

test('a name is required', () => {
    assert.equal(parseInterest({ ...good, name: '   ' }).ok, false);
});

test('an email needs an @ with something either side and a dot', () => {
    for (const bad of ['', 'nope', 'a@b', 'a@b.', '@example.com', 'ada@']) {
        assert.equal(parseInterest({ ...good, email: bad }).ok, false, bad + ' should be refused');
    }
});

test('a region, when given, must be a canonical GUEST_REGIONS key', () => {
    assert.equal(parseInterest({ ...good, region: 'cumbria' }).ok, false);
    for (const key of REGION_KEYS) {
        assert.equal(parseInterest({ ...good, region: key }).ok, true, key + ' should be accepted');
    }
});

test('free text is capped, not rejected, when overlong', () => {
    const r = parseInterest({ ...good, name: 'x'.repeat(500), notes: 'y'.repeat(5000) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.value.name.length <= 120);
    assert.ok((r.value.notes || '').length <= 1000);
});
