// Scenario 2. A booking paid in full has nothing outstanding, and the column
// that says what is outstanding has to be able to say zero. It was left null,
// which reads as 'unknown' and becomes NaN the moment anything does arithmetic
// on it.
//
// Checkout sets it too, and that half is covered live in the runner. This
// covers the webhook, which is the point the money actually lands and the last
// chance to correct a booking that arrived with a null on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const ROUTE = '@/app/api/stripe/webhook/route';

function load(booking: any = { id: 'b-1', status: 'pending_payment', total_price: 300, listing_id: 'l-1', amount_paid: 0 }) {
    const updates: any[] = [];
    const inserts: any[] = [];

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain,
                        maybeSingle: async () => ({
                            data: table === 'listings' ? { instant_book: true } : booking,
                            error: null,
                        }),
                    };
                    return chain;
                },
                update(patch: any) {
                    return {
                        eq: async (_c: string, id: string) => {
                            updates.push({ table, patch, id });
                            return { data: null, error: null };
                        },
                    };
                },
                insert: async (row: any) => {
                    inserts.push({ table, row });
                    return { data: null, error: null };
                },
            };
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', {
        verifyStripeSignature: async () => true,
        stripeRequest: async () => ({ payment_method: 'pm_1', customer: 'cus_1' }),
    });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule(ROUTE);
    const route = require('../app/api/stripe/webhook/route');
    return { route, updates, inserts };
}

function completedSession(kind: string, amountTotal: number) {
    return new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id: 'evt_' + kind,
            type: 'checkout.session.completed',
            data: {
                object: {
                    payment_status: 'paid',
                    amount_total: amountTotal,
                    payment_intent: 'pi_1',
                    customer: 'cus_1',
                    client_reference_id: 'b-1',
                    metadata: { booking_id: 'b-1', kind: kind },
                },
            },
        }),
    });
}

const bookingPatch = (updates: any[]) =>
    updates.filter((u) => u.table === 'bookings').pop().patch;

test('paying in full leaves nothing outstanding, as zero rather than null', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('full', 30000));

    const patch = bookingPatch(updates);
    assert.equal(patch.payment_status, 'paid');
    assert.equal(patch.amount_paid, 300);
    assert.equal(patch.balance_amount, 0, 'zero, not null — null is not a number');
    assert.notEqual(patch.balance_amount, null);
});

test('paying a deposit leaves the balance alone', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('deposit', 7500));

    const patch = bookingPatch(updates);
    assert.equal(patch.payment_status, 'deposit_paid');
    assert.equal(patch.amount_paid, 75);
    assert.equal(
        patch.balance_amount,
        undefined,
        'checkout worked out what is still owed; the webhook must not flatten it'
    );
});

test('an Instant Book listing confirms the booking on payment', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('full', 30000));

    const patch = bookingPatch(updates);
    assert.equal(patch.status, 'confirmed');
    assert.ok(patch.confirmed_at, 'the moment it was confirmed is recorded');
});
