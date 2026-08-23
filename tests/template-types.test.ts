// The kinds of scheduled message.
//
// One definition, because it used to live in two — the editor and the coverage
// grid each had their own copy, and a label meaning different things in
// different places is a label nobody trusts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_TYPES, templateDefFor } from '../lib/templateTypes';

test('every kind the sender knows about has a definition', () => {
    // These four keys are what `template_type` is allowed to be. A key here
    // with no definition, or a definition with no key, means a host sees a
    // blank row or cannot create a kind that the sender would happily send.
    const keys = TEMPLATE_TYPES.map((d) => d.key).sort();
    assert.deepEqual(keys, ['booking_confirmation', 'checkin_day', 'checkin_details', 'checkout_details']);
});

test('the settling-in message is not called "checking in"', () => {
    // It fires an hour or so after arrival. "Checking in with guest" reads as
    // the note you get when you book — which is a different template entirely.
    const settling = templateDefFor('checkin_day');
    assert.equal(settling.label, 'Settling in');
    assert.doesNotMatch(settling.label, /checking in/i);
    assert.notEqual(settling.label, templateDefFor('booking_confirmation').label);
});

test('no two kinds share a label', () => {
    const labels = TEMPLATE_TYPES.map((d) => d.label);
    assert.equal(new Set(labels).size, labels.length, 'two rows reading the same is the thing being fixed');
});

test('the check-in example uses the placeholder, not a made-up code', () => {
    // The example is the first thing a host edits. One showing a literal code
    // teaches the habit {lockbox_code} exists to replace.
    const checkin = templateDefFor('checkin_details');
    assert.match(checkin.placeholder, /\{lockbox_code\}/);
    assert.doesNotMatch(checkin.placeholder, /code is \d{4}/, 'no digits standing in for a real code');
    assert.doesNotMatch(checkin.placeholder, /code 1234/);
});

test('an unknown key falls back rather than returning undefined', () => {
    assert.ok(templateDefFor('something_else'));
    assert.ok(templateDefFor('').label);
});
