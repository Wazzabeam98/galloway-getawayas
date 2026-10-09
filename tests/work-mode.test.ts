// Which side someone lands on (lib/workMode): Airbnb's rule, remembered per
// browser in gg_mode. An approved host or provider who has never chosen is on
// their working side; anyone who switched is kept where they switched to; a
// plain guest is always travelling, whatever a shared browser remembers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const m = require('../lib/workMode');
/* eslint-enable @typescript-eslint/no-var-requires */

const guest = { isHost: false, isApprovedHost: false, isProvider: false };
const approvedHost = { isHost: true, isApprovedHost: true, isProvider: false };
const draftHost = { isHost: true, isApprovedHost: false, isProvider: false };
const provider = { isHost: false, isApprovedHost: false, isProvider: true };
const both = { isHost: true, isApprovedHost: true, isProvider: true };

test('never having chosen, an approved host or provider is on their working side', () => {
    assert.equal(m.resolveWorkMode(undefined, approvedHost), 'host');
    assert.equal(m.resolveWorkMode(undefined, provider), 'host');
    assert.equal(m.resolveWorkMode(undefined, both), 'host');
});

test('a plain guest is travelling, even on a browser someone else left in hosting', () => {
    assert.equal(m.resolveWorkMode(undefined, guest), 'travel');
    assert.equal(m.resolveWorkMode('host', guest), 'travel');
});

test('a host still writing their first listing is travelling until they choose', () => {
    assert.equal(m.resolveWorkMode(undefined, draftHost), 'travel');
    assert.equal(m.resolveWorkMode('host', draftHost), 'host');
});

test('the side they were last on wins over the default', () => {
    assert.equal(m.resolveWorkMode('travel', approvedHost), 'travel');
    assert.equal(m.resolveWorkMode('travel', provider), 'travel');
    assert.equal(m.resolveWorkMode('host', both), 'host');
    assert.equal(m.resolveWorkMode('nonsense', approvedHost), 'host');
});

test('sign-in lands on the right dashboard, or back where they were', () => {
    assert.equal(m.landingFor(undefined, approvedHost, '/homes/1'), '/dashboard');
    assert.equal(m.landingFor(undefined, provider, '/'), '/services/dashboard');
    // A host who is also a provider works from the host dashboard — the same
    // place the navbar's switch sends them.
    assert.equal(m.landingFor(undefined, both, '/'), '/dashboard');
    // Switched to travelling: back to the page, not forced to the dashboard.
    assert.equal(m.landingFor('travel', both, '/trips'), '/trips');
    assert.equal(m.landingFor(undefined, guest, '/homes/1?from=2026-11-01'), '/homes/1?from=2026-11-01');
});

test('a hidden listing still counts as approved; drafts and pending do not', () => {
    assert.deepEqual(m.APPROVED_LISTING_STATUSES.slice().sort(), ['hidden', 'published']);
});
