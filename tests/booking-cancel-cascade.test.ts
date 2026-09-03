// Cancelling a cottage stay cascades to the experience orders attached to it —
// and, for a slot, gives the seat back.
//
// The cascade already refunded a confirmed slot order when the stay was
// cancelled, but it never decremented slot_sessions.seats_taken, so the money
// came back while the seat stayed taken — the session read as full to the next
// guest. This proves the whole cascade: the request shapes release their card
// hold / refund, and a slot releases its seat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const CANCEL_ROUTE = '@/app/api/bookings/cancel/route';

test('cancelling the stay refunds a confirmed slot order AND releases its seat', async () => {
    const booking = {
        id: 'b-1', listing_id: 'l-1', guest_id: 'g-1',
        check_in: '2099-06-01', status: 'confirmed', payment_status: 'paid',
        amount_paid: 400, amount_refunded: 0, cleaning_fee: 0,
        stripe_payment_intent_id: null, balance_payment_intent_id: null, balance_amount: 0,
    };
    // A confirmed slot order (2 seats) plus a comes-to-you request (no seat).
    const slotSession = { id: 'ss-1', seats_taken: 5, capacity: 6 };
    const orders = [
        { id: 'o-slot', status: 'confirmed', stripe_payment_intent_id: 'pi_slot', slot_session_id: 'ss-1', quantity: 2, guest_email: 'guest@example.invalid', service_date: '2099-06-02', price: 40, provider_id: 'p-1', provider_business_name: 'Sauna' },
        { id: 'o-chef', status: 'authorised', stripe_payment_intent_id: 'pi_chef', slot_session_id: null, quantity: 1, guest_email: 'guest@example.invalid', service_date: '2099-06-02', price: 120, provider_id: 'p-2', provider_business_name: 'Chef' },
    ];
    const rows: Record<string, any> = {
        bookings: booking,
        listings: { title: 'Harbour Cottage', cancellation_policy: 'Firm' },
        service_orders: orders,
        slot_sessions: slotSession,
    };

    const stripeCalls: Array<{ method: string; path: string }> = [];
    const slotUpdates: any[] = [];
    const orderUpdates: any[] = [];

    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'then') return (r: any) => r({ data: rows[table] ?? null, error: null });
                    if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: rows[table] ?? null, error: null });
                    if (prop === 'insert') return async () => ({ data: null, error: null });
                    if (prop === 'update') {
                        return (payload: any) => {
                            if (table === 'slot_sessions') slotUpdates.push(payload);
                            if (table === 'service_orders') orderUpdates.push(payload);
                            // .update(...).eq(...).eq(...).select('id') must resolve
                            // to a moved row so the seat release runs.
                            const upd: any = new Proxy({}, {
                                get(_u, p: string) {
                                    if (p === 'then') return (r: any) => r({ data: [{ id: 'moved' }], error: null });
                                    if (p === 'select') return () => ({ then: (r: any) => r({ data: [{ id: 'moved' }], error: null }) });
                                    return () => upd;
                                },
                            });
                            return upd;
                        };
                    }
                    return () => chain;
                },
            });
            return chain;
        },
        rpc: async () => ({ data: 0, error: null }),
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: 'g-1', email: 'guest@example.invalid' } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/refundSpread', { issueRefunds: async () => ({ refundedPence: 0, refunds: [], shares: [], charges: [] }) });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string) => { stripeCalls.push({ method, path }); return {}; },
    });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/email', {
        sendEmail: async () => true, emailLayout: (b: string) => b, escapeHtml: (x: string) => x,
        SITE_URL: 'http://example.invalid', button: () => '',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/refundSpread');
    clearModule(CANCEL_ROUTE);
    const route = require('../app/api/bookings/cancel/route');

    const req = new Request('http://example.invalid/api/bookings/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'b-1' }),
    });
    const res: any = await route.POST(req);
    assert.equal(res.status, 200);

    // The slot order was refunded (reverse_transfer), the chef's hold cancelled.
    assert.ok(stripeCalls.some((c) => c.path === '/refunds'), 'the confirmed slot order is refunded');
    assert.ok(stripeCalls.some((c) => /\/payment_intents\/pi_chef\/cancel/.test(c.path)), "the chef's held request is released");

    // The seat came back: 5 taken − 2 = 3. Without the fix, no slot_sessions
    // update happens at all.
    assert.equal(slotUpdates.length, 1, 'exactly one slot session was touched');
    assert.equal(slotUpdates[0].seats_taken, 3, 'the two seats were returned');

    // The request order carries no seat, so it is never released as one.
    assert.ok(orderUpdates.some((u) => u.status === 'refunded'), 'the slot order moved to refunded');
    assert.ok(orderUpdates.some((u) => u.status === 'cancelled'), "the chef's order moved to cancelled");
});
