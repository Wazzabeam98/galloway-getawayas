// Saving one arrival field must not blank the others.
//
// The editor loads the current values, then sends only what the host changed.
// But a GET that failed or raced leaves the editor with empty state, so the
// route itself has to be safe: a field the caller did not send is left ALONE,
// never overwritten with null. Otherwise a host who types the wifi name into an
// editor that never loaded would wipe the wifi PASSWORD with no error and
// nothing in the log.
//
// This posts a single field and proves the write carries only that field — the
// others are absent from the upsert, so the stored values survive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/listings/arrival/route';

function loadRoute(captureInto: { row: any }) {
    const { client } = fakeSupabase({
        listing_arrival: (state: any) => {
            const up = state.ops.find((o: any) => o.op === 'upsert');
            if (up) captureInto.row = up.args[0];
            return { data: null, error: null };
        },
    });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'H' } } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init: any) => ({ body, status: (init && init.status) || 200 }) } });
    // Owner of the listing — the gate passes, so we exercise the write itself.
    stubModule('@/lib/access', { checkListing: async () => ({ isOwner: true, can_listing: true }) });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => client });
    stubModule('@/lib/logError', { logError: async () => {} });
    clearModule(ROUTE);
    return require(ROUTE.replace('@/', '../'));
}

test('posting one field writes only that field — the unsent ones are not in the upsert', async () => {
    const cap = { row: null as any };
    const route = loadRoute(cap);

    const req: any = { url: 'http://x/api/listings/arrival', json: async () => ({ listingId: 'L1', parking_info: 'gravel by the blue door' }) };
    const res: any = await route.POST(req);

    assert.equal(res.body.ok, true, 'the save should succeed');
    assert.ok(cap.row, 'the route wrote a row');
    assert.equal(cap.row.listing_id, 'L1');
    assert.equal(cap.row.parking_info, 'gravel by the blue door');

    // The fields the caller did NOT send must be ABSENT from the write, so the
    // upsert leaves the stored wifi password and directions exactly as they were.
    assert.equal('wifi_password' in cap.row, false, 'wifi_password must not be written when it was not sent');
    assert.equal('arrival_directions' in cap.row, false, 'arrival_directions must not be written when it was not sent');
    assert.equal('wifi_name' in cap.row, false, 'wifi_name must not be written when it was not sent');
    assert.equal('what3words' in cap.row, false, 'what3words must not be written when it was not sent');
});

test('a field that IS sent empty still clears to null — absence and emptiness differ', async () => {
    const cap = { row: null as any };
    const route = loadRoute(cap);

    const req: any = { url: 'http://x/api/listings/arrival', json: async () => ({ listingId: 'L1', wifi_password: '' }) };
    await route.POST(req);

    assert.equal('wifi_password' in cap.row, true, 'a sent field is present in the write');
    assert.equal(cap.row.wifi_password, null, 'and an empty string clears it to null');
    assert.equal('parking_info' in cap.row, false, 'an unsent field is still left alone');
});
