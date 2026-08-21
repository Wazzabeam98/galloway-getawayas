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

type Call = { path: string; body: any; idempotencyKey?: string };

function load(stripeBehaviour: (call: Call) => any) {
    const calls: Call[] = [];
    const logged: any[] = [];

    stubModule('@/lib/stripe', {
        stripeRequest: async (_method: string, path: string, body: any, idempotencyKey?: string) => {
            const call = { path, body, idempotencyKey };
            calls.push(call);
            return stripeBehaviour(call);
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
    const writes: any[] = [];
    const updates: any[] = [];
    return {
        writes,
        updates,
        from(table: string) {
            return {
                insert: async (row: any) => { writes.push({ table, row }); return { data: null, error: null }; },
                select() {
                    return {
                        eq() {
                            return { maybeSingle: async () => ({ data: profile, error: null }) };
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

test('a shortfall at Stripe is carried forward as a debt', async () => {
    const { clawBackPayout } = load(() => {
        const err: any = new Error('Insufficient funds in the account.');
        err.stripeCode = 'balance_insufficient';
        throw err;
    });
    const admin = fakeAdmin({ payout_balance_owed: 12.5 });

    const result = await clawBackPayout(admin, booking, 270, 're_abc');

    assert.equal(result.owed, 270);
    assert.equal(result.reversed, 0);
    assert.equal(result.failed, 0);

    const debt = admin.updates.find((u) => u.table === 'profiles');
    assert.ok(debt, 'the debt must be written to the host profile');
    assert.equal(debt.patch.payout_balance_owed, 282.5, 'added to what they already owed');

    const row = admin.writes.find((w) => w.table === 'payouts');
    assert.equal(row.row.status, 'owed');
});

// The bug: every Stripe error was treated as a shortfall, so a bad transfer id
// or a reused idempotency key silently became money taken off the host's next
// payout that they never owed.
test('any other Stripe failure is recorded, not billed to the host', async () => {
    const { clawBackPayout, logged } = load(() => {
        const err: any = new Error(
            'Keys for idempotent requests can only be used with the same parameters'
        );
        err.stripeCode = 'idempotency_error';
        throw err;
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

    const row = admin.writes.find((w) => w.table === 'payouts');
    assert.equal(row.row.status, 'failed');

    assert.equal(logged.length, 1, 'a failure nobody is charged for still has to reach /admin/errors');
    assert.match(logged[0].message, /not a shortfall/i);
});

// Two refunds on one booking each need their own reversal. Keyed on the booking
// alone, Stripe replayed the first — recovering nothing while recording success.
test('each refund gets its own idempotency key', async () => {
    const { clawBackPayout, calls } = load(() => ({ id: 'trr_1' }));
    const admin = fakeAdmin();

    await clawBackPayout(admin, booking, 100, 're_first');
    await clawBackPayout(admin, booking, 150, 're_second');

    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
    assert.match(calls[0].idempotencyKey!, /re_first/);
    assert.match(calls[1].idempotencyKey!, /re_second/);
});

test('a successful reversal records nothing against the host', async () => {
    const { clawBackPayout } = load(() => ({ id: 'trr_9' }));
    const admin = fakeAdmin({ payout_balance_owed: 0 });

    const result = await clawBackPayout(admin, booking, 270, 're_ok');

    assert.equal(result.reversed, 270);
    assert.equal(result.owed, 0);
    assert.equal(admin.updates.filter((u) => u.table === 'profiles').length, 0);
    const row = admin.writes.find((w) => w.table === 'payouts');
    assert.equal(row.row.status, 'succeeded');
});

test('a reversal never exceeds what was actually paid out', async () => {
    const { clawBackPayout, calls } = load(() => ({ id: 'trr_5' }));
    const admin = fakeAdmin();

    // The guest is refunded £600 but the host only ever received £270.
    await clawBackPayout(admin, booking, 600, 're_big');

    assert.equal(calls[0].body.amount, 27000, 'pence, capped at the payout');
});

test('a booking that was never paid out is left alone', async () => {
    const { clawBackPayout, calls } = load(() => ({ id: 'trr_x' }));
    const admin = fakeAdmin();

    const result = await clawBackPayout(admin, { ...booking, payout_transfer_id: null }, 100, 're_n');

    assert.deepEqual(result, { reversed: 0, owed: 0, failed: 0 });
    assert.equal(calls.length, 0, 'Stripe must not be called at all');
});
