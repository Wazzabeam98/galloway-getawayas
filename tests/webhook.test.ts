// Scenario 2. A booking paid in full has nothing outstanding, and the column
// that says what is outstanding has to be able to say zero. It was left null,
// which reads as 'unknown' and becomes NaN the moment anything does arithmetic
// on it.
//
// Checkout sets it too, and that half is covered live in the runner. This
// covers the webhook, which is the point the money actually lands and the last
// chance to correct a booking that arrived with a null on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const ROUTE = '@/app/api/stripe/webhook/route';

const BOOKING = {
    id: 'b-1', status: 'pending_payment', total_price: 300, listing_id: 'l-1',
    amount_paid: 0, guest_id: 'g-1', check_in: '2099-01-01',
};

// `confirmError` is what the database says when the update is refused —
// 23P01 is the exclusion constraint that makes two confirmed stays on one
// week impossible.
function load(options: { booking?: any; confirmError?: any } = {}) {
    const booking = options.booking === undefined ? BOOKING : options.booking;
    const updates: any[] = [];
    const inserts: any[] = [];
    const emails: any[] = [];
    const stripeCalls: any[] = [];
    let confirmsSeen = 0;

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain,
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
                            // Only the confirming write is refused; the one
                            // that calls the stay off afterwards must succeed.
                            if (table === 'bookings' && options.confirmError) {
                                confirmsSeen++;
                                if (confirmsSeen === 1) return { data: null, error: options.confirmError };
                            }
                            return { data: null, error: null };
                        },
                    };
                },
                insert: async (row: any) => {
                    inserts.push({ table, row });
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
        stripeRequest: async (method: string, path: string, body: any, key?: string) => {
            stripeCalls.push({ method, path, body, idempotencyKey: key });
            if (path === '/refunds') return { id: 're_1' };
            return { payment_method: 'pm_1', customer: 'cus_1' };
        },
    });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            emails.push({ to, subject, html });
            return true;
        },
        emailLayout: (body: string) => body,
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

    clearModule(ROUTE);
    const route = require('../app/api/stripe/webhook/route');
    return { route, updates, inserts, emails, stripeCalls };
}

function completedSession(kind: string, amountTotal: number) {
    return new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id: 'evt_' + kind,
            type: 'checkout.session.completed',
            data: {
                object: {
                    payment_status: 'paid',
                    amount_total: amountTotal,
                    payment_intent: 'pi_1',
                    customer: 'cus_1',
                    client_reference_id: 'b-1',
                    metadata: { booking_id: 'b-1', kind: kind },
                },
            },
        }),
    });
}

const bookingPatch = (updates: any[]) =>
    updates.filter((u) => u.table === 'bookings').pop().patch;

test('paying in full leaves nothing outstanding, as zero rather than null', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('full', 30000));

    const patch = bookingPatch(updates);
    assert.equal(patch.payment_status, 'paid');
    assert.equal(patch.amount_paid, 300);
    assert.equal(patch.balance_amount, 0, 'zero, not null — null is not a number');
    assert.notEqual(patch.balance_amount, null);
});

test('paying a deposit leaves the balance alone', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('deposit', 7500));

    const patch = bookingPatch(updates);
    assert.equal(patch.payment_status, 'deposit_paid');
    assert.equal(patch.amount_paid, 75);
    assert.equal(
        patch.balance_amount,
        undefined,
        'checkout worked out what is still owed; the webhook must not flatten it'
    );
});

test('an Instant Book listing confirms the booking on payment', async () => {
    const { route, updates } = load();
    await route.POST(completedSession('full', 30000));

    const patch = bookingPatch(updates);
    assert.equal(patch.status, 'confirmed');
    assert.ok(patch.confirmed_at, 'the moment it was confirmed is recorded');
});

/* ------------------------------- nights taken while the guest was paying */

// The exclusion constraint is the only thing that can say for certain that two
// stays clash. When it fires, the guest has already paid for nights they
// cannot have.
const EXCLUSION = {
    code: '23P01',
    message: 'conflicting key value violates exclusion constraint "bookings_no_overlapping_confirmed"',
};

test('a guest who paid for nights since taken is refunded in full', async () => {
    const { route, stripeCalls, inserts } = load({ confirmError: EXCLUSION });
    const res: any = await route.POST(completedSession('full', 30000));

    assert.equal(res.body.oversold, true);
    assert.equal(res.body.refunded, 300);

    const refund = stripeCalls.find((c) => c.path === '/refunds');
    assert.ok(refund, 'the money must go back');
    assert.equal(refund.body.amount, 30000, 'all of it, in pence');
    assert.equal(refund.body.payment_intent, 'pi_1');

    const row = inserts.find((i) => i.table === 'payments' && i.row.kind === 'refund');
    assert.ok(row, 'the refund is recorded');
});

// A redelivered event must not send the money back twice.
test('the refund is keyed so a repeat delivery cannot refund twice', async () => {
    const { route, stripeCalls } = load({ confirmError: EXCLUSION });
    await route.POST(completedSession('full', 30000));

    const refund = stripeCalls.find((c) => c.path === '/refunds');
    assert.equal(refund.idempotencyKey, 'oversold-pi_1');
});

// Money first, then the booking. Never the other way round.
test('the money goes back before the stay is called off', async () => {
    const { route, updates } = load({ confirmError: EXCLUSION });
    await route.POST(completedSession('full', 30000));

    const cancel = updates.filter((u) => u.table === 'bookings').pop();
    assert.equal(cancel.patch.status, 'cancelled');
    assert.equal(cancel.patch.payment_status, 'refunded');
    assert.equal(cancel.patch.amount_paid, 300, 'they did pay, and the books should say so');
    assert.equal(cancel.patch.amount_refunded, 300, 'and they were paid back');
});

test('the guest is told, apologised to, and reassured about the money', async () => {
    const { route, emails } = load({ confirmError: EXCLUSION });
    await route.POST(completedSession('full', 30000));

    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /sorry/i);
    assert.match(emails[0].html, /have not been charged/i);
    assert.match(emails[0].html, /£300\.00/);
    assert.match(emails[0].html, /our fault, not yours/i);
});

// A failure that a refund does not fix must not quietly refund anyway.
test('any other write failure is reported rather than refunded', async () => {
    const { route, stripeCalls, emails } = load({
        confirmError: { code: '08006', message: 'connection failure' },
    });
    const res: any = await route.POST(completedSession('full', 30000));

    assert.notEqual(res.body.oversold, true);
    assert.equal(stripeCalls.filter((c) => c.path === '/refunds').length, 0,
        'the guest keeps their booking; this is for a human to look at');
    assert.equal(emails.length, 0);
});

test('a booking that confirms normally is not disturbed', async () => {
    const { route, stripeCalls, emails, updates } = load();
    await route.POST(completedSession('full', 30000));

    assert.equal(stripeCalls.filter((c) => c.path === '/refunds').length, 0);
    assert.equal(emails.length, 0);
    assert.equal(bookingPatch(updates).status, 'confirmed');
});
