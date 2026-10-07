// Door codes and wifi passwords are encrypted before they are stored, so a copy
// of the database shows only ciphertext — and a sealed value opens only with
// the key, only for the row it belongs to, and never quietly reads as wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { sealSecret, openSecret, isSealed } from '../lib/secretBox';

const KEY = randomBytes(32).toString('base64');
const OTHER = randomBytes(32).toString('base64');
const here = { table: 'listing_access_codes' as const, id: 'listing-1' };

function withKeys(current: string | undefined, previous: string | undefined, fn: () => void) {
    const a = process.env.LISTING_SECRETS_KEY, b = process.env.LISTING_SECRETS_KEY_PREVIOUS;
    if (current === undefined) delete process.env.LISTING_SECRETS_KEY; else process.env.LISTING_SECRETS_KEY = current;
    if (previous === undefined) delete process.env.LISTING_SECRETS_KEY_PREVIOUS; else process.env.LISTING_SECRETS_KEY_PREVIOUS = previous;
    try { fn(); } finally {
        if (a === undefined) delete process.env.LISTING_SECRETS_KEY; else process.env.LISTING_SECRETS_KEY = a;
        if (b === undefined) delete process.env.LISTING_SECRETS_KEY_PREVIOUS; else process.env.LISTING_SECRETS_KEY_PREVIOUS = b;
    }
}

test('a sealed code is unreadable at rest and opens back to itself', () => withKeys(KEY, undefined, () => {
    const sealed = sealSecret('4821', here);
    assert.ok(isSealed(sealed));
    assert.ok(!sealed.includes('4821'));
    assert.equal(openSecret(sealed, here), '4821');
}));

test('the same code seals differently every time (no pattern to compare)', () => withKeys(KEY, undefined, () => {
    assert.notEqual(sealSecret('4821', here), sealSecret('4821', here));
}));

test('a ciphertext copied onto another row, table or column will not open', () => withKeys(KEY, undefined, () => {
    const sealed = sealSecret('4821', here);
    assert.throws(() => openSecret(sealed, { table: 'listing_access_codes', id: 'listing-2' }));
    assert.throws(() => openSecret(sealed, { table: 'booking_access_codes', id: 'listing-1' }));
    assert.throws(() => openSecret(sealed, { table: 'listing_arrival', id: 'listing-1' }));
}));

test('the wrong key, or a tampered value, throws rather than showing gibberish', () => {
    let sealed = '';
    withKeys(KEY, undefined, () => { sealed = sealSecret('wifi-pass-123', { table: 'listing_arrival', id: 'l' }); });
    withKeys(OTHER, undefined, () => assert.throws(() => openSecret(sealed, { table: 'listing_arrival', id: 'l' })));
    withKeys(KEY, undefined, () => {
        const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
        assert.throws(() => openSecret(flipped, { table: 'listing_arrival', id: 'l' }));
    });
});

test('a key can be rotated: the previous key still opens old values', () => {
    let sealed = '';
    withKeys(KEY, undefined, () => { sealed = sealSecret('9999', here); });
    withKeys(OTHER, KEY, () => assert.equal(openSecret(sealed, here), '9999'));
});

test('a value stored before encryption reads as itself; nothing reads as nothing', () => withKeys(KEY, undefined, () => {
    assert.equal(openSecret('1234', here), '1234');
    assert.equal(openSecret(null, here), null);
    assert.equal(sealSecret('', here), '');
}));

test('no key: saving refuses loudly; a bad key is refused', () => {
    withKeys(undefined, undefined, () => assert.throws(() => sealSecret('1234', here), /LISTING_SECRETS_KEY is not set/));
    withKeys('too-short', undefined, () => assert.throws(() => sealSecret('1234', here), /32 bytes/));
});

test('the scripts’ copy (scripts/secretBox.cjs) and the app read each other', () => withKeys(KEY, undefined, () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scripts = require('../../scripts/secretBox.cjs');
    const fromScript = scripts.sealSecret('7731', 'booking_access_codes', 'b-9');
    assert.equal(openSecret(fromScript, { table: 'booking_access_codes', id: 'b-9' }), '7731');
    const fromApp = sealSecret('cottage-wifi', { table: 'listing_arrival', id: 'l-3' });
    assert.equal(scripts.openSecret(fromApp, 'listing_arrival', 'l-3'), 'cottage-wifi');
    assert.throws(() => scripts.openSecret(fromApp, 'listing_arrival', 'l-4'));
}));
