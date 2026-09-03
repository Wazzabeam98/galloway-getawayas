// The trip card must never carry an arrival SECRET.
//
// /api/trips feeds the trip card, which now holds the whole approach — the
// address, times, a map point, what3words, the host's "last bit" directions and
// parking. Those are card-safe: they are the host's own words for finding the
// door, not a credential, so they belong on the card and this test expects them
// there.
//
// The two secrets are the door CODE and the wifi PASSWORD. Those stay on the
// Getting-there page, revealed only in its window. The route sends two booleans
// in their place — hasCode / hasWifi — so the card can say a way in exists and
// link through, WITHOUT the value ever reaching the browser. This guards that:
// given a listing_arrival row that HOLDS the wifi password, the response carries
// neither it nor a door code, and hasWifi is a plain boolean.
//
// A DELIBERATE CHANGE, not a loosening: this test used to assert the "last bit"
// arrival_directions ABSENT too, back when the card was a thin summary and the
// full approach lived on Getting there. When the card absorbed the approach, we
// decided those directions are the host's own words for finding the door — a
// description, not a credential — and reclassified them as card-safe. The line
// on them below now asserts them PRESENT on purpose. The credentials (door code,
// wifi password) were never reclassified and never will be.
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
        bookings: { data: [{ id: 'b1', listing_id: 'L1', guest_id: 'G', host_id: 'H', check_in: '2026-09-20', check_out: '2026-09-25', status: 'confirmed', payment_status: 'paid', total_price: 500 }], error: null },
        booking_guests: { data: [], error: null },
        listings: { data: [{ id: 'L1', street_address: 'Mill Road', postcode: 'DG6 4XT', location: 'Kirkcudbright', latitude: 54.83, longitude: -4.05, check_in_time: '15:00', check_out_time: '11:00' }], error: null },
        // The row HOLDS the secrets. The route must not carry them out.
        listing_arrival: { data: [{ listing_id: 'L1', arrival_directions: DIRECTIONS, wifi_password: WIFI_PW, wifi_name: 'HarbourCottage', what3words: '///harbour.candle.brave', parking_info: 'gravel' }], error: null },
    });

    const route = loadRoute(client, { id: 'G' });
    const res: any = await route.GET();
    const json = JSON.stringify(res.body);

    // The two secrets, and any trace of them, are absent.
    assert.equal(json.includes(WIFI_PW), false, 'the wifi password must not appear anywhere in the trip card response');
    assert.equal(json.includes('wifi_password'), false, 'the response must not even carry a wifi_password key');
    assert.equal(/"(door_code|code|access_code)"/.test(json), false, 'no door-code field of any name');

    // In their place, plain booleans: the row holds a wifi name, so hasWifi is
    // true — but that is a yes/no, not the password. No code row here, so hasCode
    // is false.
    const trip = res.body.trips[0];
    assert.equal(trip.arrival.hasWifi, true, 'hasWifi is the yes/no the card links on');
    assert.equal(trip.arrival.hasCode, false, 'no code on file, so hasCode is false');
    assert.equal(typeof trip.arrival.hasWifi, 'boolean', 'hasWifi is a boolean, never a value');

    // And it DOES carry the card-safe approach — what3words, the address, and the
    // host's own "last bit" directions and parking, which are not secrets.
    assert.equal(json.includes('///harbour.candle.brave'), true, 'what3words is card-safe and should be present');
    assert.equal(json.includes('Mill Road'), true, 'the address is card-safe and should be present');
    // Deliberately PRESENT (see the header): the last-bit directions were once
    // asserted absent; reclassifying them as the host's words, not a credential,
    // was a decision, so flipping this line back to `false` should be a decision
    // too, not a reflex.
    assert.equal(json.includes(DIRECTIONS), true, 'the host’s last-bit directions are card-safe and belong on the card — a deliberate reclassification, not a leak');
    assert.equal(trip.arrival.parking, 'gravel', 'parking is the host’s own words, card-safe');
});
