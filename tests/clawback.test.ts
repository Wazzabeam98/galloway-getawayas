// The clawback fallback cannot be reached against real Stripe: Stripe does not
// refuse a reversal the host cannot fund, it reverses anyway and leaves the
// connected account negative (see scenario 23 in PAYMENT-SCENARIOS.md). So the
// branch that carries a shortfall forward is covered here instead, along with
// the rule that only a shortfall may ever become a debt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const MODULE = '@/lib/clawback';

type Call = { method: string; path: string; body: any; idempotencyKey?: string; account?: string };

// `balance` is what the host is holding at Stripe, in pounds; null means the
// read itself fails. `onReversal` decides what the reversal call does.
function load(options: { balance?: number | null; onReversal?: (call: Call) => any } = {}) {
    const calls: Call[] = [];
    const logged: any[] = [];
    const balance = options.balance === undefined ? 1000 : options.balance;
    const onReversal = options.onReversal || (() => ({ id: 'trr_stub' }));

    stubModule('@/lib/stripe', {
        stripeRequest: async (
            method: string, path: string, body: any, idempotencyKey?: string, account?: string
        ) => {
            const call = { method, path, body, idempotencyKey, account };
            calls.push(call);
            if (path === '/balance') {
                if (balance === null) throw new Error('could not read the balance');
                return { available: [{ currency: 'gbp', amount: Math.round(balance * 100) }] };
            }
            return onReversal(call);
        },
    });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => {
            logged.push({ message, detail, context });
        },
    });

    clearModule(MODULE);
    const mod = require('../lib/clawback');
    return { clawBackPayout: mod.clawBackPayout, calls, logged };
}

// Records what was written, so a test can assert the host's debt exactly.
function fakeAdmin(profile: any = { payout_balance_owed: 0 }) {
    const withAccount = { stripe_account_id: 'acct_test', ...profile };
    const writes: any[] = [];
    const updates: any[] = [];
    let balance = Number(profile.payout_balance_owed || 0);
    return {
        writes,
        updates,
        // The debt now moves through the database function rather than a
        // read-add-write in JavaScript, so the double models what that function
        // does: add the delta to the running balance and never go below zero.
        // Recorded in the shape a profiles update used to take, so the
        // assertions still read as "what does the host owe afterwards".
        async rpc(name: string, args: any) {
            if (name !== 'adjust_payout_balance') return { data: null, error: null };
            balance = Math.max(0, Math.round((balance + Number(args.p_delta)) * 100) / 100);
            updates.push({ table: 'profiles', patch: { payout_balance_owed: balance }, id: args.p_host });
            return { data: balance, error: null };
        },
        from(table: string) {
            return {
                insert: async (row: any) => { writes.push({ table, row }); return { data: null, error: null }; },
                select() {
                    return {
                        eq() {
                            return { maybeSingle: async () => ({ data: withAccount, error: null }) };
                        },
                    };
                },
                update(patch: any) {
                    return {
                        eq: async (_col: string, id: string) => {
                            updates.push({ table, patch, id });
                            return { data: null, error: null };
                        },
                    };
                },
            };
        },
    };
}

const booking = {
    id: 'b-1',
    host_id: 'h-1',
    payout_transfer_id: 'tr_123',
    payout_amount: 270,
};

const reversalsIn = (calls: Call[]) => calls.filter((c) => c.path.indexOf('/reversals') !== -1);

// Scenario 23. Stripe will not refuse a reversal the host cannot fund — it
// takes their account negative and absorbs the difference out of the next
// transfer, which is the same money recovered twice. So we reverse only what
// they are holding and carry the rest.
test('a host with nothing at Stripe has the whole amount carried forward', async () => {
    const { clawBackPayout, calls } = load({ balance: 0 });
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.reversed, 0);
    assert.equal(result.owed, 270);
    assert.equal(reversalsIn(calls).length, 0, 'nothing to reverse, so Stripe is not asked to');

    const debt = admin.updates.find((u) => u.table === 'profiles');
    assert.equal(debt.patch.payout_balance_owed, 270);

    const row = admin.writes.find((w) => w.table === 'payouts');
    assert.equal(row.row.status, 'owed');
});

test('a host holding part of it has the rest carried forward', async () => {
    const { clawBackPayout, calls } = load({ balance: 100 });
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.reversed, 100, 'only what they actually had');
    assert.equal(result.owed, 170);
    assert.equal(reversalsIn(calls)[0].body.amount, 10000, 'pence');

    const debt = admin.updates.find((u) => u.table === 'profiles');
    assert.equal(debt.patch.payout_balance_owed, 170);

    const statuses = admin.writes.filter((w) => w.table === 'payouts').map((w) => w.row.status);
    assert.deepEqual(statuses, ['succeeded', 'owed'], 'both halves are recorded');
});

test('a shortfall is added to what the host already owed, not set over it', async () => {
    const { clawBackPayout } = load({ balance: 0 });
    const admin = fakeAdmin({ payout_balance_owed: 12.5 });

    await clawBackPayout(admin, booking, 270, 're_abc');

    const debt = admin.updates.find((u) => u.table === 'profiles');
    assert.equal(debt.patch.payout_balance_owed, 282.5);
});

test('a host with the money covers it in full and owes nothing', async () => {
    const { clawBackPayout, calls } = load({ balance: 810 });
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_ok');

    assert.equal(result.reversed, 270);
    assert.equal(result.owed, 0);
    assert.equal(reversalsIn(calls)[0].body.amount, 27000);
    assert.equal(admin.updates.filter((u) => u.table === 'profiles').length, 0);
    assert.equal(admin.writes.find((w) => w.table === 'payouts').row.status, 'succeeded');
});

// A balance we could not read must not silently become a debt.
test('an unreadable balance attempts the whole reversal rather than inventing a debt', async () => {
    const { clawBackPayout, calls } = load({ balance: null });
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.reversed, 270);
    assert.equal(reversalsIn(calls)[0].body.amount, 27000);
    assert.equal(admin.updates.filter((u) => u.table === 'profiles').length, 0);
});

// The balance can move between reading it and reversing against it.
test('Stripe reporting a shortfall anyway carries the whole amount', async () => {
    const { clawBackPayout } = load({
        balance: 810,
        onReversal: () => {
            const err: any = new Error('Insufficient funds in the account.');
            err.stripeCode = 'balance_insufficient';
            throw err;
        },
    });
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.owed, 270);
    assert.equal(admin.updates.find((u) => u.table === 'profiles').patch.payout_balance_owed, 270);
});

// The bug: every Stripe error was treated as a shortfall, so a bad transfer id
// or a reused idempotency key silently became money taken off the host's next
// payout that they never owed.
test('any other Stripe failure is recorded, not billed to the host', async () => {
    const { clawBackPayout, logged } = load({
        balance: 810,
        onReversal: () => {
            const err: any = new Error(
                'Keys for idempotent requests can only be used with the same parameters'
            );
            err.stripeCode = 'idempotency_error';
            throw err;
        },
    });
    const admin = fakeAdmin({ payout_balance_owed: 40 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.failed, 270);
    assert.equal(result.owed, 0, 'this is not money the host owes');
    assert.equal(
        admin.updates.filter((u) => u.table === 'profiles').length,
        0,
        'payout_balance_owed must not be touched'
    );
    assert.equal(admin.writes.find((w) => w.table === 'payouts').row.status, 'failed');
    assert.equal(logged.length, 1, 'a failure nobody is charged for still has to reach /admin/errors');
    assert.match(logged[0].message, /not a shortfall/i);
});

// Two refunds on one booking each need their own reversal. Keyed on the booking
// alone, Stripe replayed the first — recovering nothing while recording success.
test('each refund gets its own idempotency key', async () => {
    const { clawBackPayout, calls } = load({ balance: 810 });
    const admin = fakeAdmin();

    await clawBackPayout(admin, booking, 100, 're_first');
    await clawBackPayout(admin, booking, 150, 're_second');

    const reversals = reversalsIn(calls);
    assert.equal(reversals.length, 2);
    assert.notEqual(reversals[0].idempotencyKey, reversals[1].idempotencyKey);
    assert.match(reversals[0].idempotencyKey!, /re_first/);
    assert.match(reversals[1].idempotencyKey!, /re_second/);
});

test('a reversal never exceeds what was actually paid out', async () => {
    const { clawBackPayout, calls } = load({ balance: 5000 });
    const admin = fakeAdmin();

    // The guest is refunded £600 but the host only ever received £270.
    await clawBackPayout(admin, booking, 600, 're_big');

    assert.equal(reversalsIn(calls)[0].body.amount, 27000, 'pence, capped at the payout');
});

test('the balance is read as the host, not as the platform', async () => {
    const { clawBackPayout, calls } = load({ balance: 810 });
    const admin = fakeAdmin();

    await clawBackPayout(admin, booking, 270, 're_abc');

    const balanceCall = calls.find((c) => c.path === '/balance');
    assert.ok(balanceCall, 'the balance must be read');
    assert.equal(balanceCall!.account, 'acct_test');
});

test('a booking that was never paid out is left alone', async () => {
    const { clawBackPayout, calls } = load({ balance: 810 });
    const admin = fakeAdmin();

    const result = await clawBackPayout(admin, { ...booking, payout_transfer_id: null }, 100, 're_n');

    assert.deepEqual(result, { reversed: 0, owed: 0, failed: 0 });
    assert.equal(calls.length, 0, 'Stripe must not be called at all');
});
