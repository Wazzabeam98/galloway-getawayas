// One payment, counted once — however many times the event arrives.
//
// WHAT WAS WRONG. The balance branch did amount_paid = amount_paid + amount.
// Adding is the right sum: the deposit is already in that column and the
// balance goes on top of it. But it is right exactly once, and nothing made it
// once. Proved end to end against a real test-mode payment — one £150 balance
// handled twice left a £300 booking claiming the guest had paid £450, and two
// succeeded rows in the ledger for one payment intent. MONEY-IDEMPOTENCY.md
// has the run.
//
// WHY THE FIX IS NOT "SET INSTEAD OF ADD". Setting amount_paid to `amount`
// would forget the deposit and understate what the guest paid — the same bug
// pointing the other way, and the direction that shortchanges a guest on a
// refund. The question is not which arithmetic to use, it is whether this
// payment has already been counted, and only the database can answer that.
//
// So the ledger row is written FIRST, and the unique index from
// 20260829090000_payments_one_row_per_intent.sql answers it: a 23505 means
// "already recorded", and amount_paid is left alone. The index is not a safety
// net here, it is the mechanism — which is why one of the tests below reads the
// migration file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const ROUTE = '@/app/api/stripe/webhook/route';
const ROOT = path.resolve(__dirname, '..', '..');

const DEPOSIT_PAID = {
    id: 'b-1',
    status: 'confirmed',
    total_price: 300,
    listing_id: 'l-1',
    amount_paid: 150,      // the deposit is already here
    guest_id: 'g-1',
    check_in: '2099-01-01',
};

const CONFLICT = { code: '23505', message: 'duplicate key value violates unique constraint' };

/**
 * `ledgerError` is what the payments insert hands back. 23505 is the index
 * refusing a payment it already holds; anything else is a real failure.
 */
function load(options: { ledgerError?: any; booking?: any } = {}) {
    const booking = options.booking === undefined ? DEPOSIT_PAID : options.booking;
    const updates: any[] = [];
    const inserts: any[] = [];
    const reported: any[] = [];

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
                            updates.push({ table, patch, id });
                            return { data: null, error: null };
                        },
                    };
                },
                insert: async (row: any) => {
                    inserts.push({ table, row });
                    if (table === 'payments' && options.ledgerError) {
                        return { data: null, error: options.ledgerError };
                    }
                    return { data: null, error: null };
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
    return { route, updates, inserts, reported };
}

function balancePaid(amountTotal: number, id = 'evt_balance_1') {
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
                    payment_intent: 'pi_balance_1',
                    customer: 'cus_1',
                    client_reference_id: 'b-1',
                    metadata: { booking_id: 'b-1', kind: 'balance' },
                },
            },
        }),
    });
}

const bookingPatch = (updates: any[]) =>
    updates.filter((u) => u.table === 'bookings').pop().patch;

/* ------------------------------------------------ the first delivery is right */

test('deposit plus balance comes to the whole stay', async () => {
    // The half that must not regress. Setting amount_paid to the balance
    // instead of adding it would forget the £150 deposit and understate what
    // the guest paid — which is what a refund is worked out from.
    const { route, updates } = load();
    await route.POST(balancePaid(15000));

    assert.equal(bookingPatch(updates).amount_paid, 300,
        '£150 deposit + £150 balance = £300, not £150');
    assert.equal(bookingPatch(updates).payment_status, 'paid');
    assert.equal(bookingPatch(updates).balance_amount, 0);
});

test('the ledger row is written before the booking is updated', async () => {
    // Order matters, and not for tidiness: the insert is what asks the
    // database whether this payment is already counted, and the answer decides
    // what the update writes.
    const { route, inserts, updates } = load();
    await route.POST(balancePaid(15000));

    const ledgerRow = inserts.filter((i) => i.table === 'payments')[0];
    assert.ok(ledgerRow, 'no ledger row was written');
    assert.equal(ledgerRow.row.kind, 'balance');
    assert.equal(ledgerRow.row.status, 'succeeded');
    assert.equal(ledgerRow.row.stripe_payment_intent_id, 'pi_balance_1',
        'without the intent id on the row the index cannot recognise a repeat');
    assert.ok(updates.some((u) => u.table === 'bookings'));
});

/* ----------------------------------------------- the second delivery is not */

test('a payment the ledger already holds does not move amount_paid again', async () => {
    const { route, updates } = load({ ledgerError: CONFLICT });
    await route.POST(balancePaid(15000));

    const patch = bookingPatch(updates);
    assert.equal(patch.amount_paid, undefined,
        'amount_paid must not be in the patch at all — £450 for a £300 stay is how it was');
});

test('everything that is safe to write again still is', async () => {
    // Refusing to count the money twice must not mean refusing to finish the
    // job. 'paid' is 'paid' and zero outstanding is zero outstanding, however
    // many times the event arrives.
    const { route, updates } = load({ ledgerError: CONFLICT });
    await route.POST(balancePaid(15000));

    const patch = bookingPatch(updates);
    assert.equal(patch.payment_status, 'paid');
    assert.equal(patch.balance_amount, 0);
});

test('a duplicate is not reported as a failure', async () => {
    // /admin/errors is only worth reading if everything on it is real. A
    // redelivery is the mechanism working.
    const { route, reported } = load({ ledgerError: CONFLICT });
    await route.POST(balancePaid(15000));

    assert.deepEqual(reported, [],
        'a recognised repeat is not an error: ' + reported.map((r) => r.message).join(' | '));
});

test('the response says whether the money was counted', async () => {
    const first = load();
    const firstRes: any = await first.route.POST(balancePaid(15000));
    assert.equal(firstRes.body.counted, true);

    const repeat = load({ ledgerError: CONFLICT });
    const repeatRes: any = await repeat.route.POST(balancePaid(15000));
    assert.equal(repeatRes.body.counted, false);
    assert.equal(repeatRes.status, 200, 'still not an error to Stripe');
});

/* ------------------------------------ a real ledger failure is still a failure */

test('a ledger write that fails for any other reason is still reported', async () => {
    const { route, reported } = load({
        ledgerError: { code: '08006', message: 'connection failure' },
    });
    await route.POST(balancePaid(15000));

    assert.ok(
        reported.some((r) => /missing from the payments ledger/.test(r.message)),
        'only 23505 is benign: ' + reported.map((r) => r.message).join(' | ')
    );
});

test('a genuine ledger failure still records the money on the booking', async () => {
    // If the ledger row never wrote, this payment is genuinely uncounted, so
    // the next delivery SHOULD count it. The distinction is the whole point of
    // keying on 23505 rather than on "did the insert fail".
    const { route, updates } = load({
        ledgerError: { code: '08006', message: 'connection failure' },
    });
    await route.POST(balancePaid(15000));

    assert.equal(bookingPatch(updates).amount_paid, 300,
        'a failed ledger write must not also stop the money being recorded on the booking');
});

/* ------------------------------- the full-payment path, which also redelivers */

function fullyPaid(id = 'evt_full_1') {
    return new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id,
            type: 'checkout.session.completed',
            data: {
                object: {
                    payment_status: 'paid',
                    amount_total: 30000,
                    payment_intent: 'pi_full_1',
                    customer: 'cus_1',
                    client_reference_id: 'b-1',
                    metadata: { booking_id: 'b-1', kind: 'full' },
                },
            },
        }),
    });
}

// This one was found by delivering a paid event twice against the running
// site, after the unit tests were already green. The ledger correctly held one
// row, and /admin/errors got an alarm saying the payment was missing from the
// ledger — about a payment that was right there. The tests passed because they
// only ever exercised a non-23505 failure.
test('a redelivered full payment does not raise a false alarm', async () => {
    const { route, reported } = load({ ledgerError: CONFLICT });
    await route.POST(fullyPaid());

    assert.deepEqual(reported, [],
        'the ledger already holds this payment; saying it is missing is a lie: '
        + reported.map((r) => r.message).join(' | '));
});

test('a redelivered full payment still writes the same amount_paid', async () => {
    // Unlike the balance branch this one SETS rather than adds, so it was
    // already safe to run twice. Pinned so it stays that way.
    const { route, updates } = load({ ledgerError: CONFLICT });
    await route.POST(fullyPaid());

    assert.equal(bookingPatch(updates).amount_paid, 300);
});

test('a full payment genuinely missing from the ledger is still reported', async () => {
    const { route, reported } = load({
        ledgerError: { code: '08006', message: 'connection failure' },
    });
    await route.POST(fullyPaid());

    assert.ok(reported.some((r) => /missing from the payments ledger/.test(r.message)),
        reported.map((r) => r.message).join(' | '));
});

/* ------------------------------------------------- the index it all rests on */

test('the migration that makes this work exists', () => {
    const file = path.join(
        ROOT, 'supabase/migrations/20260829090000_payments_one_row_per_intent.sql'
    );
    assert.ok(fs.existsSync(file),
        'the code above treats 23505 as "already counted". Without this index nothing '
        + 'ever conflicts and it silently goes back to double-counting.');

    const sql = fs.readFileSync(file, 'utf8');
    assert.match(sql, /create unique index/i);
    assert.match(sql, /stripe_payment_intent_id/);
});

test('the index deliberately leaves refunds alone', () => {
    // A booking can genuinely be refunded twice against one payment intent — a
    // partial refund on cancellation and another later, which
    // app/api/bookings/cancel/route.ts already handles by adding to
    // alreadyRefunded. An index covering refunds would refuse the second one
    // and turn a bookkeeping fix into a refund that does not happen.
    const sql = fs.readFileSync(
        path.join(ROOT, 'supabase/migrations/20260829090000_payments_one_row_per_intent.sql'),
        'utf8'
    );
    assert.match(sql, /kind\s*<>\s*'refund'/,
        'refunds must stay outside this index');
});

test('the webhook does not treat a duplicate refund row as benign', () => {
    // The mirror of the test above. Refunds are outside the index, so a 23505
    // on a refund row would mean something genuinely unexpected — it must not
    // be swallowed by a copy-pasted 23505 check.
    const body = fs.readFileSync(
        path.join(ROOT, 'app/api/stripe/webhook/route.ts'), 'utf8'
    );
    const refundBlock = body.slice(
        body.indexOf("kind: 'refund'"),
        body.indexOf("kind: 'refund'") + 900
    );
    assert.ok(
        !/23505/.test(refundBlock),
        'the refund ledger insert must not excuse a 23505 — nothing should be producing one'
    );
});
