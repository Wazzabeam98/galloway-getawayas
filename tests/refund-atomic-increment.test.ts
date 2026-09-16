// What has been refunded on a booking is a money column, and it was being
// read into JavaScript, added to, and written back — the lost-update the
// host-debt RPC was written to stop, still live on two refund routes
// (AUDIT-FAILURE-PATHS-2026-09-14.md ranks 3–5). A host goodwill refund landing
// in the window of a guest cancel overwrote it: two refunds at Stripe, one on
// the books, and the stale figure then let the next refund exceed what was
// left.
//
// The fix moves the arithmetic into record_booking_refund, which locks the row
// and adds inside one statement, clamped at what was paid, and returns how much
// actually fit so an overlap can be reported rather than lost. These tests hold
// the routes to it: they must call the RPC and must NOT compute amount_refunded
// themselves. The real-money proof that concurrent refunds sum is in
// scripts/refund-scenarios.mjs.
//
// Nothing here reaches Stripe or a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.CRON_SECRET = 'test-secret';

// A refund that really went back: £250 spread over one charge.
const ISSUED = {
    refundedPence: 25000,
    refunds: [{ id: 're_1' }],
    shares: [25000],
    charges: [{ intentId: 'pi_1' }],
    failure: null,
};

// Builds the service-role client. `rpcResult` is what record_booking_refund
// resolves to; the default is a clean apply of the whole amount.
function makeAdmin(rows: Record<string, any>, rpcResult?: any) {
    const rpcCalls: { name: string; args: any }[] = [];
    const bookingUpdates: any[] = [];
    const paymentsInserts: any[] = [];

    const admin: any = {
        from(table: string) {
            return new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'then') return (r: any) => r({ data: rows[table] ?? null, error: null });
                    if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: rows[table] ?? null, error: null });
                    if (prop === 'insert') return async (row: any) => { paymentsInserts.push({ table, row }); return { data: null, error: null }; };
                    if (prop === 'update') {
                        return (patch: any) => {
                            const upd: any = new Proxy({}, {
                                get(_u, p: string) {
                                    if (p === 'then') return (r: any) => { bookingUpdates.push({ table, patch }); return r({ data: null, error: null }); };
                                    if (p === 'select') return () => ({ then: (r: any) => { bookingUpdates.push({ table, patch }); return r({ data: [{ id: 'x' }], error: null }); } });
                                    return () => upd;
                                },
                            });
                            return upd;
                        };
                    }
                    return () => new Proxy({}, {
                        get: (_x, p: string) => {
                            if (p === 'then') return (r: any) => r({ data: rows[table] ?? null, error: null });
                            if (p === 'maybeSingle' || p === 'single') return async () => ({ data: rows[table] ?? null, error: null });
                            return () => (admin.from(table));
                        },
                    });
                },
            });
        },
        rpc(name: string, args: any) {
            rpcCalls.push({ name, args });
            const result = rpcResult !== undefined
                ? rpcResult
                : { data: { new_amount_refunded: null, amount_paid: null, applied: args.p_amount, payment_status: 'partially_refunded' }, error: null };
            return { maybeSingle: async () => result };
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    return { admin, rpcCalls, bookingUpdates, paymentsInserts };
}

function commonStubs(logged: string[]) {
    stubModule('@/lib/logError', { logError: async (m: string) => { logged.push(m); } });
    stubModule('@/lib/email', {
        sendEmail: async () => true, emailLayout: (b: string) => b, escapeHtml: (x: string) => x,
        SITE_URL: 'http://example.invalid', button: () => '', formatDate: () => '',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });
    stubModule('next/headers', { cookies: () => ({}) });
}

/* ============================ bookings/cancel ============================ */

const CANCEL_ROUTE = '@/app/api/bookings/cancel/route';

function loadCancel(rpcResult?: any) {
    const logged: string[] = [];
    const rows = {
        bookings: {
            id: 'b-1', listing_id: 'l-1', guest_id: 'g-1', check_in: '2099-06-01',
            status: 'confirmed', payment_status: 'paid', amount_paid: 500, amount_refunded: 0,
            cleaning_fee: 0, stripe_payment_intent_id: 'pi_1', balance_payment_intent_id: null, balance_amount: 0,
        },
        listings: { title: 'Harbour Cottage', cancellation_policy: 'Flexible' },
    };
    const built = makeAdmin(rows, rpcResult);

    stubModule('@supabase/supabase-js', { createClient: () => built.admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: 'g-1', email: 'guest@example.invalid' } } }) },
        }),
    });
    stubModule('@/lib/refundSpread', { issueRefunds: async () => ISSUED });
    stubModule('@/lib/cancellation', { refundDue: () => 250 });
    stubModule('@/lib/experienceCancel', { cancelStayExperienceOrders: async () => {} });
    commonStubs(logged);

    // Only the route and the admin client are cleared so they re-wire onto the
    // stubs. Clearing a stubbed lib would delete the stub from require.cache.
    clearModule('@/lib/supabaseAdmin');
    clearModule(CANCEL_ROUTE);
    const route = require('../app/api/bookings/cancel/route');
    return { route, ...built, logged };
}

const cancelReq = () => new Request('http://example.invalid/api/bookings/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookingId: 'b-1' }),
});

test('cancel records the refund through the atomic RPC, with the amount refunded', async () => {
    const { route, rpcCalls } = loadCancel();
    const res: any = await route.POST(cancelReq());

    assert.equal(res.status, 200);
    assert.equal(rpcCalls.length, 1, 'the money column moves once, atomically');
    assert.equal(rpcCalls[0].name, 'record_booking_refund');
    assert.deepEqual(rpcCalls[0].args, { p_booking: 'b-1', p_amount: 250 });
});

test('cancel never computes amount_refunded itself', async () => {
    const { route, bookingUpdates } = loadCancel();
    await route.POST(cancelReq());

    const wroteMoney = bookingUpdates.filter(
        (u) => u.table === 'bookings'
            && (u.patch.amount_refunded !== undefined || u.patch.payment_status !== undefined),
    );
    assert.equal(wroteMoney.length, 0,
        'amount_refunded / payment_status belong to the RPC — writing them here is the lost update');

    // The stay is still closed off, on the id, without the money columns.
    const closed = bookingUpdates.find((u) => u.table === 'bookings' && u.patch.status === 'cancelled');
    assert.ok(closed, 'the booking is still cancelled');
    assert.equal(closed.patch.balance_amount, 0);
    assert.equal(closed.patch.cancelled_by_role, 'guest');
});

test('cancel reports when a concurrent refund left less room than it refunded', async () => {
    // The RPC applied only £100 of the £250 — the total hit what was paid
    // because another refund took the headroom at the same moment.
    const { route, logged } = loadCancel({
        data: { new_amount_refunded: 500, amount_paid: 500, applied: 100, payment_status: 'refunded' }, error: null,
    });
    await route.POST(cancelReq());

    assert.ok(logged.some((m) => /concurrent refund overlapped; reconcile at Stripe/i.test(m)),
        'the overlap is surfaced, not swallowed');
});

test('cancel reports when the refund could not be recorded at all', async () => {
    const { route, logged } = loadCancel({ data: null, error: { message: 'rpc failed' } });
    await route.POST(cancelReq());

    assert.ok(logged.some((m) => /could not record it against the booking/i.test(m)),
        'money moved but the record did not — the dangerous case is reported');
});

/* ========================== bookings/host-refund ========================== */

const HOST_REFUND_ROUTE = '@/app/api/bookings/host-refund/route';

function loadHostRefund(rpcResult?: any) {
    const logged: string[] = [];
    const rows = {
        bookings: {
            id: 'b-1', listing_id: 'l-1', guest_id: 'g-1', host_id: 'h-1', check_in: '2099-06-01',
            status: 'confirmed', payment_status: 'paid', amount_paid: 500, amount_refunded: 0,
            stripe_payment_intent_id: 'pi_1', balance_payment_intent_id: null, payout_transfer_id: null, payout_amount: null,
        },
        listings: { title: 'Harbour Cottage' },
    };
    const built = makeAdmin(rows, rpcResult);

    stubModule('@supabase/supabase-js', { createClient: () => built.admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: 'h-1', email: 'host@example.invalid' } } }) },
        }),
    });
    stubModule('@/lib/refundSpread', { issueRefunds: async () => ISSUED });
    stubModule('@/lib/clawback', { clawBackPayout: async () => {} });
    commonStubs(logged);

    clearModule('@/lib/supabaseAdmin');
    clearModule(HOST_REFUND_ROUTE);
    const route = require('../app/api/bookings/host-refund/route');
    return { route, ...built, logged };
}

const hostRefundReq = () => new Request('http://example.invalid/api/bookings/host-refund', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookingId: 'b-1', amount: 250 }),
});

test('host-refund records the refund through the atomic RPC and writes no money column itself', async () => {
    const { route, rpcCalls, bookingUpdates } = loadHostRefund();
    const res: any = await route.POST(hostRefundReq());

    assert.equal(res.status, 200);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'record_booking_refund');
    assert.deepEqual(rpcCalls[0].args, { p_booking: 'b-1', p_amount: 250 });

    const wroteMoney = bookingUpdates.filter(
        (u) => u.table === 'bookings'
            && (u.patch.amount_refunded !== undefined || u.patch.payment_status !== undefined),
    );
    assert.equal(wroteMoney.length, 0, 'the read-then-write on amount_refunded is gone');
});

test('host-refund reports a concurrent-overlap clamp', async () => {
    const { route, logged } = loadHostRefund({
        data: { new_amount_refunded: 500, amount_paid: 500, applied: 100, payment_status: 'refunded' }, error: null,
    });
    await route.POST(hostRefundReq());

    assert.ok(logged.some((m) => /concurrent refund overlapped; reconcile at Stripe/i.test(m)));
});

/* ===================== balance-charges give-up refund ===================== */

const BALANCE_ROUTE = '@/app/api/cron/balance-charges/route';

test('the give-up refund carries an idempotency key, so a retry replays it', async () => {
    const refundCalls: { path: string; key: string | undefined }[] = [];
    const logged: string[] = [];

    const due = {
        id: 'bk-9', listing_id: 'l-1', guest_id: 'g-1', host_id: 'h-1',
        check_in: '2099-01-01', check_out: '2099-01-04',
        balance_amount: 600, balance_due_date: '2020-01-01',
        balance_attempts: 3, balance_last_attempt_at: null,
        amount_paid: 200, amount_refunded: 0, cleaning_fee: 0,
        stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1',
        stripe_payment_intent_id: 'pi_deposit', payment_status: 'deposit_paid', status: 'confirmed',
    };

    const admin: any = {
        from() {
            return new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'then') return (r: any) => r({ data: [due], error: null });
                    if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
                    if (prop === 'insert') return async () => ({ data: null, error: null });
                    if (prop === 'update') return () => new Proxy({}, { get: (_u, p: string) => (p === 'then' ? (r: any) => r({ data: null, error: null }) : () => ({ then: (r: any) => r({ data: null, error: null }) })) });
                    return () => new Proxy({}, { get: (_x, p: string) => (p === 'then' ? (r: any) => r({ data: [due], error: null }) : p === 'maybeSingle' ? async () => ({ data: null, error: null }) : () => admin.from()) });
                },
            });
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/cancellation', { refundDue: () => 200 });
    stubModule('@/lib/dayKey', { londonDayKey: () => '2099-01-01' });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string, _body: any, key?: string) => {
            if (path === '/refunds') refundCalls.push({ path, key });
            return { id: 're_1', status: 'succeeded' };
        },
    });
    commonStubs(logged);

    clearModule('@/lib/supabaseAdmin');
    clearModule(BALANCE_ROUTE);
    const route = require('../app/api/cron/balance-charges/route');

    await route.GET(new Request('http://example.invalid/api/cron/balance-charges', {
        headers: { authorization: 'Bearer test-secret' },
    }));

    assert.equal(refundCalls.length, 1, 'the give-up path refunds once');
    assert.equal(refundCalls[0].key, 'balance-giveup-refund-bk-9',
        'keyed on the booking, so a retried run replays the one refund rather than sending a second');
});
