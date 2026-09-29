// The launch-readiness fixes, held by intent:
//
//   1. A charged guest is never left at pending_payment: the reconcile cron
//      finds a paid deposit/full payment the webhook never settled and settles
//      it through the webhook's own function — and a second settle of the
//      same payment writes nothing and emails nobody.
//   2. A webhook refused for its signature reaches /admin/errors.
//   3. A payout run that ends with due stays unpaid emails the directors now.
//
// No database, no Stripe, no mail: everything is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases, fakeSupabase, updateChain } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

function commonStubs(opts: { stripe: (method: string, path: string, body?: any) => any; verify?: boolean }) {
    const logged: any[] = [];
    const emails: any[] = [];
    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => { logged.push({ message, detail, context }); },
    });
    stubModule('@/lib/stripe', {
        verifyStripeSignature: async () => opts.verify !== false,
        stripeRequest: async (method: string, path: string, body?: any) => opts.stripe(method, path, body),
    });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string) => { emails.push({ to, subject }); return true; },
        sendEmailToAll: async (to: string[], subject: string) => {
            to.forEach((a) => emails.push({ to: a, subject }));
            return { sent: to, failed: [] };
        },
        recipients: (v: string) => String(v || '').split(',').map((a) => a.trim()).filter(Boolean),
        emailLayout: (b: string) => b, escapeHtml: (x: string) => x, formatDate: () => '1 Jan',
        button: () => '', detailRows: () => '', noteCallout: () => '', allergyCallout: () => '',
        SITE_URL: 'http://example.invalid', NEUTRAL_SUBTITLE: '',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });
    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/moneyAlert');
    clearModule('@/lib/settlePaidBooking');
    clearModule('@/lib/bookingPaymentReconcile');
    return { logged, emails };
}

// A small database for the settle path: one booking, with the confirm write a
// compare-and-set that only succeeds while it is still pending_payment.
function settleDb(initialStatus: string) {
    const booking: any = {
        id: 'b-1', status: initialStatus, total_price: 300, listing_id: 'l-1', amount_paid: 0,
        amount_refunded: 0, guests: 2, guest_id: 'g-1', host_id: 'h-1', check_in: '2099-01-01', check_out: '2099-01-04',
    };
    const inserts: any[] = [];
    const confirms: any[] = [];
    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain, in: () => chain, gte: () => chain, lt: () => chain, order: () => chain,
                        maybeSingle: async () => ({ data: table === 'listings' ? { instant_book: true, title: 'A cottage' } : booking, error: null }),
                        then: (r: any) => r({ data: table === 'profiles' ? [] : [booking], error: null }),
                    };
                    return chain;
                },
                update(patch: any) {
                    return updateChain(async (_id, filters) => {
                        if (table !== 'bookings') return { data: null, error: null };
                        // A real database applies whatever filters the code
                        // sends, and only those.
                        if (filters.some(([c, v]) => booking[c] !== v)) return { data: [], error: null };
                        Object.assign(booking, patch);
                        confirms.push(patch);
                        return { data: [{ id: booking.id }], error: null };
                    });
                },
                insert: async (row: any) => { inserts.push({ table, row }); return { data: null, error: null }; },
            };
        },
        auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: id + '@example.invalid' } } }) } },
    };
    return { admin, booking, inserts, confirms };
}

// ---------------------------------------------------------------------------
// 1. NEVER TWICE
// ---------------------------------------------------------------------------

test('a payment settled twice confirms once, records once and emails once', async () => {
    const { emails } = commonStubs({ stripe: async () => ({ payment_method: 'pm_1', customer: 'cus_1' }) });
    const db = settleDb('pending_payment');
    const { settlePaidBookingSession } = require('../lib/settlePaidBooking');
    const cs = {
        payment_status: 'paid', amount_total: 30000, payment_intent: 'pi_1', customer: 'cus_1',
        client_reference_id: 'b-1', metadata: { booking_id: 'b-1', kind: 'full' },
    };

    const first = await settlePaidBookingSession(db.admin, cs, 'evt_1');
    const emailsAfterFirst = emails.length;
    // The webhook and the cron (or the success page) racing on one payment.
    const second = await settlePaidBookingSession(db.admin, cs, null);

    assert.equal(first.already, undefined);
    assert.equal(db.booking.status, 'confirmed', 'instant book confirms on payment');
    assert.equal(second.already, true, 'the second settle finds it already done');
    assert.equal(db.confirms.length, 1, 'one confirming write, not two');
    assert.equal(db.inserts.filter((i) => i.table === 'payments').length, 1, 'one ledger row');
    assert.ok(emailsAfterFirst > 0, 'the first settle tells the host and guest');
    assert.equal(emails.length, emailsAfterFirst, 'the second sends nothing');
});

test('a late replay cannot put an accepted request booking back to pending', async () => {
    commonStubs({ stripe: async () => ({ payment_method: 'pm_1' }) });
    const db = settleDb('confirmed');
    const { settlePaidBookingSession } = require('../lib/settlePaidBooking');
    const res = await settlePaidBookingSession(db.admin, {
        payment_status: 'paid', amount_total: 30000, payment_intent: 'pi_1',
        metadata: { booking_id: 'b-1', kind: 'full' },
    }, 'evt_replay');

    assert.equal(res.already, true);
    assert.equal(db.booking.status, 'confirmed');
    assert.equal(db.confirms.length, 0);
});

// ---------------------------------------------------------------------------
// 1b. THE RECONCILE CRON
// ---------------------------------------------------------------------------

function loadCron(db: any, intents: any[]) {
    const stripeCalls: string[] = [];
    const stubs = commonStubs({
        stripe: async (method: string, path: string) => {
            stripeCalls.push(method + ' ' + path);
            if (path === '/payment_intents') return { data: intents, has_more: false };
            return { payment_method: 'pm_1', customer: 'cus_1' };
        },
    });
    stubModule('@supabase/supabase-js', { createClient: () => db.admin });
    clearModule('@/app/api/cron/booking-payments/route');
    const route = require('../app/api/cron/booking-payments/route');
    return { route, stripeCalls, ...stubs };
}

const authorised = (path: string) =>
    new Request('http://example.invalid' + path, { headers: { authorization: 'Bearer test-secret' } });

test('the reconcile cron refuses a call without the cron secret', async () => {
    const { route } = loadCron(settleDb('pending_payment'), []);
    const res: any = await route.GET(new Request('http://example.invalid/api/cron/booking-payments'));
    assert.equal(res.status, 401);
});

test('a guest charged at Stripe whose webhook never came is confirmed by the cron', async () => {
    const db = settleDb('pending_payment');
    const { route, logged } = loadCron(db, [
        { id: 'pi_paid', status: 'succeeded', amount_received: 30000, customer: 'cus_1', metadata: { booking_id: 'b-1', kind: 'full' } },
    ]);

    const res: any = await route.GET(authorised('/api/cron/booking-payments'));

    assert.equal(res.body.recovered, 1);
    assert.equal(db.booking.status, 'confirmed');
    assert.equal(db.booking.amount_paid, 300);
    assert.equal(db.booking.stripe_payment_intent_id, 'pi_paid');
    assert.ok(logged.some((l) => /webhook never settled/.test(l.message)),
        'a recovery is reported, because it means the webhook is not landing');
});

test('the cron ignores payments that did not open a booking, or did not succeed', async () => {
    const db = settleDb('pending_payment');
    const { route } = loadCron(db, [
        // A balance, a change payment with no kind, and a failed card.
        { id: 'pi_bal', status: 'succeeded', amount_received: 10000, metadata: { booking_id: 'b-1', kind: 'balance' } },
        { id: 'pi_other', status: 'succeeded', amount_received: 5000, metadata: { booking_id: 'b-1' } },
        { id: 'pi_fail', status: 'requires_payment_method', amount: 30000, metadata: { booking_id: 'b-1', kind: 'full' } },
    ]);

    const res: any = await route.GET(authorised('/api/cron/booking-payments'));

    assert.equal(res.body.recovered, 0);
    assert.equal(db.booking.status, 'pending_payment');
    assert.equal(db.confirms.length, 0);
});

// ---------------------------------------------------------------------------
// 2. A REFUSED SIGNATURE IS REPORTED
// ---------------------------------------------------------------------------

test('a webhook that fails its signature check reaches /admin/errors', async () => {
    const { logged } = commonStubs({ stripe: async () => ({}), verify: false });
    stubModule('@supabase/supabase-js', { createClient: () => settleDb('pending_payment').admin });
    clearModule('@/app/api/stripe/webhook/route');
    const route = require('../app/api/stripe/webhook/route');

    const res: any = await route.POST(new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=bad' },
        body: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' }),
    }));

    assert.equal(res.status, 400);
    assert.equal(logged.length, 1);
    assert.match(logged[0].message, /signature/);
    assert.equal(logged[0].detail.claimed_event_id, 'evt_forged');
});

// ---------------------------------------------------------------------------
// 3. A BAD PAYOUT RUN EMAILS BOTH DIRECTORS
// ---------------------------------------------------------------------------

const dueStay = {
    id: 'b1', listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01',
    total_price: 500, amount_paid: 500, amount_refunded: 0,
    commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
};

function loadPayouts(bookings: any[], stripe: (m: string, p: string) => any) {
    const stubs = commonStubs({ stripe: async (m: string, p: string) => stripe(m, p) });
    const { client } = fakeSupabase({
        bookings: { data: bookings, error: null },
        profiles: { data: { id: 'h1', stripe_account_id: 'acct_1', stripe_payouts_enabled: true, payout_balance_owed: 0 }, error: null },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
        payouts: { data: null, error: null },
    });
    stubModule('@supabase/supabase-js', { createClient: () => client });
    clearModule('@/app/api/cron/host-payouts/route');
    const route = require('../app/api/cron/host-payouts/route');
    return { route, ...stubs };
}

test('a failed transfer emails both directors straight away', async () => {
    process.env.DISPUTES_ALERT_EMAIL = 'liam@example.invalid, jamie@example.invalid';
    const { route, emails } = loadPayouts([dueStay], (_m, p) => {
        if (p === '/transfers') throw new Error('balance_insufficient');
        return { data: [] };
    });

    const res: any = await route.GET(authorised('/api/cron/host-payouts'));

    assert.equal(res.body.failed, 1);
    assert.equal(res.body.problems, 1);
    const alerts = emails.filter((e) => /^Money alert/.test(e.subject));
    assert.deepEqual(alerts.map((e) => e.to).sort(), ['jamie@example.invalid', 'liam@example.invalid'],
        'one copy to each director');
    assert.match(alerts[0].subject, /did not complete/);
});

test('a run that runs out of time names the stays it never reached', async () => {
    process.env.DISPUTES_ALERT_EMAIL = 'liam@example.invalid';
    const realNow = Date.now;
    let calls = 0;
    // The first reading starts the clock; every later one is past the limit.
    Date.now = () => realNow() + (calls++ === 0 ? 0 : 60000);
    try {
        const { route, emails } = loadPayouts([dueStay, { ...dueStay, id: 'b2' }], () => {
            throw new Error('nothing should be sent after the time limit');
        });
        const res: any = await route.GET(authorised('/api/cron/host-payouts'));

        assert.equal(res.body.notReached, 2);
        assert.equal(res.body.sent, 0);
        const alerts = emails.filter((e) => /^Money alert/.test(e.subject));
        assert.equal(alerts.length, 1, 'one summary, not one email per stay');
    } finally {
        Date.now = realNow;
    }
});

test('a clean run emails the directors nothing', async () => {
    process.env.DISPUTES_ALERT_EMAIL = 'liam@example.invalid';
    const { route, emails } = loadPayouts([], () => ({}));
    const res: any = await route.GET(authorised('/api/cron/host-payouts'));
    assert.equal(res.body.problems, 0);
    assert.equal(emails.filter((e) => /^Money alert/.test(e.subject)).length, 0);
});
