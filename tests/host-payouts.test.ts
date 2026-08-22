// The payout run is the thing that sends money to other people, and it has
// never been run in anger. These tests stub Supabase and Stripe entirely:
// nothing here touches a database or a payment processor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/host-payouts/route';

function loadRoute(supabaseClient: any) {
    const logged: any[] = [];

    stubModule('@supabase/supabase-js', { createClient: () => supabaseClient });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => {
            logged.push({ message, detail, context });
        },
    });
    stubModule('@/lib/stripe', {
        stripeRequest: async () => {
            throw new Error('a test must never reach Stripe');
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async () => true,
        emailLayout: () => '',
        escapeHtml: (s: string) => s,
        formatDate: () => '',
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    // The route reaches its database through lib/supabaseAdmin, which captures
    // createClient when it loads and is then cached like any other module. So
    // stubbing @supabase/supabase-js for a second test changed nothing: every
    // test after the first in this file silently reused the first one's fake
    // database, and passed or failed on data it was never given.
    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, logged };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/host-payouts', {
        headers: { authorization: 'Bearer test-secret' },
    });

test('an unauthorised call is refused', async () => {
    const { client } = fakeSupabase({});
    const { route } = loadRoute(client);
    const res: any = await route.GET(new Request('http://example.invalid/x'));
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
});

// FIX: the error from this query was discarded. A failed read left `due`
// empty, the loop did nothing, and the run returned ok:true with 0 sent —
// indistinguishable from a day with no payouts due. Hosts would simply not
// be paid, and nothing would say so.
test('a failed read of the bookings due reports a failure, not a quiet success', async () => {
    const { client } = fakeSupabase({
        bookings: { data: null, error: { message: 'connection reset' } },
    });
    const { route, logged } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.status, 500, 'the run must not return 200 when it could not read its work');
    assert.equal(res.body.ok, false);
    assert.equal(logged.length, 1, 'the failure must reach /admin/errors, not just the console');
    assert.match(logged[0].message, /could not load the bookings due/i);
    assert.equal(logged[0].context.path, '/api/cron/host-payouts');
});

test('a genuinely quiet day is still a success', async () => {
    const { client } = fakeSupabase({ bookings: { data: [], error: null } });
    const { route, logged } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, sent: 0, skipped: 0, failed: 0 });
    assert.equal(logged.length, 0, 'nothing due is not an error');
});

// A host who has not finished Stripe onboarding is skipped, not failed, and
// is picked up whenever a later run finds them ready. (Scenario 21.)
test('a host without Stripe onboarding is skipped rather than failed', async () => {
    const booking = {
        id: 'b1', listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01',
        total_price: 500, amount_paid: 500, amount_refunded: 0,
        commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
    };
    const { client } = fakeSupabase({
        bookings: { data: [booking], error: null },
        profiles: { data: { id: 'h1', stripe_account_id: null, stripe_payouts_enabled: false, payout_balance_owed: 0 }, error: null },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
    });
    const { route } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 0, 'nothing can be sent to a host with no Stripe account');
    assert.equal(res.body.failed, 0, 'and it is not a failure — they simply are not ready yet');
    assert.equal(res.body.skipped, 1);
});
