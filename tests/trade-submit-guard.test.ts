// The server-side wall on submitting a trade for review. tradeSubmitBlock is
// the shared rule behind both submission paths: the signed-in one (the SQL in
// submit_service_provider) and the anonymous /api/services/finish route. It
// re-checks, against the stored row, the two rules the wizard already enforces —
// a non-empty description and a way to price the job — and holds a guest
// experience to its own one rule, a description of a sentence or two.

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

test('a guest experience needs a description, and nothing else from this wall', () => {
    // Until 5 Oct 2026 a guest was never blocked here — its description rule
    // lived only in the browser. Now it is the guest half of the wall: "What
    // happens" (its description), at least MIN_DESCRIPTION characters. It still
    // prices per item, so no quote, hourly rate or flat fee is asked of it.
    const said = 'We meet at the slipway at 7 and swim for forty minutes.';
    assert.match(tradeSubmitBlock({ audience: 'guest', description: '' }) || '', /description/);
    assert.match(tradeSubmitBlock({ audience: 'guest', description: 'A swim.' }) || '', /description/);
    assert.equal(tradeSubmitBlock({ audience: 'guest', description: said, provides_quote: false, hourly_rate: 0, flat_fee: 0 }), null);
});

test('the database wall and this one use the same minimum', () => {
    // submit_service_provider() hard-codes 40; MIN_DESCRIPTION is the wizard's.
    // If either moves, both must.
    const fs = require('fs');
    const path = require('path');
    const { MIN_DESCRIPTION } = require('@/lib/serviceProviders');
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const latest = fs.readdirSync(dir).filter((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')
        .includes('function "public"."submit_service_provider"')).sort().pop();
    const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
    assert.match(sql, new RegExp("v_audience = 'guest' and char_length\\(btrim\\(coalesce\\(v_description, ''\\)\\)\\) < " + MIN_DESCRIPTION));
});

test('a host trade no longer needs a separate service, but still needs a coverage area', () => {
    // The trade a provider picks on the first screen IS what they do, so the
    // submit wall dropped the "needs at least one service" raise (Liam, 8 Oct
    // 2026). The coverage-area raise stays. Asserted on the latest definition.
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const latest = fs.readdirSync(dir).filter((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')
        .includes('function "public"."submit_service_provider"')).sort().pop();
    const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
    assert.doesNotMatch(sql, /raise exception 'a trade listing needs at least one service/);
    assert.match(sql, /raise exception 'a trade listing needs at least one coverage area/);
});

test('the submit wall requires the CURRENT agreement version, matching lib/agreements', () => {
    // submit_service_provider() requires an acceptance AT the current version,
    // not merely that one exists (Liam, 8 Oct 2026) — a wording bump forces
    // re-acceptance server-side. The RPC is a browser call with no server route
    // between it and lib/agreements, so the required version is carried in the
    // function body; this keeps it in step with AGREEMENTS the way the 40 above
    // is kept in step with MIN_DESCRIPTION. If a version bumps in lib/agreements
    // without a new migration, this fails — two edits, never one.
    const fs = require('fs');
    const path = require('path');
    const { AGREEMENTS } = require('@/lib/agreements');
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const latest = fs.readdirSync(dir).filter((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')
        .includes('function "public"."submit_service_provider"')).sort().pop();
    const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
    // The version is actually required (joined onto the existence check), not
    // just mentioned.
    assert.match(sql, /"version" = v_required_version/);
    // And the carried versions are the current ones for the two documents this
    // function gates.
    assert.ok(sql.includes(AGREEMENTS.tradesperson.version),
        'migration must carry the current tradesperson agreement version ' + AGREEMENTS.tradesperson.version);
    assert.ok(sql.includes(AGREEMENTS.experience_provider.version),
        'migration must carry the current experience_provider agreement version ' + AGREEMENTS.experience_provider.version);
});
