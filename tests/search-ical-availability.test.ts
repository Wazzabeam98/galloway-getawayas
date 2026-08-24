// Search has to hide a stay that is only taken on Airbnb or Booking.com.
//
// Those dates live in `listing_ical_feeds.events`, and that table has one RLS
// policy: the host of the listing, and nobody else. The home page builds its
// query as the visitor — anonymous, or a signed-in guest — so if search reads
// the table with the ordinary client, RLS hands back an empty list rather than
// an error. The filter then blocks nothing and looks like it is working.
//
// That silent-empty is the whole reason this file exists. The tests below use
// a fake ordinary client whose default for an unhandled table is `[]`, which
// is exactly what RLS does — so swapping `adminClient()` back for the ordinary
// client turns the first test red instead of leaving it green and wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases, fakeSupabase } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const LISTING_FREE = 'listing-free';
const LISTING_ON_AIRBNB = 'listing-on-airbnb';

// One stay sold on Airbnb: 10 Sep to 14 Sep. In iCal, as here, the end date is
// the checkout day and is itself free.
const FEED_ROWS = [
    {
        listing_id: LISTING_ON_AIRBNB,
        events: [{ start: '2026-09-10', end: '2026-09-14' }],
    },
];

function load(feedRows: any[] | null) {
    // The service-role client sees the feed rows. This is what `adminClient()`
    // gives you, and the only thing that can read this table.
    stubModule('@/lib/supabaseAdmin', {
        adminClient: () => fakeSupabase({ listing_ical_feeds: { data: feedRows, error: null } }).client,
    });

    // The ordinary visitor client, standing in for what RLS actually does to a
    // non-host: it builds fine, the query succeeds, and no rows come back.
    // fakeSupabase's default for an unhandled table is exactly that empty
    // result, so if `icalBlockedListingIds` is ever changed to use this client
    // the first test fails on its assertion rather than crashing — which is
    // the point, because a crash is not the failure mode we are guarding
    // against. Silence is.
    stubModule('@supabase/auth-helpers-nextjs', {
        createServerComponentClient: () => fakeSupabase({}).client,
        createClientComponentClient: () => fakeSupabase({}).client,
    });
    stubModule('next/headers', { cookies: () => ({}) });

    delete require.cache[require.resolve('@/lib/availability')];
    return require('@/lib/availability');
}

test('a listing taken only on Airbnb is reported as unavailable', async () => {
    const { icalBlockedListingIds } = load(FEED_ROWS);

    const blocked = await icalBlockedListingIds(
        [LISTING_FREE, LISTING_ON_AIRBNB],
        '2026-09-11',
        '2026-09-13'
    );

    assert.equal(blocked.has(LISTING_ON_AIRBNB), true,
        'the stay sold on Airbnb should be hidden from these dates');
    assert.equal(blocked.has(LISTING_FREE), false,
        'a listing with no feed clash should stay in the results');
});

// This is the shape RLS produces for a non-host: no error, no rows. If the
// query is ever made with the ordinary client this is what comes back, and
// the assertion below is what stops that passing quietly.
test('an empty feed read blocks nothing — the RLS failure mode', async () => {
    const { icalBlockedListingIds } = load([]);

    const blocked = await icalBlockedListingIds(
        [LISTING_FREE, LISTING_ON_AIRBNB],
        '2026-09-11',
        '2026-09-13'
    );

    assert.equal(blocked.size, 0,
        'with no rows returned nothing can be blocked — which is why the read must bypass RLS');
});

test('the checkout night is free, so a stay may start on it', async () => {
    const { icalBlockedListingIds } = load(FEED_ROWS);

    // The Airbnb guest leaves on the 14th. Arriving on the 14th is fine.
    const blocked = await icalBlockedListingIds([LISTING_ON_AIRBNB], '2026-09-14', '2026-09-16');
    assert.equal(blocked.has(LISTING_ON_AIRBNB), false,
        'arriving on another booking’s checkout day is not a clash');

    // Leaving on the 10th is fine too — that guest arrives that afternoon.
    const alsoFree = await icalBlockedListingIds([LISTING_ON_AIRBNB], '2026-09-08', '2026-09-10');
    assert.equal(alsoFree.has(LISTING_ON_AIRBNB), false,
        'leaving on the day another booking starts is not a clash');

    // But one night inside the stay is.
    const clash = await icalBlockedListingIds([LISTING_ON_AIRBNB], '2026-09-13', '2026-09-15');
    assert.equal(clash.has(LISTING_ON_AIRBNB), true,
        'a stay overlapping the last night should clash');
});

test('search and checkout agree, because they share one overlap check', async () => {
    const { blockedNightsFromEvents } = load(FEED_ROWS);

    // This is the set checkout builds to test a booking night by night. If it
    // and the search filter ever stop agreeing, one of them is wrong about
    // whether somebody can have the dates.
    const nights = blockedNightsFromEvents([{ start: '2026-09-10', end: '2026-09-14' }]);

    assert.deepEqual(
        [...nights].sort(),
        ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
        'four nights are taken, and the 14th — the checkout day — is not one of them'
    );
});

test.after(() => {
    clearModule('@/lib/supabaseAdmin');
    clearModule('@supabase/auth-helpers-nextjs');
    clearModule('next/headers');
});
