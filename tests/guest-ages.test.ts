import test from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { childrenAllowed, CHILD_MAX_AGE, ADULT_MIN_AGE } = require('@/lib/guestAges');

test('the fixed bands are Airbnb-style: adults 13+, children up to 12', () => {
    assert.equal(ADULT_MIN_AGE, 13);
    assert.equal(CHILD_MAX_AGE, 12);
});

test('no minimum age (null) admits children', () => {
    assert.equal(childrenAllowed(null), true);
    assert.equal(childrenAllowed(undefined), true);
});

test('a minimum of 12 still admits children — a 12-year-old is at the minimum', () => {
    assert.equal(childrenAllowed(12), true);
});

test('16+, 18+ and 21+ rule out the whole 4–12 band (adults only)', () => {
    assert.equal(childrenAllowed(16), false);
    assert.equal(childrenAllowed(18), false);
    assert.equal(childrenAllowed(21), false);
});
