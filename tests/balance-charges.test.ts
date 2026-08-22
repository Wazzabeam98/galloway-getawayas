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

function dueBooking(overrides: any = {}) {
    return {
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
        ...overrides,
    };
}

// `lastFailureReason` is what the previous run recorded, which is how the job
// decides how long this guest gets.
function load(options: {
    onCharge?: () => any;
    // A `payments` row left at 'attempting' by a run that died mid-charge.
    danglingClaim?: any;
    attempts?: number;
    lastFailureReason?: string | null;
} = {}) {
    const updates: any[] = [];
    const inserts: any[] = [];
    const emails: any[] = [];

    const due = dueBooking({ balance_attempts: options.attempts || 0 });
    const onCharge = options.onCharge || (() => ({ id: 'pi_1', status: 'succeeded' }));

    // The balance job now claims a `payments` row before charging and uses its
    // id as the idempotency key, so this fake has to model two things it did
    // not before: an insert that can be chained with .select(), and the
    // difference between the two questions the job asks of `payments` — "is
    // there a dangling claim" (status = attempting) and "why did the last one
    // fail" (status = failed).
    let claimCounter = 0;

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const filters: Record<string, any> = {};
                    const chain: any = {
                        eq: (column: string, value: any) => { filters[column] = value; return chain; },
                        in: () => chain,
                        lte: () => chain,
                        gt: () => chain,
                        is: () => chain,
                        order: () => chain,
                        limit: () => chain,
                        maybeSingle: async () => {
                            if (table === 'listings') {
                                return {
                                    data: { title: 'A cottage', cancellation_policy: 'Moderate' },
                                    error: null,
                                };
                            }
                            if (table === 'payments') {
                                // The dangling-claim lookup. Nothing dangling
                                // unless a test says so.
                                if (filters.status === 'attempting') {
                                    return { data: options.danglingClaim || null, error: null };
                                }
                                return {
                                    data: options.lastFailureReason
                                        ? { failure_reason: options.lastFailureReason }
                                        : null,
                                    error: null,
                                };
                            }
                            return { data: null, error: null };
                        },
                        then: (resolve: any) =>
                            resolve({ data: table === 'bookings' ? [due] : [], error: null }),
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
                insert: (row: any) => {
                    inserts.push({ table, row });
                    const id = 'pay-' + (++claimCounter);
                    const result = { data: { id: id }, error: null };
                    // Awaited directly by callers that do not need the id, and
                    // chained through .select().maybeSingle() by the claim.
                    return {
                        select: () => ({ maybeSingle: async () => result }),
                        then: (resolve: any) => resolve({ data: null, error: null }),
                    };
                },
            };
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string) => {
            // The cancel path issues a refund; only the charge is under test.
            if (path === '/refunds') return { id: 're_1' };
            return onCharge();
        },
    });
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

    // The route reaches its database through lib/supabaseAdmin, which captures
    // createClient when it loads and is then cached like any other module. So
    // stubbing @supabase/supabase-js for a second test changed nothing: every
    // test after the first in this file silently reused the first one's fake
    // database, and passed or failed on data it was never given.
    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require('../app/api/cron/balance-charges/route');
    return { route, updates, inserts, emails };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/balance-charges', {
        headers: { authorization: 'Bearer test-secret' },
    });

// The job claims a `payments` row before charging and settles that same row
// afterwards, so what ended up recorded is the claim merged with the patch
// that closed it — not a single insert as it used to be.
function settledPayment(inserts: any[], updates: any[]) {
    const claim = inserts.find((i) => i.table === 'payments');
    const settle = updates.filter((u) => u.table === 'payments').pop();
    if (!claim && !settle) return undefined;
    return { row: Object.assign({}, claim ? claim.row : {}, settle ? settle.patch : {}) };
}

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
    const { route, inserts, updates } = load({ onCharge: authRequiredError });
    await route.GET(authorised());

    const payment = settledPayment(inserts, updates);
    assert.ok(payment, 'the failure must be recorded');
    assert.match(payment.row.failure_reason, /^authentication_required:/,
        'the marker is what a later run reads to decide how long the guest gets');
    assert.match(payment.row.failure_reason, /authenticate/i);
    assert.doesNotMatch(
        payment.row.failure_reason,
        /declined/i,
        'Stripe says "declined" for this, and repeating it misleads whoever reads the table'
    );
});

test('the guest is told their card is fine and they need to confirm it', async () => {
    const { route, emails } = load({ onCharge: authRequiredError });
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
    const { route, emails, inserts, updates } = load({ onCharge: plainDecline });
    await route.GET(authorised());

    assert.match(emails[0].subject, /couldn.t take the balance/i);
    assert.match(emails[0].html, /expired or there weren/i);

    const payment = settledPayment(inserts, updates);
    assert.match(payment.row.failure_reason, /declined/i);
});

// Without this the booking had no trail at all to the attempt that failed.
test('the payment intent from a failed charge is kept against the booking', async () => {
    const { route, updates } = load({ onCharge: authRequiredError });
    await route.GET(authorised());

    const saved = updates.find((u) => u.patch.balance_payment_intent_id);
    assert.ok(saved, 'the intent id must be recorded');
    assert.equal(saved.patch.balance_payment_intent_id, 'pi_needs_auth');
});

test('either way the booking is left alone and the attempt is counted', async () => {
    const { route, updates } = load({ onCharge: authRequiredError });
    await route.GET(authorised());

    const counted = updates.find((u) => u.patch.balance_attempts !== undefined);
    assert.equal(counted.patch.balance_attempts, 1);
    assert.equal(
        updates.filter((u) => u.table === 'bookings' && u.patch.status !== undefined).length,
        0,
        'one failed attempt must not change the booking status'
    );
});

/* -------------------------------------------------- how long the guest gets */

const AUTH_REASON = 'authentication_required: the guest’s bank asked them to authenticate';
const DECLINE_REASON = 'Your card was declined.';

const cancelled = (updates: any[]) =>
    updates.some((u) => u.table === 'bookings' && u.patch.status === 'cancelled');

// A declined card is the guest's to fix now, so the deadline stays at 72 hours
// and the fourth run gives up.
test('three failed attempts on a declined card cancels the booking', async () => {
    const { route, updates } = load({
        onCharge: plainDecline, attempts: 3, lastFailureReason: DECLINE_REASON,
    });
    await route.GET(authorised());

    assert.ok(cancelled(updates), 'the fourth run cancels');
});

// Nothing is wrong with the card. The guest simply has to be at their phone
// when the bank asks, and 72 hours is not long for that.
test('a booking waiting on authentication is not cancelled after 72 hours', async () => {
    const { route, updates } = load({
        onCharge: authRequiredError, attempts: 3, lastFailureReason: AUTH_REASON,
    });
    await route.GET(authorised());

    assert.equal(cancelled(updates), false, 'three days is not the deadline for this');

    const counted = updates.find((u) => u.patch.balance_attempts !== undefined);
    assert.equal(counted.patch.balance_attempts, 4, 'it keeps trying');
});

test('a booking waiting on authentication is cancelled after seven days', async () => {
    const { route, updates } = load({
        onCharge: authRequiredError, attempts: 7, lastFailureReason: AUTH_REASON,
    });
    await route.GET(authorised());

    assert.ok(cancelled(updates), 'a week is the deadline, and it has passed');
});

test('the guest waiting on their bank is told they have a week, not 72 hours', async () => {
    const { route, emails } = load({ onCharge: authRequiredError });
    await route.GET(authorised());

    assert.match(emails[0].html, /7 days/, 'the deadline the code will actually apply');
    assert.doesNotMatch(emails[0].html, /72 hours/);
});

test('a declined card still gets 72 hours', async () => {
    const { route, emails } = load({ onCharge: plainDecline });
    await route.GET(authorised());

    assert.match(emails[0].html, /72 hours/);
});

// The longer deadline applies from the attempt that asked for authentication,
// not from the run after it — otherwise the first such failure still counts
// down against the short one.
test('the longer deadline applies from the attempt that triggered it', async () => {
    const { route, emails } = load({
        onCharge: authRequiredError, attempts: 2, lastFailureReason: DECLINE_REASON,
    });
    await route.GET(authorised());

    assert.match(emails[0].html, /5 days/, 'attempt 3 of 7 leaves four more runs plus this one');
});

test('the cancellation email says how long was actually allowed', async () => {
    const { route, emails } = load({
        onCharge: authRequiredError, attempts: 7, lastFailureReason: AUTH_REASON,
    });
    await route.GET(authorised());

    const guestEmail = emails.find((e) => /has been cancelled/.test(e.subject));
    assert.ok(guestEmail);
    assert.match(guestEmail.html, /7 days/);
    assert.doesNotMatch(guestEmail.html, /72 hours/);
});
