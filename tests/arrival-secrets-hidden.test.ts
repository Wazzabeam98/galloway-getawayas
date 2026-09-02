// The trip card must never carry an arrival secret.
//
// /api/trips feeds the trip card. It reads listing_arrival (which holds the wifi
// password and the approach directions) to put the CARD-SAFE fields on the card —
// the address, times, a map point, what3words — and nothing else. The door code
// it never reads at all. This guards that: given a listing_arrival row that HOLDS
// the wifi password, the response must contain neither it nor a door code.
//
// PROVE IT FAILS FIRST: widen the response builder in app/api/trips/route.ts to
// spread the row — e.g. `t.arrival = { ...l, ...arrivalRow }` — and this test goes
// red on the wifi password. That is the point of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/trips/route';

function loadRoute(adminClientObj: any, user: any) {
    stubModule('@supabase/supabase-js', { createClient: () => adminClientObj });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any) => ({ body }) } });
    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    return require(ROUTE.replace('@/', '../'));
}

test('the trip card API returns no door code and no wifi password, even when the row has both', async () => {
    const WIFI_PW = 'seals&stars24';
    const DIRECTIONS = 'turn at the red postbox, park by the blue door';

    const { client } = fakeSupabase({
        bookings: { data: [{ id: 'b1', listing_id: 'L1', guest_id: 'G', host_id: 'H', check_in: '2026-09-20', check_out: '2026-09-25', status: 'confirmed', total_price: 500 }], error: null },
        booking_guests: { data: [], error: null },
        listings: { data: [{ id: 'L1', street_address: 'Mill Road', postcode: 'DG6 4XT', location: 'Kirkcudbright', latitude: 54.83, longitude: -4.05, check_in_time: '15:00', check_out_time: '11:00' }], error: null },
        // The row HOLDS the secrets. The route must not carry them out.
        listing_arrival: { data: [{ listing_id: 'L1', arrival_directions: DIRECTIONS, wifi_password: WIFI_PW, wifi_name: 'HarbourCottage', what3words: '///harbour.candle.brave', parking_info: 'gravel' }], error: null },
    });

    const route = loadRoute(client, { id: 'G' });
    const res: any = await route.GET();
    const json = JSON.stringify(res.body);

    assert.equal(json.includes(WIFI_PW), false, 'the wifi password must not appear anywhere in the trip card response');
    assert.equal(json.includes('wifi_password'), false, 'the response must not even carry a wifi_password key');
    assert.equal(json.includes(DIRECTIONS), false, 'the approach directions must not appear either');
    assert.equal(/"(door_code|code|access_code)"/.test(json), false, 'no door-code field of any name');

    // And it DOES carry the card-safe things, so this is a real narrowing, not an
    // empty object.
    assert.equal(json.includes('///harbour.candle.brave'), true, 'what3words is card-safe and should be present');
    assert.equal(json.includes('Mill Road'), true, 'the address is card-safe and should be present');
});
