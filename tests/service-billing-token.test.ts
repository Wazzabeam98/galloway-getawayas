// The card link.
//
// It is derived rather than minted, which is the unusual choice, so this is
// mostly about the two properties that choice buys and the one it costs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { billingTokenFor, hashBillingToken, billingSecret } = require('../lib/serviceBillingToken');

const SECRET = 'test-billing-secret';

function withSecret<T>(value: string | undefined, fn: () => T): T {
    const before = process.env.BILLING_TOKEN_SECRET;
    if (value === undefined) delete process.env.BILLING_TOKEN_SECRET;
    else process.env.BILLING_TOKEN_SECRET = value;
    try {
        return fn();
    } finally {
        if (before === undefined) delete process.env.BILLING_TOKEN_SECRET;
        else process.env.BILLING_TOKEN_SECRET = before;
    }
}

// THE PROPERTY THE WHOLE DESIGN EXISTS FOR. The link goes in four emails sent
// weeks apart, and a man who opens the fourteen-day email three days late must
// not be told his link is dead.
test('the same provider always gets the same link', () => {
    withSecret(SECRET, () => {
        const a = billingTokenFor('provider-1');
        const b = billingTokenFor('provider-1');
        assert.equal(a, b);
    });
});

test('two providers never get the same link', () => {
    withSecret(SECRET, () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) seen.add(billingTokenFor('provider-' + i));
        assert.equal(seen.size, 200);
    });
});

// The cost of deriving rather than minting: the secret is load-bearing. If it
// changed, every link in every inbox would stop working at once.
test('a different secret is a different link', () => {
    const a = withSecret(SECRET, () => billingTokenFor('provider-1'));
    const b = withSecret('another-secret', () => billingTokenFor('provider-1'));
    assert.notEqual(a, b);
});

// Fails closed. The caller refuses to send an email whose button goes nowhere
// rather than sending one and hearing about it from the tradesman.
test('with no secret there is no link, rather than a broken one', () => {
    withSecret(undefined, () => {
        assert.equal(billingSecret(), null);
        assert.equal(billingTokenFor('provider-1'), null);
    });
});

test('a missing provider id yields no link', () => {
    withSecret(SECRET, () => {
        assert.equal(billingTokenFor(''), null);
    });
});

test('the link survives being pasted into a URL, and is not the stored value', () => {
    withSecret(SECRET, () => {
        const token = billingTokenFor('provider-1');

        assert.equal(token.length, 32, 'the same length as a reply link');
        assert.match(token, /^[A-Za-z0-9_-]+$/);

        const hash = hashBillingToken(token);
        assert.match(hash, /^[0-9a-f]{64}$/, 'sha256 hex');
        assert.notEqual(hash, token, 'the token itself must never be the stored value');
        assert.equal(hash.indexOf(token), -1, 'not recoverable from the hash');
    });
});

test('an empty token hashes to something, and to nothing findable', () => {
    // The billing page hashes whatever is in the URL, including nothing at
    // all: a bare /services/billing/ must be a 404, not a 500.
    const empty = hashBillingToken('');
    assert.match(empty, /^[0-9a-f]{64}$/);
    assert.equal(hashBillingToken(undefined as any), empty);
    assert.equal(hashBillingToken(null as any), empty);

    withSecret(SECRET, () => {
        assert.notEqual(empty, hashBillingToken(billingTokenFor('provider-1')));
    });
});
