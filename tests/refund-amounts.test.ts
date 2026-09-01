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
// WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
//
// These figures were first written down against the old behaviour, one commit
// before the rule changed, so the diff shows the money moving:
//
//   50% band, £400 paid, £60 clean      £200 -> £230
//   Firm, 3 days out, £60 clean         £0   -> £60, and Stripe is now called
//   £100 deposit, 50% band              £50  -> £80
//   the same, via /api/bookings/cancel  £200 -> £230
//
// And the cases that must not move, which is half the point of having them:
// a host cancellation still returns everything, a refund still cannot exceed
// what was paid, a second refund is still worked out on what remains, and a
// booking with no cleaning fee — or one older than the column — behaves
// exactly as it always did.

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
    cleaningFee?: number | null;
    daysAway?: number;
    amountPaid?: number;
    alreadyRefunded?: number;
    totalPrice?: number;
    actor?: string;
    reason?: string;
    status?: string;
    /** Charge amounts in pence, keyed by payment intent id. */
    charges?: Record<string, number>;
    balanceIntentId?: string | null;
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
        // Stamped at checkout from the server-side quote. £60 of the £400
        // unless a test says otherwise.
        cleaning_fee: options.cleaningFee === undefined ? 60 : options.cleaningFee,
        stripe_payment_intent_id: 'pi_1',
        balance_payment_intent_id: options.balanceIntentId ?? null,
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
        // The cancellation penalty now goes through the database function
        // instead of a read-add-write on profiles. Modelled here the same way,
        // and recorded where the profiles update used to be.
        async rpc(name: string, args: any) {
            if (name !== 'adjust_payout_balance') return { data: null, error: null };
            const current = Number(rows.profiles.payout_balance_owed || 0);
            const next = Math.max(0, Math.round((current + Number(args.p_delta)) * 100) / 100);
            rows.profiles.payout_balance_owed = next;
            updates.push({ table: 'profiles', patch: { payout_balance_owed: next } });
            return { data: next, error: null };
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: {
                // The route verifies identity with getUser() now, not
                // getSession() — see the route header. The stub mirrors that so
                // the test exercises the same call the code makes.
                getUser: async () => ({
                    data: { user: { id: options.actor ?? GUEST } },
                }),
            },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    // The route now reads the charge behind each payment intent before it
    // refunds, because a deposit booking has two of them and a Stripe refund
    // may not exceed the one it names. See lib/refundSpread.ts. The double has
    // to answer those reads or every refund here looks unfundable.
    //
    // One charge, holding everything paid, unless a test says otherwise —
    // which is the single-charge booking these cases were all written around.
    const chargeAmounts: Record<string, number> = options.charges
        || { pi_1: Math.round((options.amountPaid ?? 400) * 100) };
    const refundedPerIntent: Record<string, number> = {};

    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any, idempotencyKey?: string) => {
            if (path === '/refunds') {
                refunds.push({
                    amount: body.amount,
                    metadata: body.metadata,
                    intent: body.payment_intent,
                    idempotencyKey: idempotencyKey,
                });
                refundedPerIntent[body.payment_intent] =
                    (refundedPerIntent[body.payment_intent] || 0) + body.amount;
                return { id: 're_' + refunds.length };
            }
            const intentMatch = path.match(/^\/payment_intents\/(.+)$/);
            if (intentMatch) {
                return chargeAmounts[intentMatch[1]] === undefined
                    ? {}
                    : { id: intentMatch[1], latest_charge: 'ch_' + intentMatch[1] };
            }
            const chargeMatch = path.match(/^\/charges\/ch_(.+)$/);
            if (chargeMatch) {
                const intent = chargeMatch[1];
                return {
                    id: 'ch_' + intent,
                    amount: chargeAmounts[intent] || 0,
                    amount_refunded: refundedPerIntent[intent] || 0,
                };
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
    // And lib/refundSpread, for exactly the same reason: it captures
    // stripeRequest when it loads. Without this every test after the first in
    // this file reads charges through the FIRST test's Stripe double, which
    // has already recorded that test's refund — so the charge looks fully
    // refunded, there is nothing left to refund against, and six tests fail
    // with 0. Third time this module-caching shape has cost time here; see
    // MAINTENANCE.md.
    clearModule('@/lib/refundSpread');
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

test('inside the window, the clean comes back whole and the rest is halved', async () => {
    // Four days out on Moderate is the 50% band. £60 clean returned in full,
    // then half of the remaining £340. This was a flat £200 until the code was
    // brought into line with the published policy.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Moderate', daysAway: 4 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 230, '£60 clean + half of £340');
    assert.equal(res.body.refunded, 230);
});

test('inside a non-refundable window the clean STILL comes back', async () => {
    // The sharpest edge of the change. Firm gives nothing on the stay within
    // 7 days, and this route used to make no Stripe call at all. "Whenever you
    // cancel" is what the policy page promises, so the £60 clean goes back and
    // a refund now happens where none did before.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Firm', daysAway: 3 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 1, 'Stripe is now called where it was not');
    assert.equal(poundsRefunded(refunds), 60, 'the cleaning fee, and nothing else');
    assert.equal(res.body.refunded, 60);
});

test('with no cleaning fee, a non-refundable window still refunds nothing', async () => {
    // The case that must not move. A host who charges no cleaning fee sees
    // exactly the behaviour they saw before: no refund, and no Stripe call.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Firm', daysAway: 3, cleaningFee: 0 });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 0, 'Stripe should not be called for nothing');
    assert.equal(res.body.nonRefundable, true);
});

test('a booking older than the cleaning_fee column behaves exactly as before', async () => {
    // Null is "we do not know what was charged". Half of £400, as today.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 4, cleaningFee: null,
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 200);
});

test('a deposit-only guest gets the clean whole, then the share of the rest', async () => {
    // £100 deposit on a £400 booking with a £60 clean, cancelled in the 50%
    // band: £60 + half of the remaining £40 = £80 of the £100 they paid.
    //
    // Accepted knowingly — a deposit-payer can get most of their deposit back
    // under a policy that promises half. Note the fraction is still taken on
    // what was PAID and never on the headline total.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 4, amountPaid: 100, totalPrice: 400,
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 80, '£60 clean + half of the remaining £40');
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
    // Two routes, one rule — they call the same refundDue(). Separate code
    // paths, which is exactly why both are asserted at the same number.
    const { route, refunds } = load(CANCEL_ROUTE, { policy: 'Moderate', daysAway: 4 });
    const res = await route.POST(post('http://x/api/bookings/cancel', { bookingId: 'b-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(poundsRefunded(refunds), 230, 'the same £230 as /api/stripe/refund, not a second sum');
});

test('cancelling from Your trips outside the window returns everything', async () => {
    const { route, refunds } = load(CANCEL_ROUTE, { policy: 'Moderate', daysAway: 10 });
    await route.POST(post('http://x/api/bookings/cancel', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 400);
});

// ---------------------------------------------------------------------------
// A STAY PAID TWICE IS REFUNDED TWICE
// ---------------------------------------------------------------------------
//
// A deposit booking is charged at checkout and again thirty days before
// check-in, and a Stripe refund names ONE payment intent and may not exceed
// what that charge took. The route refunded the whole amount against
// `stripe_payment_intent_id` alone, so Stripe answered
//
//   Refund amount (£300.00) is greater than charge amount (£150.00)
//
// the route threw, and the guest got nothing. Watched happening on the test
// project on 31 August 2026, on a £150 + £150 booking.
//
// The deposit is 25% of the total, so this bit every deposit booking refunded
// above a quarter of what it cost — which is nearly all of them.

test('a deposit booking is refunded across both of its charges', async () => {
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 10, actor: HOST, reason: 'cancelled',
        amountPaid: 300, totalPrice: 300, cleaningFee: 0,
        balanceIntentId: 'pi_balance',
        charges: { pi_1: 15000, pi_balance: 15000 },
    });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(res.body.ok, true, 'this used to throw and refund nothing at all');
    assert.equal(poundsRefunded(refunds), 300, 'the whole £300 goes back');
    assert.equal(refunds.length, 2, 'one refund per charge, because Stripe names one intent each');

    assert.equal(refunds[0].intent, 'pi_1', 'the deposit first — the older charge');
    assert.equal(refunds[0].amount, 15000);
    assert.equal(refunds[1].intent, 'pi_balance');
    assert.equal(refunds[1].amount, 15000);

    assert.equal(res.body.refunded, 300);
    assert.equal(res.body.shortOfDue, 0);
});

test('a partial refund on a deposit booking stops at the first charge that covers it', async () => {
    // £100 of a £300 stay. The deposit alone covers it, so the balance charge
    // is left alone entirely.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 4, amountPaid: 300, totalPrice: 300, cleaningFee: 0,
        balanceIntentId: 'pi_balance',
        charges: { pi_1: 15000, pi_balance: 15000 },
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(poundsRefunded(refunds), 150, 'half of £300 in the 50% band');
    assert.equal(refunds.length, 1, 'the deposit covers it on its own');
    assert.equal(refunds[0].intent, 'pi_1');
});

test('the same intent in both columns is not counted twice', async () => {
    // The webhook's balance branch writes `stripe_payment_intent_id` as well,
    // so a balance paid by hand from the reminder link can leave both columns
    // holding the same intent. Counting it twice would offer £300 of room on a
    // £150 charge and produce the very overspend this fixes.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 10, actor: HOST, reason: 'cancelled',
        amountPaid: 300, totalPrice: 300, cleaningFee: 0,
        balanceIntentId: 'pi_1',
        charges: { pi_1: 15000 },
    });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 1, 'one charge, one refund');
    assert.equal(poundsRefunded(refunds), 150, 'and never more than the charge holds');
    assert.equal(res.body.refunded, 150, 'what actually went back, not what was due');
    assert.equal(res.body.shortOfDue, 150, 'and the difference is named rather than hidden');
});

test('a refund carries an idempotency key, so a double-click cannot pay twice', async () => {
    // This call had none. Two cancel requests arriving together both read the
    // same `amount_refunded`, both worked out the same amount, and both
    // refunded it — the guest got their money back twice.
    const { route, refunds } = load(REFUND_ROUTE, { policy: 'Moderate', daysAway: 10 });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 1);
    assert.ok(refunds[0].idempotencyKey, 'a money-moving call without one is a double refund waiting');
    assert.match(String(refunds[0].idempotencyKey), /^refund-b-1-0-pi_1$/);
});

test('a second refund gets its own key, so it is not replayed as the first', async () => {
    // A booking may legitimately be refunded twice — a partial now, the rest
    // later. Keying on the booking alone would make Stripe replay the first
    // refund and send the guest nothing the second time.
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 10, alreadyRefunded: 100,
    });
    await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.match(String(refunds[0].idempotencyKey), /^refund-b-1-10000-pi_1$/);
});

test('a charge that cannot be read stops the refund rather than half-doing it', async () => {
    const { route, refunds } = load(REFUND_ROUTE, {
        policy: 'Moderate', daysAway: 10, charges: {},
    });
    const res = await route.POST(post('http://x/api/stripe/refund', { bookingId: 'b-1' }));

    assert.equal(refunds.length, 0);
    assert.equal(res.body.ok, false);
    assert.equal(res.status, 502);
    assert.match(String(res.body.error), /could not reach the original payment/i);
});

test('the guest cancel button also refunds across both charges', async () => {
    // Same bug, same fix, a different route. All four places that refund had
    // their own copy of "refund against stripe_payment_intent_id", and this is
    // the one a guest actually presses.
    const { route, refunds } = load(CANCEL_ROUTE, {
        policy: 'Moderate', daysAway: 10,
        amountPaid: 300, totalPrice: 300, cleaningFee: 0,
        balanceIntentId: 'pi_balance',
        charges: { pi_1: 7500, pi_balance: 22500 },
    });
    const res = await route.POST(post('http://x/api/bookings/cancel', { bookingId: 'b-1' }));

    assert.equal(res.body.ok, true, 'this used to refuse and leave the stay standing');
    assert.equal(poundsRefunded(refunds), 300);
    assert.equal(refunds.length, 2, 'the £75 deposit, then £225 of the balance');
    assert.equal(refunds[0].amount, 7500);
    assert.equal(refunds[1].amount, 22500);
    assert.equal(res.body.refunded, 300);
});
