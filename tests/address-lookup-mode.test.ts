// Only the live site spends Ideal Postcodes credits (lib/addressLookupMode.ts).
// Previews, local dev and every session walking a sign-up against TEST used the
// same paid allowance as real guests; off production the routes now answer from
// a fake keyed on Ideal's test postcode ID1 1QD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveAddressLookup, fakeAutocomplete, fakeAddress } from '../lib/addressLookupMode';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

test('only the production deployment makes real lookups', () => {
    assert.equal(liveAddressLookup({ VERCEL_ENV: 'production' }), true);
    assert.equal(liveAddressLookup({ VERCEL_ENV: 'preview' }), false);
    assert.equal(liveAddressLookup({ VERCEL_ENV: 'development' }), false);
    assert.equal(liveAddressLookup({}), false, 'local next dev has no VERCEL_ENV');
    assert.equal(liveAddressLookup({ NODE_ENV: 'production' }), false, 'a local production build is still not the live site');
});

test('ID1 1QD finds test addresses that resolve to a full D&G-shaped address', () => {
    for (const typed of ['ID1 1QD', 'id11qd', 'ID1 1', 'ID1']) {
        const r = fakeAutocomplete(typed);
        assert.equal(r.status, 200, typed);
        assert.ok(r.body.suggestions.length > 0, typed + ' should suggest');
    }
    const first = fakeAutocomplete('ID1 1QD').body.suggestions[0];
    const a = fakeAddress(first.id)!;
    assert.equal(a.postcode, 'ID1 1QD');
    assert.equal(a.town, 'Kirkcudbright');
    assert.ok(a.street);
});

test('anything else searched off production suggests nothing (and spends nothing)', () => {
    assert.deepEqual(fakeAutocomplete('DG6 4JA').body, { ok: true, suggestions: [] });
    assert.deepEqual(fakeAutocomplete('12 High Street').body, { ok: true, suggestions: [] });
    assert.equal(fakeAddress('il_somethingreal'), null);
});

test('ID1 CLIP answers like a spent allowance, so the type-it-by-hand path can be walked', () => {
    const r = fakeAutocomplete('ID1 CLIP');
    // Same as the live route on Ideal's 402: not ok, a 502 — which every address
    // form turns into "enter it by hand".
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /402/);
});

test('both address routes decide live-or-fake before anything can reach Ideal Postcodes', () => {
    for (const rel of ['app/api/address/autocomplete/route.ts', 'app/api/address/get/route.ts']) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const gate = src.indexOf('if (!liveAddressLookup())');
        const call = src.indexOf('api.ideal-postcodes.co.uk');
        assert.ok(gate !== -1, rel + ' must check liveAddressLookup()');
        assert.ok(call === -1 || gate < call, rel + ' must check liveAddressLookup() before building the Ideal Postcodes URL');
    }
});
