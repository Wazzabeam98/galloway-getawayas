// What a guest actually gets back, in pounds, for each cancellation policy.
//
// WHY THIS FILE EXISTS AT ALL.
//
// Until now nothing anywhere asserted a refund figure against a policy.
// `money.test.ts` tests `refundFraction()` in isolation — the fractions are
// well covered — but no test followed a fraction through a route to an amount
// handed to Stripe. `balance-charges.test.ts` stubs `/refunds` and throws the
// call away without looking at it.
//
// So every one of the three places that works out a refund could have been
// wrong, in any amount, and the suite would have stayed green. That is worse
// than the bug this was written alongside.
//
// The two routes under test here were also invisible: `app/api/stripe/refund`
// and `app/api/bookings/cancel` were two of the thirty-five route files
// missing from `tsconfig.test.json`, so a test against either failed with
// MODULE_NOT_FOUND rather than an assertion. They are on the list now.
//
// WHAT IT PINS, AND WHAT IS ABOUT TO CHANGE.
//
// These are today's figures, written down before the cleaning-fee rule lands.
// The published cancellation policy promises the cleaning fee back in full
// whenever a guest cancels, and the code does not do that — it takes a flat
// fraction of everything. When that is fixed, the expected amounts in the
// policy cases below change, deliberately and visibly, and the cases that must
// NOT move (a host cancelling, never exceeding what was paid) stay where they
// are. Having the numbers here first is what makes that diff readable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const GUEST = 'guest-1';
const HOST = 'host-1';

/**
 * A check-in date `days` from today, as the date-only string the column holds.
 *
 * Built from the local clock rather than a fixed date because the routes call
 * refundFraction() without an `on` argument, so "how many days before
 * check-in" is answered against the real today. A hard-coded date would make
 * these tests pass this week and fail next.
 */
function checkInDaysAway(days: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

interface Options {
    policy?: string;
    daysAway?: number;
    amountPaid?: number;
    alreadyRefunded?: number;
    totalPrice?: number;
    actor?: string;
    reason?: string;
    status?: string;
}

/**
 * Load a route with a fake database, a fake Stripe and a fake session, and
 * hand back the refunds it asked Stripe for.
 */
function load(routePath: string, options: Options = {}) {
    const refunds: any[] = [];
    const updates: any[] = [];

    const booking = {
        id: 'b-1',
        listing_id: 'l-1',
        guest_id: GUEST,
        host_id: HOST,
        check_in: checkInDaysAway(options.daysAway ?? 10),
        check_out: checkInDaysAway((options.daysAway ?? 10) + 3),
        status: options.status ?? 'confirmed',
        payment_status: 'paid',
        total_price: options.totalPrice ?? 400,
        amount_paid: options.amountPaid ?? 400,
        amount_refunded: options.alreadyRefunded ?? 0,
        stripe_payment_intent_id: 'pi_1',
        payout_transfer_id: null,
        payout_amount: 0,
        balance_amount: 0,
    };

    const rows: Record<string, any> = {
        bookings: booking,
        listings: { cancellation_policy: options.policy ?? 'Moderate' },
        profiles: { payout_balance_owed: 0 },
    };

    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'then') {
                        return (resolve: any) => resolve({ data: rows[table] ?? null, error: null });
                    }
                    if (prop === 'maybeSingle' || prop === 'single') {
                        return async () => ({ data: rows[table] ?? null, error: null });
                    }
                    if (prop === 'update') {
                        return (patch: any) => { updates.push({ table, patch }); return chain; };
                    }
                    if (prop === 'insert') {
                        return async () => ({ data: null, error: null });
                    }
                    return () => chain;
                },
            });
            return chain;
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: {
                getSession: async () => ({
                    data: { session: { user: { id: options.actor ?? GUEST } } },
                }),
            },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any) => {
            if (path === '/refunds') {
                refunds.push({ amount: body.amount, metadata: body.metadata });
                return { id: 're_1' };
            }
            return {};
        },
    });
    stubModule('@/lib/clawback', { clawBackPayout: async () => {} });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    // lib/supabaseAdmin captures createClient when it loads and is then cached
    // like any module, so without this every test after the first in this file
    // silently reuses the first one's fake database. See MAINTENANCE.md.
    clearModule('@/lib/supabaseAdmin');
    clearModule(routePath);

    return { route: require(routePath), refunds, updates };
}

const REFUND_ROUTE = '@/app/api/stripe/refund/route';
const CANCEL_ROUTE = '@/app/api/bookings/cancel/route';

function post(url: string, body: any) {
    return new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** Stripe is given pence. Read it back as pounds so the assertions are legible. */
function poundsRefunded(refunds: any[]): number {
    if (refunds.length === 0) return 0;
    return refunds.reduce((sum, r) => sum + r.amount, 0) / 100;
}

/* ------------------------------------------------- /api/stripe/refund */

test('outside the window, a guest gets everything back', async () => {
    // Moderate is a full refund more than 5 days before check-in.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Moderate', daysAway: 10 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(poundsRefunded(refunds), 400, '£400 paid, full refund window');
    assert.equal(res.body.refunded, 400);
});

test('inside the window, a guest gets half of what they paid', async () => {
    // Four days out on Moderate is the 50% band.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Moderate', daysAway: 4 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 200, '£400 paid, 50% band');
    assert.equal(res.body.refunded, 200);
});

test('inside the non-refundable part of a Firm policy, nothing is sent back', async () => {
    // Firm gives nothing within 7 days, and the route makes no Stripe call at
    // all rather than asking for a refund of zero.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Firm', daysAway: 3 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 0, 'Stripe should not be called for nothing');
    assert.equal(res.body.refunded, 0);
    assert.equal(res.body.nonRefundable, true);
});

test('a guest who paid only the deposit gets the policy share of the deposit', async () => {
    // £100 deposit on a £400 booking, cancelled in the 50% band. The fraction
    // is taken on what was actually paid, never on the headline total — the
    // difference is £50 against £200.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 4, amountPaid: 100, totalPrice: 400,
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 50, 'half of the £100 deposit, not half of £400');
});

test('a host cancelling returns everything, whatever the policy says', async () => {
    // The tier exists for guests changing their minds. A host calling off a
    // confirmed stay never keeps the money, even inside a Firm window.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Firm', daysAway: 3, actor: HOST, reason: 'cancelled',
    });
    const res = await route.POST(post('http://x/api/stripe/refund', {
        bookingId: 'b-1', reason: 'cancelled',
    }));

    assert.equal(poundsRefunded(refunds), 400, 'the whole £400, despite the Firm window');
    assert.equal(res.body.refunded, 400);
});

test('a second refund is worked out on what is left, not on what was paid', async () => {
    // £400 paid, £200 already returned. The 50% band applies to the £200 that
    // remains, so £100 — not another £200.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 4, amountPaid: 400, alreadyRefunded: 200,
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 100, 'half of the remaining £200');
});

test('a refund can never exceed what the guest actually paid', async () => {
    // Everything already given back. No call, and no negative amount.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Flexible', daysAway: 30, amountPaid: 400, alreadyRefunded: 400,
    });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 0);
    assert.equal(res.body.nothingToRefund, true);
});

/* ----------------------------------------------- /api/bookings/cancel */

test('cancelling from Your trips refunds the same figure as the refund route', async () => {
    // Two routes, one rule. They are separate code paths today, which is
    // exactly why both are asserted at the same numbers.
    const { route, refunds } = load(CANCEL_ROUTE, { policy: 'Moderate', daysAway: 4 });
    const res = await route.POST(post('http://x/api/bookings/cancel', { bookingId: 'b-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(poundsRefunded(refunds), 200, '£400 paid, 50% band — same as /api/stripe/refund');
});

test('cancelling from Your trips outside the window returns everything', async () => {
    const { route, refunds } = load(CANCEL_ROUTE, { policy: 'Moderate', daysAway: 10 });
    await route.POST(post('http://x/api/bookings/cancel', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 400);
});
