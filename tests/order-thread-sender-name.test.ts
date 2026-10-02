// The order-thread notification names the SENDER to the RECIPIENT. It was
// inverted — a guest's message showed the provider their own business name, and
// a provider's message showed the guest their own name. orderThreadContext now
// exposes guestName (perspective-independent), and the route picks
// isGuest ? guestName : business. These tests lock the mapping down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { orderThreadContext } = require('@/lib/orderThreads');

// A tiny admin double for the .from(t).select(..).eq(..).maybeSingle() chain.
function fakeAdmin(rows: Record<string, any>) {
    return {
        from(table: string) {
            return {
                select() { return this; },
                eq() { return this; },
                async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
            };
        },
    };
}

const ORDER = {
    id: 'o1', guest_id: 'G', provider_id: 'P',
    provider_business_name: "Katie's Kitchen", item_name: 'Foraging Walk',
    service_date: '2026-10-11', status: 'confirmed',
};
const PROVIDER = { owner_id: 'HOST', business_name: "Katie's Kitchen" };
const GUEST = { full_name: 'Sarah MacLeod', preferred_name: null, show_full_name: true };

function senderNameFor(ctx: any): string {
    // The exact selection the route makes.
    return ctx.isGuest ? ctx.guestName : ctx.business;
}

test('a message FROM the guest names the guest to the provider', async () => {
    const admin = fakeAdmin({ service_orders: ORDER, service_providers: PROVIDER, profiles: GUEST });
    const ctx = await orderThreadContext(admin, 'o1', 'G'); // viewer/sender = guest
    assert.equal(ctx.isGuest, true);
    assert.equal(ctx.guestName, 'Sarah MacLeod');
    // The recipient (provider) sees the GUEST's name, not the business.
    assert.equal(senderNameFor(ctx), 'Sarah MacLeod');
    assert.notEqual(senderNameFor(ctx), ctx.business);
});

test('a message FROM the provider names the business to the guest', async () => {
    const admin = fakeAdmin({ service_orders: ORDER, service_providers: PROVIDER, profiles: GUEST });
    const ctx = await orderThreadContext(admin, 'o1', 'HOST'); // viewer/sender = provider owner
    assert.equal(ctx.isGuest, false);
    // The recipient (guest) sees the BUSINESS, not their own name.
    assert.equal(senderNameFor(ctx), "Katie's Kitchen");
    assert.notEqual(senderNameFor(ctx), ctx.guestName);
});

test('show_full_name is honoured for the guest name', async () => {
    const admin = fakeAdmin({
        service_orders: ORDER, service_providers: PROVIDER,
        profiles: { full_name: 'Sarah MacLeod', preferred_name: null, show_full_name: false },
    });
    const ctx = await orderThreadContext(admin, 'o1', 'HOST');
    assert.equal(ctx.guestName, 'the guest', 'legal name is withheld when show_full_name is off');
});
