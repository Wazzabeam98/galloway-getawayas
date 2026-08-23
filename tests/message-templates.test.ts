// Which template a booking gets.
//
// A host with three cottages needs three different check-in messages, so there
// can be several templates of one type and something must choose. Two places
// ask — the scheduled sender and the welcome posted the moment a host accepts
// — and if they ever disagreed it would look like a guest being sent another
// property's door code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveTemplate,
    coversListing,
    isCatchAll,
    hasScopeClash,
    coverage,
} from '../lib/messageTemplates';

const tpl = (over: any = {}) => Object.assign({
    id: 't1', user_id: 'h1', template_type: 'checkin_details',
    body: 'x', enabled: true, anchor: 'check_in',
    days_offset: 1, send_hour: 10,
    minutes_after: null, hours_after: null, hours_before: null,
    created_at: '2026-01-01T00:00:00Z',
    listingIds: [] as string[],
}, over);

/* ------------------------------------------------------------ precedence */

test('a template naming the listing beats one left open to everything', () => {
    const fallback = tpl({ id: 'default', listingIds: [] });
    const specific = tpl({ id: 'harbour', listingIds: ['harbour'] });

    const won = resolveTemplate([fallback, specific], 'checkin_details', 'harbour');
    assert.equal(won!.id, 'harbour', 'the property-specific one, not the default');

    // Order must not matter. Walking templates instead of bookings is how the
    // old sender would have picked whichever came back first.
    const other = resolveTemplate([specific, fallback], 'checkin_details', 'harbour');
    assert.equal(other!.id, 'harbour');
});

test('a listing with no specific template falls back to the catch-all', () => {
    const fallback = tpl({ id: 'default', listingIds: [] });
    const specific = tpl({ id: 'harbour', listingIds: ['harbour'] });

    const won = resolveTemplate([fallback, specific], 'checkin_details', 'townhouse');
    assert.equal(won!.id, 'default');
});

test('nothing at all resolves to nothing, not to someone else’s template', () => {
    const other = tpl({ id: 'harbour', listingIds: ['harbour'] });
    assert.equal(resolveTemplate([other], 'checkin_details', 'townhouse'), null);
    assert.equal(resolveTemplate([], 'checkin_details', 'harbour'), null);
});

test('a different type is never substituted', () => {
    const checkout = tpl({ id: 'c', template_type: 'checkout_details' });
    assert.equal(resolveTemplate([checkout], 'checkin_details', 'harbour'), null);
});

test('a disabled template does not win, and does not block the fallback', () => {
    const fallback = tpl({ id: 'default', listingIds: [] });
    const off = tpl({ id: 'harbour', listingIds: ['harbour'], enabled: false });

    const won = resolveTemplate([off, fallback], 'checkin_details', 'harbour');
    assert.equal(won!.id, 'default', 'switching the specific one off falls back rather than sending nothing');

    assert.equal(resolveTemplate([off], 'checkin_details', 'harbour'), null);
});

test('exactly one template is chosen, so a guest gets one message', () => {
    const a = tpl({ id: 'a', listingIds: ['harbour'] });
    const b = tpl({ id: 'b', listingIds: [] });
    const c = tpl({ id: 'c', listingIds: [] });

    const won = resolveTemplate([a, b, c], 'checkin_details', 'harbour');
    assert.ok(won);
    assert.equal(won!.id, 'a');
});

/* ------------------------------------------------------------- tie-break */

// The database refuses two templates of a type naming the same listing, so
// this should be unreachable. It exists because "should never" is not
// "cannot" — a row from before the constraint, or somebody working round it,
// must still produce the same answer on every run.
test('a clash is broken by oldest, deterministically', () => {
    const older = tpl({ id: 'older', listingIds: ['harbour'], created_at: '2026-01-01T00:00:00Z' });
    const newer = tpl({ id: 'newer', listingIds: ['harbour'], created_at: '2026-06-01T00:00:00Z' });

    assert.equal(resolveTemplate([newer, older], 'checkin_details', 'harbour')!.id, 'older');
    assert.equal(resolveTemplate([older, newer], 'checkin_details', 'harbour')!.id, 'older');
});

test('a clash to the same millisecond still resolves the same way every time', () => {
    const a = tpl({ id: 'aaa', listingIds: ['harbour'], created_at: '2026-01-01T00:00:00Z' });
    const b = tpl({ id: 'bbb', listingIds: ['harbour'], created_at: '2026-01-01T00:00:00Z' });

    assert.equal(resolveTemplate([a, b], 'checkin_details', 'harbour')!.id, 'aaa');
    assert.equal(resolveTemplate([b, a], 'checkin_details', 'harbour')!.id, 'aaa');
});

test('two catch-alls of a type do not tie randomly either', () => {
    const a = tpl({ id: 'a', listingIds: [], created_at: '2026-01-01T00:00:00Z' });
    const b = tpl({ id: 'b', listingIds: [], created_at: '2026-02-01T00:00:00Z' });
    assert.equal(resolveTemplate([b, a], 'checkin_details', 'anything')!.id, 'a');
});

test('a clash is reportable, not just survivable', () => {
    const a = tpl({ id: 'a', listingIds: ['harbour'] });
    const b = tpl({ id: 'b', listingIds: ['harbour'] });
    const fallback = tpl({ id: 'd', listingIds: [] });

    assert.equal(hasScopeClash([a, b], 'checkin_details', 'harbour'), true);
    assert.equal(hasScopeClash([a, fallback], 'checkin_details', 'harbour'), false,
        'a specific one plus a default is the intended arrangement, not a clash');
    assert.equal(hasScopeClash([a, b], 'checkin_details', 'townhouse'), false);
});

/* --------------------------------------------------------------- scoping */

test('scope reading', () => {
    assert.equal(isCatchAll(tpl({ listingIds: [] })), true);
    assert.equal(isCatchAll(tpl({ listingIds: ['x'] })), false);
    assert.equal(coversListing(tpl({ listingIds: [] }), 'anything'), true);
    assert.equal(coversListing(tpl({ listingIds: ['x'] }), 'x'), true);
    assert.equal(coversListing(tpl({ listingIds: ['x'] }), 'y'), false);
});

/* -------------------------------------------------------------- coverage */

test('the grid says what covers each listing, and where the gap is', () => {
    const templates = [
        tpl({ id: 'default-in', template_type: 'checkin_details', listingIds: [] }),
        tpl({ id: 'harbour-in', template_type: 'checkin_details', listingIds: ['harbour'] }),
        tpl({ id: 'out', template_type: 'checkout_details', listingIds: ['harbour'] }),
    ];
    const cells = coverage(templates, ['harbour', 'townhouse'], ['checkin_details', 'checkout_details']);
    const at = (l: string, t: string) => cells.filter((c) => c.listingId === l && c.templateType === t)[0];

    assert.equal(at('harbour', 'checkin_details').state, 'specific');
    assert.equal(at('harbour', 'checkin_details').templateId, 'harbour-in');
    assert.equal(at('townhouse', 'checkin_details').state, 'default', 'covered by the catch-all');
    assert.equal(at('harbour', 'checkout_details').state, 'specific');
    assert.equal(
        at('townhouse', 'checkout_details').state,
        'none',
        'the gap — this is the cell the whole grid exists for'
    );
});

// The mistake this is built to catch: narrowing the catch-all to some
// properties and forgetting the rest, which is how a guest ends up with no
// check-in message at all.
test('narrowing the only template leaves the other listings uncovered', () => {
    const narrowed = [tpl({ id: 'only', listingIds: ['harbour'] })];
    const cells = coverage(narrowed, ['harbour', 'townhouse', 'cottage'], ['checkin_details']);

    assert.equal(cells.filter((c) => c.state === 'none').length, 2);
    assert.deepEqual(
        cells.filter((c) => c.state === 'none').map((c) => c.listingId).sort(),
        ['cottage', 'townhouse']
    );
});

test('a switched-off template reads as disabled, not as an oversight', () => {
    const off = [tpl({ id: 'off', listingIds: [], enabled: false })];
    const cells = coverage(off, ['harbour'], ['checkin_details']);

    assert.equal(
        cells[0].state,
        'disabled',
        'turning something off is a decision; having nothing is usually not'
    );
});
