// Who may do what to which listing.
//
// This module decides whether somebody can see a booking, handle it, see the
// money on it, or edit the listing — and today's ownership gating on
// accepting, cancelling and refunding was built on top of it. It had no tests:
// making an owner lose `can_bookings` passed the whole suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const MODULE = '@/lib/access';

// `owned` are listings whose host_id is this person; `granted` are
// listing_access rows handed to them by somebody else.
function load(data: { owned?: any[]; granted?: any[]; listing?: any } = {}) {
    const handlers: Record<string, any> = {
        listings: (state: any) =>
            state.ops.some((o: any) => o.op === 'maybeSingle')
                ? { data: data.listing || null, error: null }
                : { data: data.owned || [], error: null },
        listing_access: { data: data.granted || [], error: null },
    };

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    state.ops.push({ op: 'maybeSingle', args: [] });
                    const h = handlers[table];
                    const v = typeof h === 'function' ? h(state) : h;
                    return async () => v;
                }
                if (prop === 'then') {
                    const h = handlers[table] ?? { data: [], error: null };
                    const v = typeof h === 'function' ? h(state) : h;
                    return (resolve: any) => resolve(v);
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    clearModule(MODULE);
    return require(MODULE.replace('@/', '../'));
}

test('an owner may do everything with their own listing', async () => {
    const { accessibleListings } = load({ owned: [{ id: 'l1' }] });
    const rows = await accessibleListings('me');

    assert.equal(rows.length, 1);
    const a = rows[0];
    assert.equal(a.isOwner, true);
    assert.equal(a.role, 'owner');
    assert.equal(a.can_bookings, true, 'an owner handles their own bookings');
    assert.equal(a.can_earnings, true);
    assert.equal(a.can_calendar, true);
    assert.equal(a.can_messages, true);
    assert.equal(a.can_listing, true);
    assert.equal(a.accessId, null, 'an owner did not come through a grant');
});

test('a co-host gets exactly what they were given, and nothing more', async () => {
    const { accessibleListings } = load({
        granted: [{
            id: 'acc-1', listing_id: 'l2', role: 'co_host',
            can_calendar: true, can_messages: true,
            can_bookings: false, can_listing: false, can_earnings: false,
        }],
    });
    const rows = await accessibleListings('me');

    assert.equal(rows.length, 1);
    const a = rows[0];
    assert.equal(a.isOwner, false, 'a co-host is not the owner, which is what the payout routes check');
    assert.equal(a.can_calendar, true);
    assert.equal(a.can_messages, true);
    assert.equal(a.can_bookings, false);
    assert.equal(a.can_earnings, false, 'the diary and the takings are separate permissions');
    assert.equal(a.accessId, 'acc-1', 'the grant is identified so it can be revoked');
});

test('signed out means access to nothing', async () => {
    const { accessibleListings } = load({ owned: [{ id: 'l1' }] });
    assert.deepEqual(await accessibleListings(''), [], 'no user id, no listings');
});

test('listingIdsFor filters on the permission asked for', async () => {
    const { listingIdsFor } = load({
        owned: [{ id: 'mine' }],
        granted: [{
            id: 'acc-1', listing_id: 'theirs', role: 'staff',
            can_calendar: true, can_messages: false,
            can_bookings: false, can_listing: false, can_earnings: false,
        }],
    });

    assert.deepEqual(await listingIdsFor('me', 'can_calendar'), ['mine', 'theirs']);
    assert.deepEqual(
        await listingIdsFor('me', 'can_earnings'),
        ['mine'],
        'staff see the diary, not the money'
    );
    assert.deepEqual(await listingIdsFor('me', 'can_bookings'), ['mine']);
});

test('checkListing says no for a listing nobody has given you', async () => {
    const { checkListing } = load({ listing: { id: 'l9', host_id: 'someone-else' }, granted: [] });
    assert.equal(await checkListing('me', 'l9', 'can_bookings'), null);
});

test('checkListing says yes to the owner', async () => {
    const { checkListing } = load({ listing: { id: 'l9', host_id: 'me' } });
    const a = await checkListing('me', 'l9', 'can_bookings');
    assert.ok(a);
    assert.equal(a.isOwner, true);
});

test('checkListing refuses without a user or a listing', async () => {
    const { checkListing } = load({ listing: { id: 'l9', host_id: 'me' } });
    assert.equal(await checkListing('', 'l9', 'can_bookings'), null);
    assert.equal(await checkListing('me', '', 'can_bookings'), null);
});
