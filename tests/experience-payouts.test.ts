// The experience payout run — the thing that now sends providers the money we
// hold for them. Supabase and Stripe are stubbed entirely: nothing here touches
// a database or a payment processor.
//
// What it must get right, each asserted below:
//   * TIMING      — only orders whose date was yesterday (London) or earlier.
//   * LEGACY      — an order paid under the old destination-charge flow is never
//                   paid again: not selected, and refused at Stripe if mis-marked.
//   * AMOUNT      — total less our frozen fee, drawn on the order's own charge.
//   * IDEMPOTENCY — a transfer already in the order's group is written down, not
//                   repeated; the key is the order's own id.
//   * HELD        — a provider without payouts enabled waits; a dispute holds it.
//   * CLAWBACK    — a refund after payout reverses the transfer; before payout it
//                   is a plain refund with no reverse_transfer.
//   * SELLER      — a held charge is made on behalf of the provider (they are the
//                   seller); that alone is paid, and a charge naming a different
//                   account is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/experience-payouts/route';

const HELD = {
    id: 'o1', provider_id: 'p1', parent_order_id: null, status: 'confirmed', cancel_ack: null,
    service_date: '2026-01-01', price: 180, commission_rate: 0.1, platform_fee: 18,
    stripe_payment_intent_id: 'pi_1', item_name: 'Dinner', provider_business_name: 'Solway Table',
    funds_flow: 'held', paid_out_at: null,
};
const PROVIDER = { id: 'p1', business_name: 'Solway Table', contact_email: 'chef@gallowayexp.test', stripe_account_id: 'acct_p1', stripe_payouts_enabled: true };

interface Setup {
    orders?: any[];
    provider?: any;
    disputes?: any[];
    existingTransfers?: any[];
    pi?: any;
    charge?: any;
    stampError?: any;
}

function load(setup: Setup) {
    const stripeCalls: Array<{ method: string; path: string; body: any; key?: string }> = [];
    const updates: Array<{ table: string; patch: any; ops: any[] }> = [];
    const selects: Array<{ table: string; ops: any[] }> = [];
    const logged: any[] = [];
    const alerts: any[] = [];

    const handlers: Record<string, (state: any) => any> = {
        service_orders: (state) => {
            const upd = state.ops.find((o: any) => o.op === 'update');
            if (upd) {
                updates.push({ table: 'service_orders', patch: upd.args[0], ops: state.ops });
                return { data: null, error: setup.stampError || null };
            }
            selects.push({ table: 'service_orders', ops: state.ops });
            return { data: setup.orders || [HELD], error: null };
        },
        service_providers: () => ({ data: setup.provider === undefined ? PROVIDER : setup.provider, error: null }),
        disputes: () => ({ data: setup.disputes || [], error: null }),
        cron_runs: () => ({ data: null, error: null }),
    };

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    const h = handlers[table];
                    const v = h ? h(state) : { data: [], error: null };
                    return (resolve: any) => resolve(v);
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }
    const client = { from: (t: string) => builder(t) };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => client });
    stubModule('@/lib/logError', { logError: async (message: string, detail: any, context: any) => { logged.push({ message, detail, context }); } });
    stubModule('@/lib/moneyAlert', {
        logMoneyFailure: async (message: string, detail: any) => { logged.push({ message, detail, money: true }); },
        alertDirectorsNow: async (a: any) => { alerts.push(a); return 1; },
    });
    stubModule('@/lib/cronHeartbeat', { recordCronRun: async () => {} });
    stubModule('@/lib/payoutTiming', { readSchedule: async () => null, arrivalSentence: () => '' });
    stubModule('@/lib/email', {
        sendEmail: async () => true, emailLayout: () => '', escapeHtml: (s: string) => s,
        formatDate: () => '', button: () => '', SITE_URL: 'http://example.invalid', NEUTRAL_SUBTITLE: '',
    });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, key?: string) => {
            stripeCalls.push({ method, path, body, key });
            if (method === 'GET' && path === '/transfers') return { data: setup.existingTransfers || [] };
            if (method === 'GET' && path.indexOf('/payment_intents/') === 0) return setup.pi || { id: 'pi_1', latest_charge: 'ch_1' };
            if (method === 'GET' && path.indexOf('/charges/') === 0) return setup.charge || { id: 'ch_1', status: 'succeeded', captured: true, amount: 18000, amount_refunded: 0 };
            if (method === 'POST' && path === '/transfers') return { id: 'tr_new', amount: body.amount };
            throw new Error('unexpected Stripe call ' + method + ' ' + path);
        },
    });

    clearModule('@/lib/experienceFunds');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, stripeCalls, updates, selects, logged, alerts };
}

const authorised = () => new Request('http://example.invalid/api/cron/experience-payouts', { headers: { authorization: 'Bearer test-secret' } });
const transfers = (calls: any[]) => calls.filter((c) => c.method === 'POST' && c.path === '/transfers');

test('an unauthorised call is refused', async () => {
    const { route } = load({});
    const res: any = await route.GET(new Request('http://example.invalid/x'));
    assert.equal(res.status, 401);
});

test('TIMING + LEGACY at the query: held orders only, dated yesterday (London) or earlier, never already paid', async () => {
    const { route, selects } = load({ orders: [] });
    await route.GET(authorised());
    const ops = selects[0].ops;
    const has = (op: string, col: string, val?: any) => ops.some((o: any) => o.op === op && o.args[0] === col && (val === undefined || JSON.stringify(o.args[1]) === JSON.stringify(val)));
    assert.ok(has('eq', 'funds_flow', 'held'), 'only held orders — a direct (legacy) order is never selected');
    assert.ok(has('is', 'paid_out_at', null), 'never an order already paid out');
    const lte = ops.find((o: any) => o.op === 'lte' && o.args[0] === 'service_date');
    assert.ok(lte, 'bounded by the service date');
    // Yesterday's London day key: the same shared helper the host run uses.
    const { londonDayKey, shiftDayKey } = require('../lib/dayKey');
    assert.equal(lte.args[1], shiftDayKey(londonDayKey(), -1), 'the day AFTER the experience, as a host is paid the day after check-in');
});

test('AMOUNT: pays total less the frozen 10% fee, drawn on the order’s own charge, keyed on the order', async () => {
    const { route, stripeCalls, updates } = load({});
    const res: any = await route.GET(authorised());
    const sent = transfers(stripeCalls);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.amount, 16200, '£180 less our £18 = £162');
    assert.equal(sent[0].body.destination, 'acct_p1');
    assert.equal(sent[0].body.source_transaction, 'ch_1', 'drawn on the order’s charge, not the settled balance');
    assert.equal(sent[0].body.transfer_group, 'service_order_o1');
    assert.equal(sent[0].key, 'experience-payout-o1', 'the idempotency key is the order’s own, never-resettable id');
    const stamp = updates.find((u) => u.patch.payout_transfer_id === 'tr_new');
    assert.ok(stamp, 'the payout is written on the order');
    assert.equal(stamp!.patch.payout_amount, 162);
    assert.ok(stamp!.ops.some((o: any) => o.op === 'is' && o.args[0] === 'paid_out_at'), 'stamped only while still unpaid');
    assert.equal(res.body.sent, 1);
});

test('AMOUNT: a delivery fee passes through whole — commission was frozen on the items only', async () => {
    // £72 charged: £60 of items + £12 delivery; our fee was 10% of £60 = £6.
    const { route, stripeCalls } = load({
        orders: [{ ...HELD, price: 72, platform_fee: 6 }],
        charge: { id: 'ch_1', status: 'succeeded', captured: true, amount: 7200, amount_refunded: 0 },
    });
    await route.GET(authorised());
    assert.equal(transfers(stripeCalls)[0].body.amount, 6600);
});

test('IDEMPOTENCY: a transfer already in the order’s group is written down, never sent again', async () => {
    const { route, stripeCalls, updates } = load({ existingTransfers: [{ id: 'tr_old', amount: 16200 }] });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0, 'no second transfer');
    const stamp = updates.find((u) => u.patch.payout_transfer_id === 'tr_old');
    assert.ok(stamp, 'the existing transfer is recorded on the order');
    assert.equal(stamp!.patch.payout_amount, 162);
    assert.equal(res.body.reconciled, 1);
});

test('IDEMPOTENCY: if Stripe cannot say whether it already paid, nothing is sent', async () => {
    const ctx = load({});
    // Replace the transfers list with a failure.
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, key?: string) => {
            ctx.stripeCalls.push({ method, path, body, key });
            if (method === 'GET' && path === '/transfers') throw new Error('Stripe is down');
            throw new Error('should not get this far');
        },
    });
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    const res: any = await route.GET(authorised());
    assert.equal(transfers(ctx.stripeCalls).length, 0);
    assert.equal(res.body.sent, 0);
    assert.equal(ctx.alerts.length, 1, 'the directors hear about an order that was due and not paid');
});

test('LEGACY: a direct order handed back by the query anyway is not paid', async () => {
    const { route, stripeCalls } = load({ orders: [{ ...HELD, funds_flow: 'direct' }] });
    await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0);
});

test('LEGACY: an order marked held whose charge is a destination charge is refused, loudly', async () => {
    const { route, stripeCalls, logged } = load({
        charge: { id: 'ch_1', status: 'succeeded', captured: true, amount: 18000, amount_refunded: 0, transfer: 'tr_dest', application_fee: 'fee_1' },
    });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0, 'the provider was already paid by Stripe at capture');
    assert.equal(res.body.failed, 1);
    assert.ok(logged.some((l) => l.money && /destination charge/.test(l.message)));
});

test('SELLER: a held charge made on behalf of the provider is paid — on_behalf_of names the seller, it moves no money', async () => {
    const { route, stripeCalls } = load({ pi: { id: 'pi_1', latest_charge: 'ch_1', on_behalf_of: 'acct_p1' } });
    const res: any = await route.GET(authorised());
    const sent = transfers(stripeCalls);
    assert.equal(sent.length, 1, 'the provider is paid the day after, as with any held order');
    assert.equal(sent[0].body.destination, 'acct_p1', 'paid to the seller named on the charge');
    assert.equal(sent[0].body.amount, 16200);
    assert.equal(res.body.failed, 0);
});

test('SELLER: if the charge was made on behalf of a different Stripe account, nothing is sent and it is said loudly', async () => {
    const { route, stripeCalls, logged } = load({ pi: { id: 'pi_1', latest_charge: 'ch_1', on_behalf_of: 'acct_OLD' } });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0, "one seller's takings are never sent to another account");
    assert.equal(res.body.failed, 1);
    assert.ok(logged.some((l) => l.money && /seller on the charge/.test(l.message)));
});

test('SELLER: a provider whose account takes card payments is the seller; one still setting up is not — we are', () => {
    clearModule('@/lib/experienceFunds');
    const { heldChargeSeller } = require('../lib/experienceFunds');
    assert.deepEqual(heldChargeSeller({ stripe_account_id: 'acct_p1', stripe_charges_enabled: true }), { on_behalf_of: 'acct_p1' });
    // Stripe refuses on_behalf_of without the card_payments capability, so an
    // unfinished account (or none) is sold as us — never a failed checkout.
    assert.deepEqual(heldChargeSeller({ stripe_account_id: 'acct_p1', stripe_charges_enabled: false }), {});
    assert.deepEqual(heldChargeSeller({ stripe_account_id: null, stripe_charges_enabled: null }), {});
    assert.deepEqual(heldChargeSeller(null), {});
    // Never money-moving fields, whichever way it goes.
    for (const v of [heldChargeSeller({ stripe_account_id: 'acct_p1', stripe_charges_enabled: true }), heldChargeSeller(null)]) {
        assert.equal((v as any).transfer_data, undefined);
        assert.equal((v as any).application_fee_amount, undefined);
    }
});

test('HELD: a charge made as us (no on_behalf_of) is paid to the provider once their payouts are on', async () => {
    const { route, stripeCalls } = load({ pi: { id: 'pi_1', latest_charge: 'ch_1', on_behalf_of: null } });
    const res: any = await route.GET(authorised());
    assert.equal(res.body.failed, 0);
    assert.equal(transfers(stripeCalls).length, 1, 'released to the provider by the run');
});

test('HELD: a provider without payouts enabled waits — skipped, not failed, and said out loud', async () => {
    const { route, stripeCalls, logged } = load({ provider: { ...PROVIDER, stripe_payouts_enabled: false } });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0);
    assert.equal(res.body.failed, 0);
    assert.equal(res.body.providersWaitingToOnboard, 1);
    assert.ok(logged.some((l) => /not finished setting up payouts/.test(l.message)));
});

test('HELD: an open chargeback holds the payout', async () => {
    const { route, stripeCalls } = load({ disputes: [{ id: 'd1', status: 'needs_response' }] });
    await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0);
});

test('a walk-away (cancelled with the forfeit record) is still paid; a cancel without one is not', async () => {
    const paid = load({ orders: [{ ...HELD, status: 'cancelled', cancel_ack: { refunded: 0 } }] });
    await paid.route.GET(authorised());
    assert.equal(transfers(paid.stripeCalls).length, 1, 'the provider keeps a forfeited payment');

    const notPaid = load({ orders: [{ ...HELD, status: 'cancelled', cancel_ack: null }] });
    await notPaid.route.GET(authorised());
    assert.equal(transfers(notPaid.stripeCalls).length, 0);
});

test('a charge refunded in full (even in the Stripe dashboard) pays nothing and is settled at £0', async () => {
    const { route, stripeCalls, updates } = load({ charge: { id: 'ch_1', status: 'succeeded', captured: true, amount: 18000, amount_refunded: 18000 } });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 0);
    assert.ok(updates.some((u) => u.patch.payout_amount === 0));
    assert.equal(res.body.nothingToPay, 1);
});

test('a transfer sent but not recorded is reported, never counted as a clean payout', async () => {
    const { route, stripeCalls, logged } = load({ stampError: { message: 'connection reset' } });
    const res: any = await route.GET(authorised());
    assert.equal(transfers(stripeCalls).length, 1);
    assert.equal(res.body.sent, 0);
    assert.equal(res.body.failed, 1);
    assert.ok(logged.some((l) => l.money && /transfer sent/.test(l.message)));
});

// ---------------------------------------------------------------- the helpers

test('providerSharePence: charge less frozen fee, scaled on a partial refund, standard rate as a fallback', () => {
    clearModule('@/lib/experienceFunds');
    const { providerSharePence } = require('../lib/experienceFunds');
    assert.equal(providerSharePence({ amountPence: 18000, platformFeePence: 1800 }), 16200);
    assert.equal(providerSharePence({ amountPence: 18000, refundedPence: 9000, platformFeePence: 1800 }), 8100);
    assert.equal(providerSharePence({ amountPence: 18000, refundedPence: 18000, platformFeePence: 1800 }), 0);
    assert.equal(providerSharePence({ amountPence: 18000, platformFeePence: null, commissionRate: null }), 16200, 'a missing rate is 10%, never zero');
    assert.equal(providerSharePence({ amountPence: 18000, platformFeePence: 0 }), 18000, 'a deliberate 0% survives');
});

function loadFunds(stripeCalls: any[], updates: any[], opts: { reachable?: number | null } = {}) {
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, key?: string) => {
            stripeCalls.push({ method, path, body, key });
            if (path === '/refunds') return { id: 're_1' };
            return { id: 'trr_1' };
        },
    });
    stubModule('@/lib/moneyAlert', { logMoneyFailure: async () => {}, alertDirectorsNow: async () => 1 });
    stubModule('@/lib/clawback', {
        reversibleFrom: async () => ({ reachable: opts.reachable === undefined ? null : opts.reachable, fullyReversed: false }),
        isShortOfFunds: () => false,
    });
    clearModule('@/lib/experienceFunds');
    const funds = require('../lib/experienceFunds');
    const admin = {
        from: () => {
            const chain: any = {
                select: () => chain, eq: () => chain,
                maybeSingle: async () => ({ data: { stripe_account_id: 'acct_p1' }, error: null }),
                update: (patch: any) => { updates.push(patch); return { eq: async () => ({ error: null }) }; },
            };
            return chain;
        },
    };
    return { funds, admin };
}

test('REFUND before payout (held): a plain refund from the money we hold — no reverse_transfer, no fee refund', async () => {
    const calls: any[] = []; const updates: any[] = [];
    const { funds, admin } = loadFunds(calls, updates);
    await funds.refundExperienceOrder(admin, { id: 'o1', funds_flow: 'held', stripe_payment_intent_id: 'pi_1', payout_transfer_id: null }, 'refund-o1');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { payment_intent: 'pi_1' });
    assert.equal(calls[0].key, 'refund-o1');
});

test('REFUND of a legacy direct order: still reverses the transfer and returns our fee', async () => {
    const calls: any[] = []; const updates: any[] = [];
    const { funds, admin } = loadFunds(calls, updates);
    await funds.refundExperienceOrder(admin, { id: 'o1', stripe_payment_intent_id: 'pi_1' }, 'refund-o1');
    assert.equal(calls[0].body.reverse_transfer, 'true');
    assert.equal(calls[0].body.refund_application_fee, 'true');
});

test('CLAWBACK: a refund after payout reverses what the provider can fund and records the rest as owed', async () => {
    const calls: any[] = []; const updates: any[] = [];
    const { funds, admin } = loadFunds(calls, updates, { reachable: 100 });
    await funds.refundExperienceOrder(admin, {
        id: 'o1', provider_id: 'p1', funds_flow: 'held', stripe_payment_intent_id: 'pi_1',
        payout_transfer_id: 'tr_1', payout_amount: 162, payout_reversed: 0,
    }, 'refund-o1');
    const reversal = calls.find((c) => c.path === '/transfers/tr_1/reversals');
    assert.ok(reversal, 'the payout transfer is reversed');
    assert.equal(reversal.body.amount, 10000, 'only what the provider can fund');
    assert.equal(reversal.key, 'exp-clawback-o1-re_1');
    assert.ok(updates.some((u) => u.payout_reversed === 100 && u.payout_clawback_owed === 62));
});

test('SELLER: the statement descriptor is the business name, inside Stripe’s rules, never left to default to our website', () => {
    clearModule('@/lib/experienceFunds');
    const { providerStatementDescriptor } = require('../lib/experienceFunds');
    assert.equal(providerStatementDescriptor('Solway Sauna'), 'Solway Sauna');
    assert.equal(providerStatementDescriptor('The Big Galloway Bakehouse & Café Company'), 'The Big Galloway Bakeh', 'cut to 22 characters');
    assert.equal(providerStatementDescriptor('Bob\'s "Best" <Fish> *Tours*'), 'Bobs Best Fish Tours', 'forbidden characters removed');
    assert.equal(providerStatementDescriptor('Crème Brûlée'), 'Creme Brulee', 'accents folded to Latin');
    assert.equal(providerStatementDescriptor('Jo'), 'Jo EXPERIENCE', 'too short is padded, not left to Stripe');
    assert.equal(providerStatementDescriptor(''), 'EXPERIENCE');
    assert.equal(providerStatementDescriptor('1234'), 'EXPERIENCE', 'must contain a letter');
    for (const name of ['Solway Sauna', 'Jo', '', 'The Big Galloway Bakehouse & Café Company']) {
        const d = providerStatementDescriptor(name);
        assert.ok(d.length >= 5 && d.length <= 22 && /[A-Za-z]/.test(d) && !/[<>\\'"*]/.test(d), name + ' → ' + d);
    }
});
