// The admin refund on an experience order (app/api/admin/experience-orders/refund).
// Supabase and Stripe are stubbed entirely — nothing here reaches either.
//
// What it must get right, each asserted below:
//   * WHO         — signed in (getUser) and an admin, or nothing happens.
//   * REASON      — the shared rule refuses a missing/short reason before money.
//   * CAP         — what is left is read from Stripe and the order, not the browser.
//   * AGREEMENT   — Stripe and the order must agree; a stale page is refused.
//   * KEY         — the Stripe key is the pre-written refund row's id; a second
//                   click (a pending row already there) never reaches Stripe.
//   * ORDER       — Stripe first, then amount_refunded (RPC), then status, then
//                   the audit row, then the emails. If Stripe fails, none of the rest.
//   * FLOWS       — held before payout: plain refund, no clawback; held after
//                   payout: refund then clawback of the provider's share, a
//                   shortfall owed + the directors told; direct: the old way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/admin/experience-orders/refund/route';

// £110 dinner, our fee £11 frozen.
const HELD = {
    id: 'o1', provider_id: 'p1', guest_id: 'g1', status: 'confirmed', cancel_ack: null,
    service_date: '2099-01-01', shape: 'comes_to_you', slot_session_id: null, quantity: 1,
    price: 110, commission_rate: 0.1, amount_refunded: 0, item_name: 'Dinner',
    provider_business_name: 'Solway Table', guest_name: 'Morag Bell', guest_email: 'morag@example.invalid',
    stripe_payment_intent_id: 'pi_1',
    funds_flow: 'held', platform_fee: 11, paid_out_at: null, payout_amount: null, payout_transfer_id: null,
    payout_reversed: 0, payout_clawback_owed: 0,
};
const PAID_OUT = { ...HELD, service_date: '2020-01-01', paid_out_at: '2020-01-02T09:00:00Z', payout_amount: 99, payout_transfer_id: 'tr_1' };
const DIRECT = { ...HELD, funds_flow: 'direct', platform_fee: null };

interface Setup {
    user?: any;
    admin?: boolean;
    order?: any;
    charge?: any;
    refundError?: any;
    insertError?: any;
    reachable?: number | null;
}

function load(setup: Setup) {
    const timeline: string[] = [];
    const stripeCalls: Array<{ method: string; path: string; body: any; key?: string }> = [];
    const inserts: Array<{ table: string; row: any }> = [];
    const updates: Array<{ table: string; patch: any; ops: any[] }> = [];
    const rpcs: Array<{ name: string; args: any }> = [];
    const emails: Array<{ to: string; subject: string; html: string }> = [];
    const logged: any[] = [];
    const moneyAlerts: any[] = [];
    const order = setup.order || HELD;

    function builder(table: string) {
        const state: any = { table, ops: [], kind: 'select' };
        const resolve = () => {
            if (state.kind === 'insert') {
                inserts.push({ table, row: state.row });
                timeline.push('insert:' + table);
                if (table === 'service_order_refunds') {
                    return setup.insertError ? { data: null, error: setup.insertError } : { data: { id: 'req-123' }, error: null };
                }
                return { data: null, error: null };
            }
            if (state.kind === 'update') {
                updates.push({ table, patch: state.patch, ops: state.ops });
                timeline.push('update:' + table + ':' + Object.keys(state.patch).join(','));
                return { data: [{ id: 'x' }], error: null };
            }
            if (table === 'service_orders') return { data: order, error: null };
            if (table === 'service_order_refunds') return { data: [], error: null };
            if (table === 'service_providers') return { data: { contact_email: 'chef@example.invalid', stripe_account_id: 'acct_p1' }, error: null };
            if (table === 'profiles') return { data: { full_name: 'Morag Bell' }, error: null };
            return { data: null, error: null };
        };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') return (r: any) => r(resolve());
                if (prop === 'maybeSingle' || prop === 'single') return async () => resolve();
                if (prop === 'insert') return (row: any) => { state.kind = 'insert'; state.row = row; return chain; };
                if (prop === 'update') return (patch: any) => { state.kind = 'update'; state.patch = patch; return chain; };
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }
    const client: any = {
        from: (t: string) => builder(t),
        rpc: (name: string, args: any) => {
            rpcs.push({ name, args });
            timeline.push('rpc:' + name);
            return { maybeSingle: async () => ({ data: { new_amount_refunded: args.p_amount, price: 110, applied: args.p_amount }, error: null }) };
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'morag@example.invalid' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => client });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: {
                getUser: async () => ({ data: { user: setup.user === undefined ? { id: 'admin-1' } : setup.user } }),
                getSession: async () => { throw new Error('getSession must never be used'); },
            },
        }),
    });
    stubModule('@/lib/adminAudit', { isAdmin: async () => setup.admin !== false });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/logError', { logError: async (message: string, detail: any) => { logged.push({ message, detail }); } });
    stubModule('@/lib/moneyAlert', {
        logMoneyFailure: async (message: string, detail: any) => { moneyAlerts.push({ message, detail }); timeline.push('alert'); },
        alertDirectorsNow: async () => 1,
    });
    stubModule('@/lib/utils', { firstName: (p: any, f: string) => ((p && p.full_name) || f).split(' ')[0] });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => { emails.push({ to, subject, html }); timeline.push('email:' + to); return true; },
        emailLayout: (b: string) => b, escapeHtml: (s: string) => s, button: () => '',
        SITE_URL: 'http://example.invalid', NEUTRAL_SUBTITLE: '',
    });
    stubModule('@/lib/clawback', {
        reversibleFrom: async () => ({ reachable: setup.reachable === undefined ? null : setup.reachable, fullyReversed: false }),
        isShortOfFunds: () => false,
    });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, key?: string) => {
            stripeCalls.push({ method, path, body, key });
            if (method === 'GET' && path.indexOf('/payment_intents/') === 0) return { id: 'pi_1', latest_charge: 'ch_1' };
            if (method === 'GET' && path.indexOf('/charges/') === 0) {
                return setup.charge || { id: 'ch_1', status: 'succeeded', captured: true, amount: 11000, amount_refunded: 0 };
            }
            if (method === 'GET' && path === '/refunds') return { data: [] };
            if (method === 'POST' && path === '/refunds') {
                timeline.push('stripe:refund');
                if (setup.refundError) throw setup.refundError;
                return { id: 're_1', amount: body.amount, transfer_reversal: body.reverse_transfer ? 'trr_direct' : null };
            }
            if (method === 'POST' && path.indexOf('/reversals') > 0) {
                timeline.push('stripe:reversal');
                return { id: 'trr_1', amount: body.amount };
            }
            throw new Error('unexpected Stripe call ' + method + ' ' + path);
        },
    });

    clearModule('@/lib/experienceFunds');
    clearModule('@/lib/adminOrderRefund');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, timeline, stripeCalls, inserts, updates, rpcs, emails, logged, moneyAlerts };
}

const REASON = 'The chef did not turn up on the night.';
function post(body: any) {
    return new Request('http://example.invalid/api/admin/experience-orders/refund', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}
const refundPosts = (calls: any[]) => calls.filter((c) => c.method === 'POST' && c.path === '/refunds');

/* ------------------------------------------------------------------ WHO */

test('WHO: signed out is 401 and nothing is read or refunded', async () => {
    const t = load({ user: null });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 401);
    assert.equal(t.stripeCalls.length, 0);
});

test('WHO: a signed-in non-admin is 403 and nothing is refunded', async () => {
    const t = load({ admin: false });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 403);
    assert.equal(t.stripeCalls.length, 0);
    assert.equal(t.inserts.length, 0);
});

/* --------------------------------------------------------------- REASON + CAP */

test('REASON: a reason under the minimum is refused before any refund row or money', async () => {
    const t = load({});
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: 'sorry', expectedRefunded: 0 }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /why/i);
    assert.equal(refundPosts(t.stripeCalls).length, 0);
    assert.equal(t.inserts.length, 0);
});

test('CAP: the refundable figure comes from Stripe and the order — more than is left is refused', async () => {
    // £30 already back at Stripe and on the order: £80 left.
    const t = load({ order: { ...HELD, amount_refunded: 30 }, charge: { id: 'ch_1', status: 'succeeded', captured: true, amount: 11000, amount_refunded: 3000 } });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 90, reason: REASON, expectedRefunded: 30 }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /80\.00/);
    assert.equal(refundPosts(t.stripeCalls).length, 0);
});

test('AGREEMENT: Stripe showing more refunded than the order records is refused and the directors told', async () => {
    const t = load({ charge: { id: 'ch_1', status: 'succeeded', captured: true, amount: 11000, amount_refunded: 2000 } });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 10, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 409);
    assert.equal(refundPosts(t.stripeCalls).length, 0);
    assert.equal(t.moneyAlerts.length, 1);
});

test('AGREEMENT: a stale page (the refunded figure it saw has moved) is refused', async () => {
    const t = load({});
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 10, reason: REASON, expectedRefunded: 20 }));
    assert.equal(res.status, 409);
    assert.equal(refundPosts(t.stripeCalls).length, 0);
});

test('an authorised (uncaptured) or already-refunded order cannot be refunded here', async () => {
    for (const status of ['authorised', 'refunded', 'declined']) {
        const t = load({ order: { ...HELD, status } });
        const res: any = await t.route.POST(post({ orderId: 'o1', amount: 10, reason: REASON, expectedRefunded: 0 }));
        assert.equal(res.status, 409, status);
        assert.equal(refundPosts(t.stripeCalls).length, 0);
    }
});

/* -------------------------------------------------------------------- KEY */

test('KEY: the idempotency key is the refund row written BEFORE Stripe — never a timestamp or the amount', async () => {
    const t = load({});
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 25, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [refund] = refundPosts(t.stripeCalls);
    assert.equal(refund.key, 'admin-exp-refund-req-123');
    assert.ok(t.timeline.indexOf('insert:service_order_refunds') < t.timeline.indexOf('stripe:refund'), 'the row is written before the money moves');
    const row = t.inserts.find((i) => i.table === 'service_order_refunds')!.row;
    assert.equal(row.admin_id, 'admin-1');
    assert.equal(row.amount, 25);
    assert.equal(row.reason, REASON);
    assert.equal(row.status, 'pending');
    assert.equal(row.funds_flow, 'held');
    assert.equal(row.after_payout, false);
    assert.equal(refund.body.metadata.admin_refund_request, 'req-123');
});

test('KEY: a second click while the first is in flight (a pending row exists) never reaches Stripe', async () => {
    const t = load({ insertError: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 25, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 409);
    assert.equal(refundPosts(t.stripeCalls).length, 0);
    assert.equal(t.rpcs.length, 0);
    assert.equal(t.emails.length, 0);
});

/* ------------------------------------------------------------------ ORDER */

test('ORDER: if Stripe refuses, nothing else changes — no amount recorded, no status, no email; the row is marked failed', async () => {
    const t = load({ refundError: Object.assign(new Error('Your card was declined for refunds'), { stripeCode: 'x' }) });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 502);
    assert.match(res.body.error, /nothing has changed/);
    assert.equal(t.rpcs.length, 0, 'amount_refunded is not touched');
    assert.equal(t.updates.filter((u) => u.table === 'service_orders').length, 0, 'the order is not touched');
    assert.equal(t.emails.length, 0, 'nobody is emailed');
    const failed = t.updates.find((u) => u.table === 'service_order_refunds');
    assert.equal(failed && failed.patch.status, 'failed');
});

test('ORDER + HELD BEFORE PAYOUT, FULL: plain refund from what we hold → recorded → refunded → audit → emails, in that order', async () => {
    const t = load({});
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'refunded');

    const [refund] = refundPosts(t.stripeCalls);
    assert.equal(refund.body.amount, 11000);
    assert.equal(refund.body.reverse_transfer, undefined, 'a held charge has no transfer to reverse');
    assert.equal(refund.body.refund_application_fee, undefined);
    assert.equal(t.stripeCalls.filter((c) => c.path.indexOf('/reversals') > 0).length, 0, 'no clawback before payout');

    const at = (s: string) => t.timeline.findIndex((x) => x.indexOf(s) === 0);
    const stripe = at('stripe:refund');
    const rpc = at('rpc:record_order_refund');
    const status = at('update:service_orders:status');
    const audit = at('update:service_order_refunds:status');
    const firstEmail = at('email:');
    assert.ok(stripe >= 0 && rpc > stripe && status > rpc && audit > status && firstEmail > audit, t.timeline.join(' → '));
    assert.deepEqual(t.rpcs[0].args, { p_order: 'o1', p_amount: 110 });
    const statusUpdate = t.updates.find((u) => u.table === 'service_orders')!;
    assert.equal(statusUpdate.patch.status, 'refunded');
    assert.ok(!('amount_refunded' in statusUpdate.patch), 'amount_refunded moves only through the RPC');

    const auditRow = t.updates.find((u) => u.table === 'service_order_refunds')!.patch;
    assert.equal(auditRow.status, 'succeeded');
    assert.equal(auditRow.stripe_refund_id, 're_1');

    assert.equal(t.emails.length, 2);
    const guest = t.emails.find((e) => e.to === 'morag@example.invalid')!;
    assert.match(guest.html, /Hi Morag,/);
    assert.match(guest.html, /£110\.00/);
    assert.match(guest.html, /five to ten days/);
    assert.match(guest.html, /chef did not turn up/);
    assert.match(guest.html, /01\/01\/2099/, 'DD/MM/YYYY');
    const provider = t.emails.find((e) => e.to === 'chef@example.invalid')!;
    assert.match(provider.html, /refunded Morag </, 'the guest by first name only');
    assert.doesNotMatch(provider.html, /Bell/);
    assert.match(provider.html, /nothing to pay out/);
});

test('HELD BEFORE PAYOUT, PART: the order stays confirmed and the provider is told the payout on what is left', async () => {
    const t = load({});
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 30, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'confirmed');
    assert.equal(res.body.remaining, 80);
    assert.equal(t.updates.filter((u) => u.table === 'service_orders').length, 0, 'a part refund leaves the status alone');
    const provider = t.emails.find((e) => e.to === 'chef@example.invalid')!;
    // £80 kept, our fee £11 × 80/110 = £8 → £72.
    assert.match(provider.html, /£72\.00/);
});

/* ---------------------------------------------------------- AFTER PAYOUT */

test('HELD AFTER PAYOUT, PART: refund, then the provider\'s share of it clawed back (£27 of £99) with a key from the refund', async () => {
    const t = load({ order: PAID_OUT });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 30, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.afterPayout, true);
    const reversal = t.stripeCalls.find((c) => c.path === '/transfers/tr_1/reversals')!;
    assert.equal(reversal.body.amount, 2700, '£99 paid less the £72 they would have been paid');
    assert.equal(reversal.key, 'exp-clawback-o1-re_1');
    assert.ok(t.timeline.indexOf('stripe:refund') < t.timeline.indexOf('stripe:reversal'));
    const reversedWrite = t.updates.find((u) => u.table === 'service_orders' && 'payout_reversed' in u.patch)!;
    assert.equal(reversedWrite.patch.payout_reversed, 27);
    const audit = t.updates.find((u) => u.table === 'service_order_refunds')!.patch;
    assert.equal(audit.reversal_id, 'trr_1');
    assert.equal(audit.reversed, 27);
    assert.equal(audit.shortfall, 0);
    const row = t.inserts.find((i) => i.table === 'service_order_refunds')!.row;
    assert.equal(row.after_payout, true);
    const provider = t.emails.find((e) => e.to === 'chef@example.invalid')!;
    assert.match(provider.html, /£27\.00<\/strong> has been taken back from your Stripe balance/);
});

test('HELD AFTER PAYOUT, SHORTFALL: an empty Stripe balance → owed on the order, the directors told, the provider told what is owed', async () => {
    const t = load({ order: PAID_OUT, reachable: 0 });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 110, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(t.stripeCalls.filter((c) => c.path.indexOf('/reversals') > 0).length, 0, 'nothing reversed from an empty balance');
    const owed = t.updates.find((u) => u.table === 'service_orders' && 'payout_clawback_owed' in u.patch)!;
    assert.equal(owed.patch.payout_clawback_owed, 99);
    assert.ok(t.moneyAlerts.some((a) => /could not be pulled back/.test(a.message)), 'the directors are emailed the shortfall');
    const audit = t.updates.find((u) => u.table === 'service_order_refunds')!.patch;
    assert.equal(audit.shortfall, 99);
    assert.equal(res.body.shortfall, 99);
    const provider = t.emails.find((e) => e.to === 'chef@example.invalid')!;
    assert.match(provider.html, /£99\.00<\/strong> is still owed/);
});

/* ---------------------------------------------------------------- DIRECT */

test('DIRECT (legacy): refunds the old way — our fee back and the transfer reversed, in the same call', async () => {
    const t = load({ order: DIRECT });
    const res: any = await t.route.POST(post({ orderId: 'o1', amount: 40, reason: REASON, expectedRefunded: 0 }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [refund] = refundPosts(t.stripeCalls);
    assert.equal(refund.body.refund_application_fee, 'true');
    assert.equal(refund.body.reverse_transfer, 'true');
    assert.equal(refund.body.amount, 4000);
    assert.equal(t.stripeCalls.filter((c) => c.path.indexOf('/reversals') > 0).length, 0, 'no separate clawback');
    const audit = t.updates.find((u) => u.table === 'service_order_refunds')!.patch;
    assert.equal(audit.reversal_id, 'trr_direct');
    const row = t.inserts.find((i) => i.table === 'service_order_refunds')!.row;
    assert.equal(row.funds_flow, 'direct');
});

/* --------------------------------------------------------- SHARED RULE */

test('the shared rule: the form and the route refuse the same things', () => {
    const { checkAdminOrderRefund, adminRefundKey } = require('../lib/adminOrderRefund');
    assert.equal(checkAdminOrderRefund({ amount: '', reason: REASON, refundable: 50 }).ok, false);
    assert.equal(checkAdminOrderRefund({ amount: '10.005', reason: REASON, refundable: 50 }).ok, false);
    assert.equal(checkAdminOrderRefund({ amount: 50.01, reason: REASON, refundable: 50 }).ok, false);
    assert.equal(checkAdminOrderRefund({ amount: 10, reason: 'short', refundable: 50 }).ok, false);
    assert.equal(checkAdminOrderRefund({ amount: 10, reason: REASON, refundable: 0 }).ok, false);
    assert.deepEqual(checkAdminOrderRefund({ amount: '12.50', reason: '  ' + REASON + ' ', refundable: 50 }), { ok: true, amount: 12.5, reason: REASON });
    assert.throws(() => adminRefundKey(''));
});

test('clawbackDue: a part refund after payout takes back only the provider\'s share of it', () => {
    const { clawbackDue } = require('../lib/experienceFunds');
    assert.equal(clawbackDue({ amountPence: 11000, refundedAfterPence: 3000, platformFeePence: 1100, payoutAmount: 99 }), 27);
    assert.equal(clawbackDue({ amountPence: 11000, refundedAfterPence: 11000, platformFeePence: 1100, payoutAmount: 99 }), 99);
    assert.equal(clawbackDue({ amountPence: 11000, refundedAfterPence: 11000, platformFeePence: 1100, payoutAmount: 99, payoutReversed: 27 }), 72);
    assert.equal(clawbackDue({ amountPence: 11000, refundedAfterPence: 11000, platformFeePence: 1100, payoutAmount: 99, payoutReversed: 27, payoutClawbackOwed: 72 }), 0);
});
