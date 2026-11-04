// Hotels are held off PRODUCTION until HOTELS_OPEN reads as 'true', the same
// launch-gate shape as BUSINESS_SIGNUPS_OPEN (read tolerantly — a Sensitive
// Vercel variable cannot be read back, so a mistyped value must not silently
// hold the feature shut). Previews and local are always open so the surface
// stays walkable against TEST.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const { hotelsOpen, roomTypeProblem, hotelPublishProblem } = require('../lib/hotels');

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) {
        saved[k] = process.env[k];
        if (vars[k] === undefined) delete process.env[k];
        else process.env[k] = vars[k];
    }
    try { fn(); } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

test('on production hotels follow HOTELS_OPEN, read tolerantly', () => {
    withEnv({ VERCEL_ENV: 'production', HOTELS_OPEN: 'True ' }, () => {
        assert.equal(hotelsOpen(), true);
    });
    withEnv({ VERCEL_ENV: 'production', HOTELS_OPEN: undefined }, () => {
        assert.equal(hotelsOpen(), false, 'unset on production stays held');
    });
    withEnv({ VERCEL_ENV: 'production', HOTELS_OPEN: 'false' }, () => {
        assert.equal(hotelsOpen(), false);
    });
    withEnv({ VERCEL_ENV: 'preview', HOTELS_OPEN: undefined }, () => {
        assert.equal(hotelsOpen(), true, 'previews are always open');
    });
    withEnv({ VERCEL_ENV: undefined, HOTELS_OPEN: undefined }, () => {
        assert.equal(hotelsOpen(), true, 'local is always open');
    });
});

test('a room type must have a name, a count, a bed and a price', () => {
    const beds = [{ type: 'double', count: 1 }];
    assert.ok(roomTypeProblem(null));
    assert.ok(roomTypeProblem({ name: '  ' }));
    assert.ok(roomTypeProblem({ name: 'Double', inventory_count: 0, max_adults: 2, max_children: 0, bed_config: beds, price_per_night: 90 }), 'needs a count');
    assert.ok(roomTypeProblem({ name: 'Double', inventory_count: 3, max_adults: 2, max_children: 1, bed_config: [], price_per_night: 90 }), 'needs a bed');
    assert.ok(roomTypeProblem({ name: 'Double', inventory_count: 3, max_adults: 2, max_children: 1, bed_config: beds, price_per_night: 0 }), 'needs a price');
    assert.equal(
        roomTypeProblem({ name: 'Double', inventory_count: 3, max_adults: 2, max_children: 1, bed_config: beds, price_per_night: 95 }),
        null,
        'a complete room type is fine',
    );
});

test('a hotel needs a name, type, address, times, photos and a room type to publish', () => {
    const base = {
        name: 'The Harbour Hotel',
        property_type: 'hotel',
        street_address: '1 Harbour St',
        location: 'Kirkcudbright, Dumfries and Galloway',
        check_in_time: '15:00',
        check_out_time: '11:00',
        images: ['a', 'b', 'c', 'd', 'e'],
        roomTypes: [{ name: 'Double', inventory_count: 4, max_adults: 2, max_children: 0, bed_config: [{ type: 'double', count: 1 }], price_per_night: 110 }],
    };
    assert.equal(hotelPublishProblem(base), null, 'a complete hotel is ready');
    assert.ok(hotelPublishProblem({ ...base, name: '' }));
    assert.ok(hotelPublishProblem({ ...base, property_type: 'cottage' }), 'not a hotel property type');
    assert.ok(hotelPublishProblem({ ...base, images: ['a', 'b'] }), 'too few photos');
    assert.ok(hotelPublishProblem({ ...base, roomTypes: [] }), 'no room types');
});

test('/api/health/flags reports hotels set/open, never the value', async () => {
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, init }) },
    });
    clearModule('@/app/api/health/flags/route');
    const route = require('../app/api/health/flags/route');

    let res: any;
    await new Promise<void>((done) => withEnv({ VERCEL_ENV: 'production', HOTELS_OPEN: ' TRUE ', BUSINESS_SIGNUPS_OPEN: undefined }, () => {
        route.GET().then((r: any) => { res = r; done(); });
    }));
    assert.deepEqual(res.body.hotels, { set: true, open: true });
    assert.ok(!JSON.stringify(res.body).includes('TRUE'), 'the value itself is not disclosed');
});
