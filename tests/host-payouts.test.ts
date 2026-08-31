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
    assert.deepEqual(res.body, {
        ok: true, sent: 0, skipped: 0, failed: 0, hostsWaitingToOnboard: 0, reconciled: 0,
    });
    assert.equal(logged.length, 0, 'nothing due is not an error');
});

// A host who has not finished Stripe onboarding is skipped, not failed, and
// is picked up whenever a later run finds them ready. (Scenario 21.)
//
// It is no longer SILENT, which is the part that mattered. "Picked up whenever
// a later run finds them ready" quietly assumed they would one day be ready; a
// host who never finishes onboarding was skipped every day for ever while
// their stays piled up, and nothing anywhere said so. See the run summary
// test below.
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

// ---------------------------------------------------------------------------
// A HOST WHO CANNOT BE PAID IS REPORTED, NOT JUST SKIPPED
// ---------------------------------------------------------------------------

test('stays that cannot be paid out are reported once per host, with the total', async () => {
    // Two stays, one host, no Stripe account. The old behaviour was to skip
    // both in silence: the run reported ok, nothing errored, and a real person
    // was simply never paid.
    const base = {
        listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01', amount_refunded: 0,
        commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
    };
    const bookings = [
        { ...base, id: 'b1', total_price: 500, amount_paid: 500 },
        { ...base, id: 'b2', total_price: 300, amount_paid: 300 },
    ];

    const { client } = fakeSupabase({
        bookings: { data: bookings, error: null },
        profiles: { data: { id: 'h1', stripe_account_id: null, stripe_payouts_enabled: false }, error: null },
    });
    const { route, logged } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.body.skipped, 2, 'both stays wait');
    assert.equal(res.body.sent, 0);
    assert.equal(res.body.hostsWaitingToOnboard, 1, 'one host, not two lines');

    assert.equal(logged.length, 1, 'one line per host per run, not one per stay');
    const message = String(logged[0].message || logged[0]);
    assert.match(message, /2 stays/, 'says how many are waiting');
    assert.match(message, /800\.00/, 'says how much is held up');
    assert.match(message, /payouts/i);
});

// ---------------------------------------------------------------------------
// A RETRY MUST NOT PAY THE SAME STAY TWICE
// ---------------------------------------------------------------------------
//
// The run sends the transfer, then writes the payout row, then stamps
// `paid_out_at`. Only the first of those moves money, so dying between them
// leaves the money gone and the booking still looking unpaid — and the next
// day's run picks it straight back up.
//
// The idempotency key was the whole defence and it is not enough. Watched on
// the test project on 31 August 2026: inside Stripe's 24-hour key retention
// the transfer was correctly replayed but a SECOND payout row was written for
// it, so the ledger claimed £360 had gone twice when £360 had gone once. The
// cron interval is 24 hours, so the next retry is outside the retention and
// the replay becomes a real second transfer.
//
// These two tests hold the ledger check that replaced it.

// A `payouts` handler that answers the pre-flight lookup and the later
// inserts differently. The pre-flight is the only read that filters on
// kind = 'transfer', which is what tells them apart.
function payoutsLedger(existing: any, error: any = null) {
    return (state: any) => {
        const isPreflight = state.ops.some(
            (o: any) => o.op === 'eq' && o.args[0] === 'kind' && o.args[1] === 'transfer'
        );
        if (isPreflight) return { data: existing, error };
        return { data: [], error: null };
    };
}

const paidStay = {
    id: 'b1', listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01',
    total_price: 500, amount_paid: 500, amount_refunded: 0,
    commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
    stripe_payment_intent_id: null, balance_payment_intent_id: null,
};

const readyHost = {
    id: 'h1', stripe_account_id: 'acct_1', stripe_payouts_enabled: true, payout_balance_owed: 0,
};

test('a stay whose transfer already went is reconciled, not sent again', async () => {
    const { client } = fakeSupabase({
        bookings: { data: [paidStay], error: null },
        profiles: { data: readyHost, error: null },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
        payouts: payoutsLedger({ id: 'p1', amount: 450, stripe_transfer_id: 'tr_already' }),
    });

    // loadRoute stubs stripeRequest to throw. That is the assertion that
    // matters here: reaching Stripe at all would be the bug.
    const { route, logged } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 0, 'nothing was sent — the money had already gone');
    assert.equal(res.body.failed, 0, 'and it is not a failure');
    assert.equal(res.body.reconciled, 1);

    assert.equal(logged.length, 1, 'a run dying part-way through is worth knowing about');
    assert.match(String(logged[0].message), /already been transferred/i);
    assert.match(String(logged[0].message), /tr_already/);
    assert.match(String(logged[0].message), /no second transfer/i);
});

test('a ledger the run cannot read stops it sending, rather than sending blind', async () => {
    const { client } = fakeSupabase({
        bookings: { data: [paidStay], error: null },
        profiles: { data: readyHost, error: null },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
        payouts: payoutsLedger(null, { message: 'connection reset' }),
    });
    const { route, logged } = loadRoute(client);

    const res: any = await route.GET(authorised());

    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 0, 'an unanswered question must not become a transfer');
    assert.equal(res.body.skipped, 1, 'it waits for a run that can read the ledger');
    assert.equal(res.body.reconciled, 0);
    assert.match(String(logged[0].message), /could not check whether this stay had already been paid/i);
});
