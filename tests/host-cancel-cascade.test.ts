// A host cancelling a confirmed stay must take its experiences with it — the
// same cascade a GUEST cancel runs. It didn't: /api/stripe/refund (the host
// path) refunded the stay and closed it, but never touched the confirmed
// experience orders, so the guest kept paying for a dinner at a cottage nobody
// would be in and the chef would drive to an empty one.
//
// PROVE IT FAILS FIRST: delete the cancelStayExperienceOrders call from the host
// branch of app/api/stripe/refund/route.ts and this goes red — no refund is
// issued for the order's payment intent, and the provider is never told.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

const ROUTE = '@/app/api/stripe/refund/route';

function loadRoute(adminClientObj: any, stripeCalls: any[], emailTo: string[]) {
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'HOST' } } }) } }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init: any) => ({ body, init }) } });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => adminClientObj });
    // The stay refund itself is stubbed, so the only '/refunds' Stripe sees is
    // the experience-order cascade under test.
    stubModule('@/lib/refundSpread', {
        issueRefunds: async () => ({ charges: [{ intentId: 'pi_stay' }], shares: [70000], refunds: [{}], refundedPence: 70000, failure: null }),
    });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, key?: string) => { stripeCalls.push({ method, path, body, key }); return {}; },
    });
    stubModule('@/lib/clawback', { clawBackPayout: async () => {} });
    stubModule('@/lib/cancellation', { refundDue: () => 700 });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/email', {
        sendEmail: async (to: string) => { emailTo.push(to); },
        emailLayout: (h: string) => h,
        escapeHtml: (s: string) => s,
    });
    clearModule('@/lib/experienceCancel');
    clearModule(ROUTE);
    return require(ROUTE.replace('@/', '../'));
}

test('a host cancel refunds the confirmed experience orders and tells the provider', async () => {
    const stripeCalls: any[] = [];
    const emailTo: string[] = [];

    const { client } = fakeSupabase({
        // total_price 0 so the 5% penalty path (admin.rpc) is skipped; the stub
        // has no rpc, and the penalty is not what this test is about.
        bookings: { data: { id: 'b1', listing_id: 'L1', guest_id: 'G', host_id: 'HOST', check_in: '2026-09-20', status: 'confirmed', payment_status: 'paid', total_price: 0, amount_paid: 700, amount_refunded: 0, cleaning_fee: 0, stripe_payment_intent_id: 'pi_stay', balance_payment_intent_id: null, payout_transfer_id: null, payout_amount: null }, error: null },
        // One confirmed experience order on the booking, with its own charge.
        service_orders: { data: [{ id: 'o1', status: 'confirmed', stripe_payment_intent_id: 'pi_order', guest_email: 'guest@x.test', service_date: '2026-09-21', price: 180, provider_id: 'P1', provider_business_name: 'Solway Table', slot_session_id: null, quantity: 1 }], error: null },
        service_providers: { data: { contact_email: 'chef@x.test' }, error: null },
        payments: { data: [], error: null },
    });

    const route = loadRoute(client, stripeCalls, emailTo);
    const res: any = await route.POST({ json: async () => ({ bookingId: 'b1', reason: 'cancelled' }) });

    assert.equal(res.body.ok, true, 'the refund itself should succeed');

    // The order's charge was refunded (reversing the fee and the transfer).
    const orderRefunds = stripeCalls.filter((c) => c.path === '/refunds' && c.body && c.body.payment_intent === 'pi_order');
    assert.equal(orderRefunds.length, 1, 'the confirmed experience order must be refunded when the host cancels');
    assert.equal(orderRefunds[0].body.reverse_transfer, 'true', 'the provider’s transfer is reversed too');

    // And the provider is told not to turn up.
    assert.equal(emailTo.includes('chef@x.test'), true, 'the provider must be told the booking is off');
    assert.equal(emailTo.includes('guest@x.test'), true, 'the guest must be told their experience was refunded');
});
