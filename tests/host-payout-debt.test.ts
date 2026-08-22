// Recovering a debt out of a payout.
//
// The payout run used to decrement `profiles.payout_balance_owed` and leave
// the `payouts` rows behind it saying 'owed' for ever. The running total and
// the itemised rows are the same money counted two ways, and they disagreed
// the moment anything was recovered — so owner tools would have gone on
// listing a debt that had already been taken, at a host who could see it had.
//
// Nothing here touches a database or Stripe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';
// Relative, not '@/': the alias is installed at runtime by installAliases()
// below, and a top-level import resolves before that call has run.
import { spread, outstandingOf } from '../lib/hostDebt';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/host-payouts/route';

// ---------------------------------------------------------------------------
// The arithmetic on its own
// ---------------------------------------------------------------------------

test('spread takes as much from each place as it can bear, in order', () => {
    assert.deepEqual(spread(45, [30, 30]), [30, 15], 'the overflow goes to the next one');
    assert.deepEqual(spread(45, [100]), [45], 'never more than the balance');
    assert.deepEqual(spread(0, [30, 30]), [0, 0], 'nothing owed, nothing taken');
    assert.deepEqual(spread(10, []), [], 'nowhere to take it from');
    assert.deepEqual(spread(-5, [30]), [0], 'a negative balance is not a credit');
    assert.deepEqual(spread(30, [0, 30]), [0, 30], 'an empty payout absorbs nothing');
});

test('spread does not leak pennies', () => {
    const shares = spread(0.05, [0.02, 0.02, 0.02]);
    assert.deepEqual(shares, [0.02, 0.02, 0.01]);
    assert.equal(
        shares.reduce((a, b) => a + b, 0).toFixed(2),
        '0.05',
        'the parts must add back up to the whole'
    );
});

test('outstandingOf reads a stored debt correctly', () => {
    const row: any = { amount: -45, settled_amount: 0 };
    assert.equal(outstandingOf(row), 45, 'stored negative, owed positive');
    assert.equal(outstandingOf({ ...row, settled_amount: 30 }), 15, 'part paid');
    assert.equal(outstandingOf({ ...row, settled_amount: 45 }), 0, 'fully paid');
    assert.equal(outstandingOf({ ...row, settled_amount: 50 }), 0, 'never negative');
    assert.equal(outstandingOf({ amount: -45 } as any), 45, 'missing settled_amount is zero');
});

// ---------------------------------------------------------------------------
// The payout run
// ---------------------------------------------------------------------------

function harness(opts: {
    owedBalance: number;
    debts: any[];
    hostShareBooking: any;
}) {
    const payoutWrites: any[] = [];
    const profileWrites: any[] = [];
    const transfers: any[] = [];

    function opsOf(state: any) {
        return state.ops.map((o: any) => o.op);
    }
    function argOf(state: any, op: string) {
        const found = state.ops.find((o: any) => o.op === op);
        return found ? found.args[0] : undefined;
    }

    const handlers: Record<string, any> = {
        bookings: (state: any) => {
            if (opsOf(state).indexOf('update') !== -1) return { data: null, error: null };
            return { data: [opts.hostShareBooking], error: null };
        },
        profiles: (state: any) => {
            if (opsOf(state).indexOf('update') !== -1) {
                profileWrites.push(argOf(state, 'update'));
                return { data: null, error: null };
            }
            return {
                data: {
                    id: 'h1',
                    stripe_account_id: 'acct_test',
                    stripe_payouts_enabled: true,
                    payout_balance_owed: opts.owedBalance,
                },
                error: null,
            };
        },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
        payouts: (state: any) => {
            const ops = opsOf(state);
            if (ops.indexOf('update') !== -1) {
                payoutWrites.push({
                    patch: argOf(state, 'update'),
                    id: argOf(state, 'eq'),
                });
                return { data: null, error: null };
            }
            if (ops.indexOf('insert') !== -1) {
                return { data: null, error: null };
            }
            return { data: opts.debts, error: null };
        },
    };

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy(
            {},
            {
                get(_t, prop: string) {
                    if (prop === 'then') {
                        const h = handlers[table] ?? { data: [], error: null };
                        const value = typeof h === 'function' ? h(state) : h;
                        return (resolve: any) => resolve(value);
                    }
                    return (...args: any[]) => {
                        state.ops.push({ op: prop, args });
                        return chain;
                    };
                },
            }
        );
        return chain;
    }

    const client = {
        from: (table: string) => builder(table),
        auth: { admin: { getUserById: async () => ({ data: { user: { email: '' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/logError', { logError: async () => undefined });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string, body: any) => {
            transfers.push({ path, body });
            return { id: 'tr_test' };
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

    // supabaseAdmin captures createClient when it loads and is then cached,
    // so without clearing it every test after the first quietly reuses the
    // first test's fake database. Two of these tests passed for the wrong
    // reason before this line existed.
    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, payoutWrites, profileWrites, transfers };
}

const due = {
    id: 'b1', listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01',
    total_price: 500, amount_paid: 500, amount_refunded: 0,
    commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
};

const authorised = () =>
    new Request('http://example.invalid/api/cron/host-payouts', {
        headers: { authorization: 'Bearer test-secret' },
    });

test('a debt fully covered by one payout is marked settled', async () => {
    // £500 stay, 10% fee, so £450 to the host. £45 owed across two debts.
    const { route, payoutWrites, profileWrites, transfers } = harness({
        owedBalance: 45,
        debts: [
            { id: 'd1', amount: -30, settled_amount: 0, status: 'owed' },
            { id: 'd2', amount: -15, settled_amount: 0, status: 'owed' },
        ],
        hostShareBooking: due,
    });

    const res: any = await route.GET(authorised());
    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 1);

    assert.equal(transfers.length, 1, 'one transfer');
    assert.equal(transfers[0].body.amount, 40500, '£450 less £45 owed = £405');

    assert.equal(profileWrites.length, 1);
    assert.equal(profileWrites[0].payout_balance_owed, 0, 'the running total is cleared');

    assert.equal(payoutWrites.length, 2, 'both debts closed off');
    assert.equal(payoutWrites[0].patch.settled_amount, 30);
    assert.equal(payoutWrites[0].patch.status, 'settled');
    assert.ok(payoutWrites[0].patch.settled_at, 'a settled debt is stamped');
    assert.equal(payoutWrites[1].patch.settled_amount, 15);
    assert.equal(payoutWrites[1].patch.status, 'settled');
});

test('a debt larger than the payout is recorded as part paid, not settled', async () => {
    // £450 to the host against £1000 owed: the payout is swallowed whole.
    const { route, payoutWrites, profileWrites, transfers } = harness({
        owedBalance: 1000,
        debts: [{ id: 'd1', amount: -1000, settled_amount: 0, status: 'owed' }],
        hostShareBooking: due,
    });

    const res: any = await route.GET(authorised());
    assert.equal(res.status, 200);

    assert.equal(transfers.length, 0, 'nothing is sent when it is all owed back');
    assert.equal(profileWrites[0].payout_balance_owed, 550, '£1000 less the £450 recovered');

    assert.equal(payoutWrites.length, 1);
    assert.equal(payoutWrites[0].patch.settled_amount, 450, 'part paid');
    assert.equal(
        payoutWrites[0].patch.status,
        'owed',
        'still owed — a part-paid debt must not read as settled'
    );
    assert.equal(payoutWrites[0].patch.settled_at, null, 'and is not stamped as finished');
});

test('a host who owes nothing has no debt rows touched', async () => {
    const { route, payoutWrites, profileWrites, transfers } = harness({
        owedBalance: 0,
        debts: [],
        hostShareBooking: due,
    });

    const res: any = await route.GET(authorised());
    assert.equal(res.status, 200);
    assert.equal(transfers[0].body.amount, 45000, 'the whole £450 goes');
    assert.equal(profileWrites.length, 0, 'no balance to update');
    assert.equal(payoutWrites.length, 0, 'and nothing to settle');
});

test('the running total and the itemised debts always agree', async () => {
    const { route, payoutWrites, profileWrites } = harness({
        owedBalance: 45,
        debts: [
            { id: 'd1', amount: -30, settled_amount: 0, status: 'owed' },
            { id: 'd2', amount: -15, settled_amount: 0, status: 'owed' },
        ],
        hostShareBooking: due,
    });

    await route.GET(authorised());

    const recovered = payoutWrites.reduce(
        (sum: number, w: any) => sum + Number(w.patch.settled_amount || 0),
        0
    );
    const balanceFell = 45 - Number(profileWrites[0].payout_balance_owed);

    assert.equal(
        recovered,
        balanceFell,
        'what the rows say was recovered must equal what the total came down by'
    );
});
