// The one place that decides whether a register-interest body is valid, pinned
// without a server. A miss here is either a real registration bounced or junk
// stored — the route trusts this and does nothing else with the raw body.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseInterest, INTEREST_CATEGORIES, REGION_KEYS } from '../lib/interest';

// A notes-carrying path (guest_experience) as the general fixture, so the
// name/email/region/notes checks exercise the free-text branch. The holiday-let
// property-count branch is covered by its own tests below.
const good = {
    category: 'guest_experience',
    name: 'Ada Host',
    email: 'ADA@Example.com',
    phone: '01557 000000',
    region: 'stewartry',
    notes: 'A pottery class in a barn.',
};

test('a complete submission parses and normalises', () => {
    const r = parseInterest(good);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.category, 'guest_experience');
    assert.equal(r.value.name, 'Ada Host');
    // Email is lowercased so the dedupe index and every read agree.
    assert.equal(r.value.email, 'ada@example.com');
    assert.equal(r.value.region, 'stewartry');
    assert.equal(r.value.notes, 'A pottery class in a barn.');
});

test('phone, region and notes are optional and come back null when blank', () => {
    const r = parseInterest({ category: 'tradesman', name: 'Bob', email: 'bob@trade.co', phone: '', region: '', notes: '' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.phone, null);
    assert.equal(r.value.region, null);
    assert.equal(r.value.notes, null);
    assert.equal(r.value.propertyCount, null);
});

test('holiday_let carries a property count and no notes', () => {
    const r = parseInterest({ category: 'holiday_let', name: 'Ada', email: 'ada@let.co', propertyCount: 3, notes: 'ignored on this path' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.propertyCount, 3);
    assert.equal(r.value.notes, null); // notes dropped on the holiday-let path
});

test('a missing or junk property count on holiday_let falls back to 1, not a rejection', () => {
    for (const bad of [undefined, 0, -2, 'lots', NaN]) {
        const r = parseInterest({ category: 'holiday_let', name: 'Ada', email: 'ada@let.co', propertyCount: bad });
        assert.equal(r.ok, true, JSON.stringify(bad) + ' should not reject');
        if (r.ok) assert.equal(r.value.propertyCount, 1, JSON.stringify(bad) + ' -> 1');
    }
});

test('guest_experience and tradesman carry notes and no property count', () => {
    for (const c of ['guest_experience', 'tradesman']) {
        const r = parseInterest({ category: c, name: 'Bo', email: 'bo@x.co', notes: 'pottery too', propertyCount: 5 });
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.value.notes, 'pottery too');
        assert.equal(r.value.propertyCount, null); // count ignored off the let path
    }
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
