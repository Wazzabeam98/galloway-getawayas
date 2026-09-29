// The server-side wall on submitting a trade for review. tradeSubmitBlock is
// the shared rule behind both submission paths: the signed-in one (the SQL in
// submit_service_provider) and the anonymous /api/services/finish route. It
// re-checks, against the stored row, the two rules the wizard already enforces —
// a non-empty description and a way to price the job — and leaves guest
// experiences alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { tradeSubmitBlock } = require('@/lib/serviceProviders');

// A host row that satisfies both rules — the baseline a real submission has.
const okTrade = {
    audience: 'host',
    description: 'Second fix, sash windows and fitted furniture.',
    provides_quote: true,
    hourly_rate: null,
    flat_fee: null,
};

test('a complete host trade may be submitted', () => {
    assert.equal(tradeSubmitBlock(okTrade), null);
});

test('a host trade with no description is refused', () => {
    assert.match(tradeSubmitBlock({ ...okTrade, description: '' }) || '', /description/);
    assert.match(tradeSubmitBlock({ ...okTrade, description: '   ' }) || '', /description/);
    assert.match(tradeSubmitBlock({ ...okTrade, description: null }) || '', /description/);
});

test('a host trade with no way to price is refused', () => {
    const noPrice = { ...okTrade, provides_quote: false, hourly_rate: null, flat_fee: null };
    assert.match(tradeSubmitBlock(noPrice) || '', /price/);
    // Zero or blank is not a price.
    assert.match(tradeSubmitBlock({ ...noPrice, hourly_rate: 0, flat_fee: '' }) || '', /price/);
});

test('any one of quote, hourly rate or flat fee is enough', () => {
    const base = { ...okTrade, provides_quote: false, hourly_rate: null, flat_fee: null };
    assert.equal(tradeSubmitBlock({ ...base, provides_quote: true }), null);
    assert.equal(tradeSubmitBlock({ ...base, hourly_rate: 35 }), null);
    assert.equal(tradeSubmitBlock({ ...base, flat_fee: '90' }), null);
});

test('the description gate is checked before the price gate', () => {
    // With both missing, the description reason comes first — the order the
    // function checks them, so the message a caller surfaces is stable.
    const both = { audience: 'host', description: '', provides_quote: false };
    assert.match(tradeSubmitBlock(both) || '', /description/);
});

test('a guest experience is never blocked here', () => {
    // A guest prices per menu item and its "description" is the what-to-expect
    // field — a different shape with its own gate — so this wall does not apply.
    assert.equal(tradeSubmitBlock({ audience: 'guest', description: '', provides_quote: false }), null);
    assert.equal(tradeSubmitBlock({ audience: 'guest', description: '', hourly_rate: 0, flat_fee: 0 }), null);
});
