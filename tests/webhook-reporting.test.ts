// A Stripe webhook that fails must say so somewhere a person will look.
//
// WHY THIS FILE EXISTS, SEPARATELY FROM tests/webhook.test.ts
//
// That file is about what the handler DOES with a payment. This one is about
// what happens when it cannot, which until now was: nothing. The handler
// caught everything, wrote one line to console.error, and answered Stripe
// "ok". A guest paid, the booking stayed unconfirmed, Stripe recorded the
// event as delivered, and no alert reached anybody. It was demonstrated
// end to end against real test-mode payments before it was changed —
// see WEBHOOK-FAILURE.md for both transcripts.
//
// WHY THE RESPONSE IS STILL 200, AND WHY A TEST PINS THAT
//
// The obvious repair is to return 500 so Stripe retries. It does not work and
// it is not safe, and both halves are asserted below so that a future change
// to a 500 has to argue with a failing test rather than with a comment:
//
//   It does not work, because the stripe_events row is written BEFORE the
//   handler runs. Stripe's retry carries the same event id, hits the
//   duplicate check, and is answered 200 without the handler running.
//
//   It is not safe, because if that were changed so a retry did re-run, the
//   balance branch ADDS to amount_paid rather than setting it, and `payments`
//   has no unique key on the payment intent. A retry over a partial write
//   double-counts money.
//
// The answer is therefore reporting, not retrying.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const ROUTE = '@/app/api/stripe/webhook/route';

const BOOKING = {
    id: 'b-1', status: 'pending_payment', total_price: 300, listing_id: 'l-1',
    amount_paid: 0, guest_id: 'g-1', check_in: '2099-01-01',
};

/**
 * `throwOn` names a table whose write blows up rather than returning an error,
 * which is what an unexpected shape or a dropped connection actually looks
 * like from inside the handler.
 *
 * `errorOn` is the quieter one: supabase-js handing an error BACK rather than
 * throwing it. That is the case that never reached the catch at all, because
 * there was nothing to catch.
 */
function load(options: {
    throwOn?: string;
    errorOn?: { table: string; op: 'insert' | 'update'; error: any };
    eventInsertError?: any;
    booking?: any;
} = {}) {
    const booking = options.booking === undefined ? BOOKING : options.booking;
    const reported: any[] = [];
    const inserts: any[] = [];
    const updates: any[] = [];

    const fails = (table: string, op: 'insert' | 'update') =>
        options.errorOn && options.errorOn.table === table && options.errorOn.op === op
            ? { data: null, error: options.errorOn.error }
            : { data: null, error: null };

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain,
                        limit: () => chain,
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
                            if (options.throwOn === table) throw new Error('boom in ' + table);
                            updates.push({ table, patch, id });
                            return fails(table, 'update');
                        },
                    };
                },
                insert: async (row: any) => {
                    if (options.throwOn === table) throw new Error('boom in ' + table);
                    inserts.push({ table, row });
                    if (table === 'stripe_events' && options.eventInsertError) {
                        return { data: null, error: options.eventInsertError };
                    }
                    return fails(table, 'insert');
                },
                upsert: async (row: any) => {
                    inserts.push({ table, row });
                    return fails(table, 'insert');
                },
            };
        },
    };

    (admin as any).auth = {
        admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', {
        verifyStripeSignature: async () => true,
        stripeRequest: async () => ({ payment_method: 'pm_1', customer: 'cus_1' }),
    });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => {
            reported.push({ message, detail, context });
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async () => true,
        sendEmailToAll: async () => ({ sent: [], failed: [] }),
        recipients: () => [],
        emailLayout: (b: string) => b,
        escapeHtml: (x: string) => x,
        formatDate: () => '1 January',
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require('../app/api/stripe/webhook/route');
    return { route, reported, inserts, updates };
}

function completedSession(kind: string, amountTotal: number, id = 'evt_report_' + kind) {
    return new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id,
            type: 'checkout.session.completed',
            data: {
                object: {
                    payment_status: 'paid',
                    amount_total: amountTotal,
                    payment_intent: 'pi_1',
                    customer: 'cus_1',
                    client_reference_id: 'b-1',
                    metadata: { booking_id: 'b-1', kind },
                },
            },
        }),
    });
}

const said = (reported: any[]) => reported.map((r) => r.message).join(' | ');

/* ------------------------------------------------------- the top-level catch */

test('a handler that throws while confirming a paid booking is reported', async () => {
    const { route, reported } = load({ throwOn: 'bookings' });
    await route.POST(completedSession('full', 30000));

    assert.equal(reported.length, 1, 'exactly one report, not none and not a storm: ' + said(reported));
    assert.match(
        reported[0].message,
        /handler threw on checkout\.session\.completed/,
        'the message names the event type, because that is what you search Stripe by'
    );
    assert.equal(reported[0].context.path, 'stripe/webhook');
});

test('the report carries the booking id, because that is the thing now wrong', async () => {
    const { route, reported } = load({ throwOn: 'bookings' });
    await route.POST(completedSession('full', 30000));

    assert.equal(reported[0].detail.booking_id, 'b-1');
});

test('the report carries the Stripe event id, so the event can be found again', async () => {
    const { route, reported } = load({ throwOn: 'bookings' });
    await route.POST(completedSession('full', 30000, 'evt_needle'));

    assert.equal(reported[0].detail.event_id, 'evt_needle');
});

// The reason this is 200 is not that failures do not matter. It is that a 500
// achieves nothing here and a working retry would be unsafe. Changing it
// should mean arguing with this test.
test('Stripe is still answered 200, because a retry cannot help and would not be safe', async () => {
    const { route } = load({ throwOn: 'bookings' });
    const res: any = await route.POST(completedSession('full', 30000));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
});

test('a redelivery of the same event is refused before the handler runs', async () => {
    const { route } = load({ eventInsertError: { code: '23505' } });
    const res: any = await route.POST(completedSession('full', 30000));

    // This is why a 500 would not help: Stripe's retry carries the same event
    // id, and never gets past here.
    assert.equal(res.body.duplicate, true);
    assert.equal(res.status, 200);
});

/* ------------------------------------- writes that hand back an error quietly */

test('a booking confirmed but missing from the payments ledger is reported', async () => {
    const { route, reported } = load({
        errorOn: { table: 'payments', op: 'insert', error: { code: '23503', message: 'no such booking' } },
    });
    await route.POST(completedSession('full', 30000));

    assert.ok(
        reported.some((r) => /missing from the payments ledger/.test(r.message)),
        'nothing visible breaks here, so nothing but a report will find it: ' + said(reported)
    );
});

test('a balance payment that cannot be recorded on the booking is reported', async () => {
    const { route, reported } = load({
        errorOn: { table: 'bookings', op: 'update', error: { code: '08006', message: 'connection failure' } },
    });
    await route.POST(completedSession('balance', 15000));

    assert.ok(
        reported.some((r) => /paid their balance and the booking could not be updated/.test(r.message)),
        said(reported)
    );
});

test('a host whose Stripe account state could not be saved is reported', async () => {
    const { route, reported } = load({
        errorOn: { table: 'profiles', op: 'update', error: { code: '08006', message: 'connection failure' } },
    });

    await route.POST(new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id: 'evt_acct_1',
            type: 'account.updated',
            data: { object: { id: 'acct_1', payouts_enabled: true, charges_enabled: true, details_submitted: true } },
        }),
    }));

    assert.ok(
        reported.some((r) => /payouts to them will be skipped/.test(r.message)),
        'a host silently stuck as "cannot be paid" is a payout that never gets attempted: ' + said(reported)
    );
});

test('an event that could not be recorded is reported, because dedupe is now off for it', async () => {
    const { route, reported } = load({
        eventInsertError: { code: '08006', message: 'connection failure' },
    });
    await route.POST(completedSession('full', 30000));

    assert.ok(
        reported.some((r) => /rather than recognised as a duplicate/.test(r.message)),
        said(reported)
    );
});

/* ------------------------------------------------------------ the happy path */

test('a booking that confirms normally reports nothing at all', async () => {
    const { route, reported } = load();
    await route.POST(completedSession('full', 30000));

    assert.equal(reported.length, 0, 'a quiet success must stay quiet: ' + said(reported));
});
