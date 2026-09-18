// The balance charge and its booking write-back, and what happens when the two
// come apart. Two failures the failure-path audit proved
// (AUDIT-FAILURE-PATHS-2026-09-14.md, Group A #2 and rank 1), both in this one
// success block, both money out of a guest's pocket:
//
//   1. A guest cancels while the cron is charging the balance. The old
//      write-back updated on the booking id alone, so it marked the cancelled
//      stay 'paid' and kept the money — a stay the guest is no longer taking.
//      The fix guards the write on the pre-charge state (a compare-and-swap,
//      the same shape as the slot seat-claim) and, when it lands on nothing,
//      hands the balance back at Stripe.
//
//   2. The booking-to-paid write fails at the database, but the claimed
//      `payments` row was settled to 'succeeded' regardless. That hides the
//      dangling claim the next run relies on, so the booking — still reading
//      deposit_paid with a balance owing — is charged again next run under a
//      FRESH idempotency key. A real second charge. The fix checks the error
//      and only settles the row once the booking write is confirmed; if it
//      fails, the row is left 'attempting' so the next run replays the same
//      key and Stripe returns the first charge instead of taking another.
//
// These are the branches no scripted run against a live server can produce on
// demand — they need the row to change, or the write to fail, in the window
// between the charge and the write-back. So they are injected here. The real
// Stripe money proof that the surrounding machinery still holds is in
// scripts/balance-scenarios.mjs.
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

// The whole point of these tests is to control what the booking write-back
// resolves to — one row moved (the CAS held), no rows moved (the guest
// cancelled underneath it), or an error (the database write failed).
type BookingWriteBack =
    | { data: { id: string }[]; error: null }   // matched
    | { data: never[]; error: null }            // zero rows
    | { data: null; error: { message: string } }; // db error

function harness(opts: {
    bookingWriteBack: BookingWriteBack;
    dangling?: any;
    refundThrows?: boolean;
    refundStatus?: string;
} = { bookingWriteBack: { data: [{ id: DUE.id }], error: null } }) {
    const inserted: any[] = [];
    const updated: any[] = [];
    const charges: { key: string | undefined }[] = [];
    const refunds: { body: any; key: string | undefined }[] = [];
    const emails: string[] = [];
    const logged: string[] = [];
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
        bookings: (state: any) => {
            const ops = opsOf(state);
            if (ops.indexOf('update') !== -1) {
                // The paid write-back reads back the rows it moved; the intent
                // stamp and the failed-attempt counters update by id, awaited.
                if (ops.indexOf('select') !== -1) {
                    updated.push({ table: 'bookings', id: eqValue(state, 'id'), patch: argOf(state, 'update') });
                    return opts.bookingWriteBack;
                }
                return { data: null, error: null };
            }
            return { data: [DUE], error: null };
        },
        listings: { data: { title: 'Bookshop Flat', cancellation_policy: 'Moderate' }, error: null },
        payments: (state: any) => {
            const ops = opsOf(state);
            if (ops.indexOf('insert') !== -1) {
                const row = argOf(state, 'insert');
                const withId = { ...row, id: 'pay-' + nextId++ };
                inserted.push(withId);
                return { data: withId, error: null };
            }
            if (ops.indexOf('update') !== -1) {
                updated.push({ table: 'payments', id: eqValue(state, 'id'), patch: argOf(state, 'update') });
                return { data: null, error: null };
            }
            if (eqValue(state, 'status') === 'attempting') {
                return { data: opts.dangling || null, error: null };
            }
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
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/logError', {
        logError: async (message: string) => { logged.push(message); },
    });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string, body: any, key?: string) => {
            if (path === '/payment_intents') {
                charges.push({ key });
                return { id: 'pi_charged', status: 'succeeded' };
            }
            if (path === '/refunds') {
                refunds.push({ body, key });
                if (opts.refundThrows) throw new Error('Stripe refund failed');
                return { id: 're_1', status: opts.refundStatus || 'succeeded' };
            }
            return {};
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async (_to: string, subject: string) => { emails.push(subject); return true; },
        emailLayout: () => '', escapeHtml: (s: string) => s, formatDate: () => '',
        button: () => '', SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, inserted, updated, charges, refunds, emails, logged };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/balance-charges', {
        headers: { authorization: 'Bearer test-secret' },
    });

/* -------- the happy path still settles, so the guard has not eaten it ------ */

test('a charge against a still-live booking is settled and the guest told', async () => {
    const { route, updated, refunds, emails } = harness({
        bookingWriteBack: { data: [{ id: DUE.id }], error: null },
    });
    const res: any = await route.GET(authorised());

    assert.equal(res.body.charged, 1);
    assert.equal(res.body.reconciled, 0);
    assert.equal(refunds.length, 0, 'nothing is refunded on the happy path');

    const settled = updated.filter((u) => u.table === 'payments' && u.patch.status === 'succeeded');
    assert.equal(settled.length, 1, 'the claim is settled once the booking is confirmed paid');
    assert.ok(emails.some((s) => /all paid up/i.test(s)), 'the guest is told');
});

/* ---- 1. the guest cancelled mid-charge: the money is handed back --------- */

test('a balance charged against a booking cancelled underneath it is refunded', async () => {
    const { route, refunds, emails } = harness({
        // The CAS found no row in the pre-charge state — the guest cancelled
        // between selection and the write-back.
        bookingWriteBack: { data: [], error: null },
    });
    const res: any = await route.GET(authorised());

    assert.equal(res.body.reconciled, 1, 'it is counted as a reconcile, not a charge');
    assert.equal(res.body.charged, 0, 'the cancelled stay is not counted as paid');

    assert.equal(refunds.length, 1, 'the balance taken at Stripe is given straight back');
    assert.equal(refunds[0].body.payment_intent, 'pi_charged', 'the intent that was just charged');
    assert.equal(refunds[0].body.amount, 45000, 'the whole £450 balance, in pence');

    assert.ok(
        !emails.some((s) => /all paid up/i.test(s)),
        'the guest of a cancelled stay is not told they are all paid up',
    );
});

test('the reconcile refund is keyed on the attempt, so a re-run refunds once', async () => {
    const { route, refunds } = harness({ bookingWriteBack: { data: [], error: null } });
    await route.GET(authorised());

    assert.equal(refunds[0].key, 'balance-reconcile-pay-1',
        'a stable key on the attempt row: Stripe replays the same refund rather than issuing a second');
});

test('the round-trip is recorded — the charge succeeded and a refund against it', async () => {
    const { route, inserted, updated } = harness({ bookingWriteBack: { data: [], error: null } });
    await route.GET(authorised());

    const settled = updated.filter((u) => u.table === 'payments' && u.patch.status === 'succeeded');
    assert.equal(settled.length, 1, 'the charge really happened, so the claim is settled succeeded');

    const refundRow = inserted.find((r) => r.kind === 'refund');
    assert.ok(refundRow, 'and the refund is on the ledger too, so Stripe and the books agree');
    assert.equal(refundRow.status, 'succeeded');
    assert.equal(refundRow.amount, 450);
});

// gap #2 (B, auditing fix #1): the reconcile refund had no guard. If it throws,
// the money is charged against a cancelled stay and never returned, and the
// cancelled booking drops out of the due query so nothing retries.
test('a reconcile refund that fails is surfaced, and the charge is still recorded', async () => {
    const { route, updated, inserted, logged } = harness({
        bookingWriteBack: { data: [], error: null },
        refundThrows: true,
    });
    const res: any = await route.GET(authorised());

    // The charge really happened, so it is on the books either way — settled
    // before the refund is attempted, so a failed refund cannot also lose the
    // record that we took the money.
    const settled = updated.filter((u) => u.table === 'payments' && u.patch.status === 'succeeded');
    assert.equal(settled.length, 1, 'the charge is recorded even though the refund failed');

    // No refund row, because no refund happened — the books must not claim one.
    assert.equal(inserted.filter((r) => r.kind === 'refund').length, 0, 'no phantom refund row');

    assert.equal(res.body.reconciled, 0, 'a failed refund is not a completed reconcile');
    assert.equal(res.body.failed, 1, 'it is counted as a failure so the run reports it');

    assert.ok(logged.some((m) => /URGENT/.test(m) && /refund FAILED/i.test(m)),
        'the held, un-returned money is surfaced as loudly as the code can');
    assert.ok(logged.some((m) => /balance-reconcile-/.test(m)),
        'the replay key is named so a person can return it without a second refund');
});

test('a reconcile refund Stripe reports as failed is not read as one that happened', async () => {
    // Not a throw — Stripe answered with a non-succeeded status. The result
    // must be checked, not assumed, or the books record a refund that did not
    // occur and the held money is never flagged.
    const { route, inserted, logged } = harness({
        bookingWriteBack: { data: [], error: null },
        refundStatus: 'failed',
    });
    const res: any = await route.GET(authorised());

    assert.equal(inserted.filter((r) => r.kind === 'refund').length, 0, 'no refund row for a refund that failed');
    assert.equal(res.body.reconciled, 0);
    assert.equal(res.body.failed, 1);
    assert.ok(logged.some((m) => /URGENT/.test(m)), 'the held money is surfaced');
});

/* ---- 2. the booking write failed: leave the claim, replay the key -------- */

test('a failed booking write leaves the claim attempting and does not settle it', async () => {
    const { route, updated, refunds, emails, logged } = harness({
        bookingWriteBack: { data: null, error: { message: 'update failed' } },
    });
    const res: any = await route.GET(authorised());

    const settled = updated.filter((u) => u.table === 'payments' && u.patch.status === 'succeeded');
    assert.equal(settled.length, 0,
        'settling the claim would hide the dangling row the next run needs, and let a fresh key charge again');

    assert.equal(refunds.length, 0, 'the money is not refunded — the charge is real and will be replayed, not undone');
    assert.equal(res.body.charged, 0);
    assert.equal(res.body.failed, 1, 'counted as a failure so the run reports it');
    assert.ok(!emails.some((s) => /all paid up/i.test(s)), 'the guest is not told they are paid up when the record did not stick');
    assert.equal(logged.length, 1, 'it reaches /admin/errors');
    assert.match(logged[0], /replays the same charge/i);
});

test('the next run reuses the dead run’s key, so Stripe replays the one charge', async () => {
    // Run one charged and then failed to write the booking, leaving the claim
    // at 'attempting' with its amount. Run two finds it and must carry the SAME
    // key — the property the "leave it attempting" branch exists to preserve.
    const { route, charges, inserted } = harness({
        bookingWriteBack: { data: [{ id: DUE.id }], error: null },
        dangling: { id: 'pay-crashed', amount: 450 },
    });
    await route.GET(authorised());

    assert.equal(inserted.filter((r) => r.status === 'attempting').length, 0, 'no new claim is minted');
    assert.equal(charges[0].key, 'balance-attempt-pay-crashed',
        'the retry carries the dead run’s key, so Stripe replays rather than charging a second time');
});
