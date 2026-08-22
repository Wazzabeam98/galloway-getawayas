// The key that stops a guest being charged twice for the same balance.
//
// It used to be built from the booking and its `balance_due_date`, described
// in a comment as "things that don't move". The due date is an ordinary
// column and moving it is exactly how a balance is made chargeable today for
// testing — so resetting it afterwards changed the key, which is the same
// shape as the attempt-counter bug that already cost a double payment.
//
// It is now the uuid of a `payments` row written *before* the charge. The
// record that an attempt happened and the thing that stops it happening twice
// are one object, so they cannot disagree.
//
// Nothing here reaches Stripe or a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/balance-charges/route';

const DUE = {
    id: 'b1', listing_id: 'l1', guest_id: 'g1', host_id: 'h1',
    check_in: '2026-12-01', check_out: '2026-12-04',
    balance_amount: 450, balance_due_date: '2026-11-01',
    balance_attempts: 0, balance_last_attempt_at: null,
    amount_paid: 150, amount_refunded: 0,
    stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1',
    stripe_payment_intent_id: 'pi_deposit',
    payment_status: 'deposit_paid', status: 'confirmed',
};

// A fake `payments` table that behaves enough like the real one: inserts get
// an id, selects can find a dangling claim, updates are recorded.
function harness(opts: {
    dangling?: any;
    charge?: (key: string | undefined) => any;
    claimFails?: boolean;
} = {}) {
    const inserted: any[] = [];
    const updated: any[] = [];
    const keysUsed: (string | undefined)[] = [];
    const logged: any[] = [];
    let nextId = 1;

    function opsOf(state: any) { return state.ops.map((o: any) => o.op); }
    function argOf(state: any, op: string) {
        const f = state.ops.find((o: any) => o.op === op);
        return f ? f.args[0] : undefined;
    }
    function eqValue(state: any, column: string) {
        const f = state.ops.find((o: any) => o.op === 'eq' && o.args[0] === column);
        return f ? f.args[1] : undefined;
    }

    const handlers: Record<string, any> = {
        bookings: (state: any) =>
            opsOf(state).indexOf('update') !== -1
                ? { data: null, error: null }
                : { data: [DUE], error: null },
        listings: { data: { title: 'Bookshop Flat', cancellation_policy: 'Moderate' }, error: null },
        payments: (state: any) => {
            const ops = opsOf(state);

            if (ops.indexOf('insert') !== -1) {
                const row = argOf(state, 'insert');
                if (opts.claimFails && row.status === 'attempting') {
                    return { data: null, error: { message: 'write failed' } };
                }
                const withId = { ...row, id: 'pay-' + nextId++ };
                inserted.push(withId);
                return { data: withId, error: null };
            }

            if (ops.indexOf('update') !== -1) {
                updated.push({ id: eqValue(state, 'id'), patch: argOf(state, 'update') });
                return { data: null, error: null };
            }

            // The dangling-claim lookup asks for status = 'attempting'.
            if (eqValue(state, 'status') === 'attempting') {
                return { data: opts.dangling || null, error: null };
            }
            // The "why did the last one fail" lookup asks for 'failed'.
            return { data: null, error: null };
        },
    };

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    const h = handlers[table] ?? { data: null, error: null };
                    const v = typeof h === 'function' ? h(state) : h;
                    return (resolve: any) => resolve(v);
                }
                return (...args: any[]) => {
                    state.ops.push({ op: prop, args });
                    return chain;
                };
            },
        });
        return chain;
    }

    const client = {
        from: (t: string) => builder(t),
        auth: { admin: { getUserById: async () => ({ data: { user: { email: '' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/logError', {
        logError: async (message: string) => { logged.push(message); },
    });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string, _body: any, key?: string) => {
            if (path === '/payment_intents') {
                keysUsed.push(key);
                return opts.charge ? opts.charge(key) : { id: 'pi_new', status: 'succeeded' };
            }
            return {};
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async () => true,
        emailLayout: () => '', escapeHtml: (s: string) => s, formatDate: () => '',
        button: () => '', SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, inserted, updated, keysUsed, logged };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/balance-charges', {
        headers: { authorization: 'Bearer test-secret' },
    });

test('the charge is keyed on the attempt row, not on anything resettable', async () => {
    const { route, inserted, keysUsed } = harness();
    await route.GET(authorised());

    assert.equal(inserted.length, 1, 'the attempt is claimed before charging');
    assert.equal(inserted[0].status, 'attempting');
    assert.equal(keysUsed.length, 1);
    assert.equal(keysUsed[0], 'balance-attempt-pay-1');

    assert.doesNotMatch(
        String(keysUsed[0]),
        /2026-11-01/,
        'balance_due_date must not appear in the key — moving it is how a balance is made chargeable for testing'
    );
    assert.doesNotMatch(String(keysUsed[0]), /^balance-b1-/, 'nor the bare booking id and date');
});

test('the claim is settled in place, not written twice', async () => {
    const { route, inserted, updated } = harness();
    await route.GET(authorised());

    const settled = updated.filter((u) => u.patch.status === 'succeeded');
    assert.equal(settled.length, 1, 'one row, updated');
    assert.equal(settled[0].id, 'pay-1', 'the row that was claimed');
    assert.equal(settled[0].patch.stripe_payment_intent_id, 'pi_new');
    assert.equal(
        inserted.filter((r) => r.status === 'succeeded').length,
        0,
        'no second row — anything counting attempts must still count one'
    );
});

// The case that decided the design. No scripted scenario can produce it:
// it needs a process to die between claiming and hearing back from Stripe.
test('a dangling claim is reused, so a crashed run cannot charge twice', async () => {
    const { route, inserted, keysUsed } = harness({
        dangling: { id: 'pay-crashed', amount: 450 },
    });
    await route.GET(authorised());

    assert.equal(inserted.length, 0, 'no new claim is made');
    assert.equal(
        keysUsed[0],
        'balance-attempt-pay-crashed',
        'the retry carries the dead run’s key, so Stripe replays rather than charging again'
    );
});

test('a dangling claim for a different amount is abandoned, not reused', async () => {
    // Stripe rejects a key replayed with different parameters, so a stale
    // claim from before a partial refund cannot be carried forward.
    const { route, inserted, updated, keysUsed } = harness({
        dangling: { id: 'pay-stale', amount: 800 },
    });
    await route.GET(authorised());

    const abandoned = updated.filter((u) => u.patch.status === 'abandoned');
    assert.equal(abandoned.length, 1, 'the stale claim is closed off');
    assert.equal(abandoned[0].id, 'pay-stale');
    assert.equal(inserted.length, 1, 'and a fresh one is claimed');
    assert.equal(keysUsed[0], 'balance-attempt-pay-1');
});

test('a failed charge settles the same row, carrying the intent id', async () => {
    const err: any = new Error('Your card was declined');
    err.stripePaymentIntent = { id: 'pi_failed' };

    const { route, updated, inserted } = harness({
        charge: () => { throw err; },
    });
    await route.GET(authorised());

    const failed = updated.filter((u) => u.patch.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].id, 'pay-1', 'the claimed row, not a new one');
    assert.equal(
        failed[0].patch.stripe_payment_intent_id,
        'pi_failed',
        'the webhook looks for a failed row with this intent id so it does not write the failure twice'
    );
    assert.equal(inserted.filter((r) => r.status === 'failed').length, 0);
});

// An internal write failure is not the guest's card failing.
test('if the attempt cannot be recorded, nothing is charged and the guest is not told off', async () => {
    const { route, keysUsed, updated, logged } = harness({ claimFails: true });
    const res: any = await route.GET(authorised());

    assert.equal(res.status, 200);
    assert.equal(keysUsed.length, 0, 'no charge without a key');
    assert.equal(res.body.skipped, 1, 'skipped, so tomorrow tries again');
    assert.equal(res.body.failed, 0, 'not counted as a payment failure');
    assert.equal(
        updated.filter((u) => u.patch.status === 'failed').length,
        0,
        'no failed attempt recorded against a card that was never presented'
    );
    assert.equal(logged.length, 1, 'it reaches /admin/errors instead');
    assert.match(logged[0], /could not record an attempt/i);
});
