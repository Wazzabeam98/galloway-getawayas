// Scenario 11. A bank asking the guest to confirm an off-session payment is
// not a decline, and in the UK it is commoner than one. Stripe's own message
// for it opens with 'Your card was declined', so left alone both the payments
// record and the guest's email told them to check a card that is perfectly
// fine.
//
// The runner in scripts/balance-scenarios.mjs proves this against real Stripe,
// but it cannot see the email — nothing is sent without RESEND_API_KEY. That
// part is covered here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/balance-charges/route';

const DUE = {
    id: 'b-1',
    listing_id: 'l-1',
    guest_id: 'g-1',
    host_id: 'h-1',
    check_in: '2099-01-01',
    check_out: '2099-01-04',
    balance_amount: 600,
    balance_due_date: '2020-01-01',
    balance_attempts: 0,
    balance_last_attempt_at: null,
    amount_paid: 200,
    amount_refunded: 0,
    stripe_customer_id: 'cus_1',
    stripe_payment_method_id: 'pm_1',
    stripe_payment_intent_id: 'pi_deposit',
    payment_status: 'deposit_paid',
    status: 'confirmed',
};

function load(onCharge: () => any) {
    const updates: any[] = [];
    const inserts: any[] = [];
    const emails: any[] = [];

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain,
                        in: () => chain,
                        lte: () => chain,
                        gt: () => chain,
                        is: () => chain,
                        maybeSingle: async () => ({
                            data: table === 'listings'
                                ? { title: 'A cottage', cancellation_policy: 'Moderate' }
                                : null,
                            error: null,
                        }),
                        then: (resolve: any) =>
                            resolve({ data: table === 'bookings' ? [DUE] : [], error: null }),
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
                    return { data: null, error: null };
                },
            };
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', { stripeRequest: async () => onCharge() });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            emails.push({ to, subject, html });
            return true;
        },
        emailLayout: (body: string) => body,
        escapeHtml: (s: string) => s,
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
    const route = require('../app/api/cron/balance-charges/route');
    return { route, updates, inserts, emails };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/balance-charges', {
        headers: { authorization: 'Bearer test-secret' },
    });

function authRequiredError() {
    const err: any = new Error('Your card was declined. This transaction requires authentication.');
    err.stripeCode = 'authentication_required';
    err.stripePaymentIntent = { id: 'pi_needs_auth', status: 'requires_payment_method' };
    throw err;
}

function plainDecline() {
    const err: any = new Error('Your card was declined.');
    err.stripeCode = 'card_declined';
    err.stripePaymentIntent = { id: 'pi_declined' };
    throw err;
}

test('a payment needing authentication is not recorded as a decline', async () => {
    const { route, inserts } = load(authRequiredError);
    await route.GET(authorised());

    const payment = inserts.find((i) => i.table === 'payments');
    assert.ok(payment, 'the failure must be recorded');
    assert.match(payment.row.failure_reason, /authenticate/i);
    assert.doesNotMatch(
        payment.row.failure_reason,
        /declined/i,
        'Stripe says "declined" for this, and repeating it misleads whoever reads the table'
    );
});

test('the guest is told their card is fine and they need to confirm it', async () => {
    const { route, emails } = load(authRequiredError);
    await route.GET(authorised());

    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /confirm a payment/i);
    assert.match(emails[0].html, /nothing wrong with your card/i);
    assert.doesNotMatch(
        emails[0].html,
        /expired or there weren/i,
        'telling them the card expired sends them to fix something that is not broken'
    );
});

test('a real decline still gets the old advice', async () => {
    const { route, emails, inserts } = load(plainDecline);
    await route.GET(authorised());

    assert.match(emails[0].subject, /couldn.t take the balance/i);
    assert.match(emails[0].html, /expired or there weren/i);

    const payment = inserts.find((i) => i.table === 'payments');
    assert.match(payment.row.failure_reason, /declined/i);
});

// Without this the booking had no trail at all to the attempt that failed.
test('the payment intent from a failed charge is kept against the booking', async () => {
    const { route, updates } = load(authRequiredError);
    await route.GET(authorised());

    const saved = updates.find((u) => u.patch.balance_payment_intent_id);
    assert.ok(saved, 'the intent id must be recorded');
    assert.equal(saved.patch.balance_payment_intent_id, 'pi_needs_auth');
});

test('either way the booking is left alone and the attempt is counted', async () => {
    const { route, updates } = load(authRequiredError);
    await route.GET(authorised());

    const counted = updates.find((u) => u.patch.balance_attempts !== undefined);
    assert.equal(counted.patch.balance_attempts, 1);
    assert.equal(
        updates.filter((u) => u.patch.status !== undefined).length,
        0,
        'one failed attempt must not change the booking status'
    );
});
