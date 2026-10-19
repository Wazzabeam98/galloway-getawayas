// A full-access co-host is the owner's equal.
//
// The owner keeps only three things — payout bank details, deleting the
// listing, and who the primary host is. Everything else (cancel, refund,
// request money, manage co-hosts) authorises through ownerOrFullAccess: the
// owner, or a co-host the owner ticked every permission for. A co-host missing
// even one permission is not owner-equivalent. These prove that boundary and the
// raw lookup underneath it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const MODULE = '@/lib/access';

// listing = the listings row (or null); grant = the listing_access row (or null).
// Both come back from maybeSingle(); the plain `then` is unused here.
function load(data: { listing?: any; grant?: any } = {}) {
    const handlers: Record<string, any> = {
        listings: { data: data.listing ?? null, error: null },
        listing_access: { data: data.grant ?? null, error: null },
    };

    function builder(table: string) {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    return async () => handlers[table] ?? { data: null, error: null };
                }
                if (prop === 'then') {
                    return (resolve: any) => resolve(handlers[table] ?? { data: [], error: null });
                }
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    clearModule(MODULE);
    return require(MODULE.replace('@/', '../'));
}

const grant = (over: Record<string, boolean> = {}) => ({
    id: 'acc1',
    role: 'co_host',
    can_calendar: false,
    can_messages: false,
    can_bookings: false,
    can_listing: false,
    can_earnings: false,
    ...over,
});

const ALL = { can_calendar: true, can_messages: true, can_bookings: true, can_listing: true, can_earnings: true };

test('isFullAccess: an owner is full access', () => {
    const { isFullAccess } = load();
    assert.equal(isFullAccess({ isOwner: true } as any), true);
});

test('isFullAccess: every permission ticked is full access', () => {
    const { isFullAccess } = load();
    assert.equal(isFullAccess({ isOwner: false, ...ALL } as any), true);
});

test('isFullAccess: one permission short is NOT full access', () => {
    const { isFullAccess } = load();
    assert.equal(isFullAccess({ isOwner: false, ...ALL, can_earnings: false } as any), false);
});

test('ownerOrFullAccess: the owner qualifies', async () => {
    const { ownerOrFullAccess } = load({ listing: { id: 'L1', host_id: 'me' } });
    const a = await ownerOrFullAccess('me', 'L1');
    assert.ok(a);
    assert.equal(a.isOwner, true);
});

test('ownerOrFullAccess: a full-access co-host qualifies', async () => {
    const { ownerOrFullAccess } = load({ listing: { id: 'L1', host_id: 'owner' }, grant: grant(ALL) });
    const a = await ownerOrFullAccess('sam', 'L1');
    assert.ok(a, 'full access is owner-equivalent');
    assert.equal(a.isOwner, false);
    assert.equal(a.role, 'co_host');
});

test('ownerOrFullAccess: a partial co-host does NOT qualify', async () => {
    // Everything but earnings — a hair short of full access.
    const { ownerOrFullAccess } = load({
        listing: { id: 'L1', host_id: 'owner' },
        grant: grant({ can_calendar: true, can_messages: true, can_bookings: true, can_listing: true }),
    });
    assert.equal(await ownerOrFullAccess('sam', 'L1'), null);
});

test('ownerOrFullAccess: a stranger does NOT qualify', async () => {
    const { ownerOrFullAccess } = load({ listing: { id: 'L1', host_id: 'owner' }, grant: null });
    assert.equal(await ownerOrFullAccess('nobody', 'L1'), null);
});

test('listingAccessFor: returns the owner with every permission', async () => {
    const { listingAccessFor } = load({ listing: { id: 'L1', host_id: 'me' } });
    const a = await listingAccessFor('me', 'L1');
    assert.ok(a);
    assert.equal(a.isOwner, true);
    assert.equal(a.can_earnings, true);
});

test('listingAccessFor: returns a co-host with exactly their grant', async () => {
    const { listingAccessFor } = load({
        listing: { id: 'L1', host_id: 'owner' },
        grant: grant({ can_calendar: true }),
    });
    const a = await listingAccessFor('sam', 'L1');
    assert.ok(a);
    assert.equal(a.isOwner, false);
    assert.equal(a.can_calendar, true);
    assert.equal(a.can_bookings, false);
});

test('listingAccessFor: a missing listing is null', async () => {
    const { listingAccessFor } = load({ listing: null });
    assert.equal(await listingAccessFor('me', 'gone'), null);
});
