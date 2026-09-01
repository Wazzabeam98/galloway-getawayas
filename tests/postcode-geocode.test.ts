// A postcode becomes coordinates.
//
// Publishing has demanded a postcode since 28 August 2026 and nothing did
// anything with it. Coordinates had exactly one writer in the codebase — the
// address lookup in the wizard — so a host who took the "skip to manual listing
// form" route, typed their postcode by hand and published passed every rule and
// still had none. That path is what happens whenever the lookup is out of
// quota, which is the case this exists for.
//
// Nothing is broken by a missing coordinate today: pointForListing falls back to
// the town centre. This is about the six-month version, where something sorts by
// distance and half the properties are at their town's centre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const MODULE = '@/lib/postcodeGeocode';

function load(fetchImpl: any) {
    (global as any).fetch = fetchImpl;
    clearModule(MODULE);
    return require('../lib/postcodeGeocode');
}

const ok = (lat: number, lng: number) => async () => ({
    ok: true,
    json: async () => ({ status: 200, result: { latitude: lat, longitude: lng } }),
});

/* ------------------------------------------------------------- the lookup */

test('a postcode becomes a coordinate', async () => {
    const { coordinatesForPostcode } = load(ok(54.8352, -4.0543));
    assert.deepEqual(
        await coordinatesForPostcode('DG6 4JS'),
        { latitude: 54.8352, longitude: -4.0543 }
    );
});

test('the postcode is tidied before it is asked about', async () => {
    let asked = '';
    const { coordinatesForPostcode } = load(async (url: string) => {
        asked = url;
        return { ok: true, json: async () => ({ result: { latitude: 1, longitude: 2 } }) };
    });

    await coordinatesForPostcode('dg64js');
    assert.match(asked, /DG6%204JS$/, 'a host types it however they like');
});

test('every kind of failure is the same answer', async () => {
    // The caller does the same thing with all of them, so telling them apart
    // would only be an invitation to handle them differently by accident.
    const cases: Array<[string, any]> = [
        ['a 404', async () => ({ ok: false, json: async () => ({}) })],
        ['an outage', async () => { throw new Error('ECONNREFUSED'); }],
        ['a body with no coordinates', async () => ({ ok: true, json: async () => ({ result: {} }) })],
        ['a body that is not JSON', async () => ({ ok: true, json: async () => { throw new Error('not json'); } })],
        ['0,0, which is the Atlantic', ok(0, 0)],
    ];

    for (const [what, impl] of cases) {
        const { coordinatesForPostcode } = load(impl);
        assert.equal(await coordinatesForPostcode('DG6 4JS'), null, what + ' should be null');
    }
});

test('an empty postcode never reaches the network', async () => {
    let called = false;
    const { coordinatesForPostcode } = load(async () => { called = true; return { ok: true, json: async () => ({}) }; });

    assert.equal(await coordinatesForPostcode(''), null);
    assert.equal(await coordinatesForPostcode(null), null);
    assert.equal(await coordinatesForPostcode(undefined), null);
    assert.equal(called, false);
});

/* --------------------------------------------------- when it fills, and when not */

test('a listing with no coordinates gets them', async () => {
    const { coordinatePatchFor } = load(ok(54.8352, -4.0543));
    const patch = await coordinatePatchFor(
        { postcode: 'DG6 4JS', latitude: null, longitude: null }, {}
    );
    assert.deepEqual(patch, { latitude: 54.8352, longitude: -4.0543 });
});

test('coordinates already there are left alone', async () => {
    // The address lookup is more precise than a postcode centroid. Replacing
    // one with the other would be a downgrade for no reason.
    let called = false;
    const { coordinatePatchFor } = load(async () => { called = true; return ok(1, 2)(); });

    const patch = await coordinatePatchFor(
        { postcode: 'DG6 4JS', latitude: 54.838, longitude: -4.048 }, {}
    );
    assert.deepEqual(patch, {});
    assert.equal(called, false, 'and nothing is asked of a third party for nothing');
});

test('changing the postcode re-fills them, even though they were more precise', async () => {
    // The arguable one, and the argument: coordinates left over from a PREVIOUS
    // postcode are simply wrong, and a centroid at the right address beats a
    // rooftop at the wrong one.
    const { coordinatePatchFor } = load(ok(55.0, -3.6));
    const patch = await coordinatePatchFor(
        { postcode: 'DG6 4JS', latitude: 54.838, longitude: -4.048 },
        { postcode: 'DG1 1AA' }
    );
    assert.deepEqual(patch, { latitude: 55.0, longitude: -3.6 });
});

test('re-saving the same postcode differently spaced is not a change', async () => {
    let called = false;
    const { coordinatePatchFor } = load(async () => { called = true; return ok(1, 2)(); });

    const patch = await coordinatePatchFor(
        { postcode: 'DG6 4JS', latitude: 54.838, longitude: -4.048 },
        { postcode: 'dg64js' }
    );
    assert.deepEqual(patch, {});
    assert.equal(called, false);
});

test('no postcode anywhere means nothing to do', async () => {
    let called = false;
    const { coordinatePatchFor } = load(async () => { called = true; return ok(1, 2)(); });

    assert.deepEqual(await coordinatePatchFor({ postcode: null, latitude: null, longitude: null }, {}), {});
    assert.equal(called, false);
});

test('a lookup that fails leaves the patch empty rather than half-written', async () => {
    // The save proceeds. A host must never be unable to save their own listing
    // because a third party is having a bad minute, and the town fallback in
    // pointForListing means a null coordinate is survivable.
    const { coordinatePatchFor } = load(async () => { throw new Error('down'); });
    assert.deepEqual(
        await coordinatePatchFor({ postcode: 'DG6 4JS', latitude: null, longitude: null }, {}),
        {}
    );
});

/* ------------------------------------------------------------- the wiring */

// A helper nothing calls is a helper that does nothing. The tests above all
// stub fetch, so they would pass just as happily against a route that never
// invoked any of it — which is the whole failure this change is about, one
// level up.
test('publishing fills the coordinates from the postcode', async () => {
    const updates: any[] = [];

    const listing = {
        id: 'l-1',
        host_id: 'host-1',
        title: 'Modern Cottage, with Hot Tub',
        price_per_night: 120,
        status: 'draft',
        postcode: 'DG6 4JS',
        latitude: null,
        longitude: null,
    };

    stubModule('@/lib/supabaseAdmin', {
        adminClient: () => ({
            from: () => ({
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: listing, error: null }) }) }),
                update: (patch: any) => {
                    updates.push(patch);
                    return { eq: async () => ({ data: null, error: null }) };
                },
            }),
        }),
    });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: 'host-1' } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    (global as any).fetch = async () => ({
        ok: true,
        json: async () => ({ result: { latitude: 54.834305, longitude: -4.055713 } }),
    });

    clearModule('@/lib/postcodeGeocode');
    clearModule('@/app/api/listings/publish/route');
    const route = require('../app/api/listings/publish/route');

    const res: any = await route.POST(new Request('http://x/api/listings/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listingId: 'l-1' }),
    }));

    assert.equal(res.body.ok, true);
    assert.equal(updates.length, 1, 'still one update, not two');
    assert.equal(updates[0].status, 'published');
    assert.equal(updates[0].latitude, 54.834305, 'the postcode was actually used');
    assert.equal(updates[0].longitude, -4.055713);
});
