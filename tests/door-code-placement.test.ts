// Where the door code is asked for, and when.
//
// It used to sit beside the house rules — surrounded by guest-facing copy,
// which is the wrong company for a credential, and asked of every host
// regardless of how their guests actually get in. It now lives under "How
// guests get in" and only appears for the methods that involve a code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodNeedsCode, codeHintFor } from '../lib/checkInMethods';

test('a code is asked for only where there is one', () => {
    assert.equal(methodNeedsCode('Lockbox'), true);
    assert.equal(methodNeedsCode('Smart lock'), true);
    assert.equal(methodNeedsCode('Keypad'), true);
});

test('the methods with no code are not asked for one', () => {
    // Asking a host who meets guests at the door for a "door code" is noise,
    // and noise is what teaches people to skip a field that sometimes matters.
    assert.equal(methodNeedsCode('Host greets you'), false);
    assert.equal(methodNeedsCode('Keys collected nearby'), false);
    assert.equal(methodNeedsCode('Building staff'), false);
});

test('no method chosen yet is not a method that needs a code', () => {
    assert.equal(methodNeedsCode(''), false);
    assert.equal(methodNeedsCode(null), false);
    assert.equal(methodNeedsCode(undefined), false);
});

test('an unrecognised method does not silently ask for a code', () => {
    // If a new method is added to the picker, it has to be added here too —
    // defaulting to "yes, ask" would put a credential field under, say,
    // "Doorman", which is exactly the miscategorisation being fixed.
    assert.equal(methodNeedsCode('Something new'), false);
});

test('the field calls itself what the method actually is', () => {
    assert.match(codeHintFor('Smart lock'), /smart lock/i);
    assert.match(codeHintFor('Keypad'), /keypad/i);
    assert.match(codeHintFor('Lockbox'), /lockbox/i);
    // The placeholder is still {lockbox_code} and is deliberately not renamed
    // — a host may already have it in a message — but the field should not
    // call a keypad a lockbox.
    assert.doesNotMatch(codeHintFor('Keypad'), /lockbox/i);
});
