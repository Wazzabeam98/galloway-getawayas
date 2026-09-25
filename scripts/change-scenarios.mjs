// Reservation-change money, end to end against real test-mode Stripe.
//
//   node scripts/seed-payments.mjs && node scripts/change-scenarios.mjs
//
// The "Change reservation" path re-prices a stay as a DIFF (lib/changeMoney):
// added nights at today's rate, removed nights credited at what was paid, netted
// against each other. A NET LOSS of nights is a partial cancellation and follows
// the booking's cancellation policy (lib/quoteChange); a move, or a host-proposed
// shortening, settles in full. These scenarios drive the real routes over HTTP
// with real test Stripe behind them and check that the refund at Stripe, the
// booking row, the balance and the host's payout all agree afterwards.
//
//   cg1  guest shortens a DEPOSIT booking      → balance drops, no card refund
//   cg2  guest shortens a paid stay, free window → dropped night back in full
//   cg3  guest shortens a paid stay, Firm partial → 50% back, penalty retained
//   cg4  guest shortens a paid stay, Firm none    → nothing back, no money moves
//   ch1  HOST shortens a stay already paid out     → full refund + host clawback
//   cm1  guest MOVE onto pricier nights (paid)     → charges the difference, no
//                                                    penalty (no net loss)

import crypto from 'node:crypto';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    readManifest, round2, signIn, SEED_DOMAIN,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';
import { writeRunnerResults } from './scenario-report.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);
const manifest = readManifest();
const SITE = await resolveTarget({
    runner: 'scripts/change-scenarios.mjs',
    envNames: ['SITE_URL'],
    fallback: LOCAL_URL,
});

const results = [];
let current = null;

function scenario(number, title) {
    current = { number, title, checks: [], status: 'passed', note: null };
    results.push(current);
    console.log('\n── ' + number + '. ' + title);
}

function check(description, condition, detail) {
    const ok = !!condition;
    current.checks.push({ description, ok, detail });
    if (!ok) current.status = 'failed';
    console.log('   ' + (ok ? '✓' : '✗') + ' ' + description + (detail && !ok ? '  — ' + detail : ''));
}

/* --------------------------------------------------------------- helpers */

const booking = async (id) => (await db.select('bookings', '?select=*&id=eq.' + id))[0];
const paymentsFor = async (id) =>
    db.select('payments', '?select=*&booking_id=eq.' + id + '&order=created_at.asc');
const payoutsFor = async (id) =>
    db.select('payouts', '?select=*&booking_id=eq.' + id + '&order=created_at.asc');

async function as(label) {
    const { cookie } = await signIn(env, label + '@' + SEED_DOMAIN, 'seed-password-' + label);
    return cookie;
}

async function post(path, cookie, body) {
    const res = await fetch(SITE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
}

// Everything Stripe actually gave back on this booking's charge.
async function refundedAtStripe(bookingId) {
    const b = await booking(bookingId);
    if (!b.stripe_payment_intent_id) return 0;
    const list = await stripe.request('GET', '/refunds', {
        payment_intent: b.stripe_payment_intent_id, limit: 100,
    });
    const pence = (list.data || [])
        .filter((r) => r.status === 'succeeded' || r.status === 'pending')
        .reduce((sum, r) => sum + r.amount, 0);
    return round2(pence / 100);
}

async function assertAgreesWithStripe(bookingId) {
    const b = await booking(bookingId);
    const atStripe = await refundedAtStripe(bookingId);
    check('the database and Stripe agree on what was refunded',
        round2(Number(b.amount_refunded)) === atStripe,
        'db £' + b.amount_refunded + ' vs Stripe £' + atStripe);
}

// Propose a change (dates/guests) as `who`, then have the counterparty accept it.
// Returns the create and respond responses.
async function proposeAndAccept(who, other, bookingId, next) {
    const created = await post('/api/bookings/change', who, { bookingId, ...next });
    if (created.status !== 200 || !created.body.ok) return { created, accepted: null };
    const accepted = await post('/api/bookings/change/respond', other, { changeId: created.body.id, action: 'accept' });
    return { created, accepted };
}

// Sign a payload the way Stripe does, so the webhook route accepts it.
function signedWebhook(payload) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
        .createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
        .update(timestamp + '.' + body)
        .digest('hex');
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + timestamp + ',v1=' + signature },
        body,
    };
}

// A real test-mode charge for the extra a change costs, then the Stripe webhook
// event that lands it — the money-has-arrived signal that rewrites the stay.
async function payChangeIncrease(changeId, bookingId, pounds) {
    const intent = await stripe.request('POST', '/payment_intents', {
        amount: Math.round(pounds * 100), currency: 'gbp',
        payment_method: 'pm_card_visa', payment_method_types: ['card'], confirm: 'true',
        description: 'gg change scenario: ' + changeId,
        metadata: { kind: 'booking_change', change_id: changeId, booking_id: bookingId },
    });
    if (intent.status !== 'succeeded') throw new Error('change PI ended ' + intent.status);
    const event = {
        id: 'evt_change_' + changeId,
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_change_' + changeId,
                mode: 'payment',
                payment_intent: intent.id,
                metadata: { kind: 'booking_change', change_id: changeId, booking_id: bookingId },
            },
        },
    };
    const res = await fetch(SITE + '/api/stripe/webhook', signedWebhook(event));
    return { intent, webhookStatus: res.status };
}

async function runPayouts() {
    const res = await fetch(SITE + '/api/cron/host-payouts', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    });
    const body = await res.json().catch(() => ({}));
    console.log('   payout run → ' + res.status + ' ' + JSON.stringify(body).slice(0, 120));
    return body;
}

/* ------------------------------------------------------------- scenarios */

async function main() {
    console.log('site:    ' + SITE);
    console.log('project: ' + manifest.project);

    const { bookings } = manifest;
    const host = await as('host-ready');
    const guest = await as('guest');

    // A dropped night runs from the day after the new checkout to the old one;
    // these helpers build the change bodies the form would send.
    const shorten = (b, byNights) => {
        const co = new Date(b.check_out); co.setDate(co.getDate() - byNights);
        return { checkIn: String(b.check_in).slice(0, 10), checkOut: co.toISOString().slice(0, 10), guests: b.guests, children: b.children || 0, pets: b.pets || 0 };
    };

    /* ---- cg1 ---- */

    scenario('cg1', 'Guest shortens a deposit booking — balance drops, no card refund');

    const before1 = await booking(bookings.cg1);
    check('starts as a deposit booking: £200 of £800 paid',
        round2(Number(before1.amount_paid)) === 200 && round2(Number(before1.total_price)) === 800,
        '£' + before1.amount_paid + ' of £' + before1.total_price);
    check('the balance owed is £600 before the change',
        round2(Number(before1.balance_amount)) === 600, '£' + before1.balance_amount);

    const r1 = await proposeAndAccept(guest, host, bookings.cg1, shorten(before1, 2));
    check('the change was proposed and accepted',
        r1.accepted && r1.accepted.status === 200 && r1.accepted.body.ok, JSON.stringify(r1.accepted && r1.accepted.body).slice(0, 120));

    const after1 = await booking(bookings.cg1);
    check('the new total is £600 (two £100 nights dropped, free window)',
        round2(Number(after1.total_price)) === 600, '£' + after1.total_price);
    check('nothing was refunded to the card — the deposit is still below the total',
        round2(Number(after1.amount_refunded)) === 0, '£' + after1.amount_refunded);
    check('the balance owed dropped from £600 to £400',
        round2(Number(after1.balance_amount)) === 400, '£' + after1.balance_amount);
    check('no refund row was written',
        !(await paymentsFor(bookings.cg1)).some((p) => p.kind === 'refund'));
    await assertAgreesWithStripe(bookings.cg1);

    /* ---- cg2 ---- */

    scenario('cg2', 'Guest shortens a fully-paid stay INSIDE the free window — full refund');

    const before2 = await booking(bookings.cg2);
    check('starts fully paid at £500', round2(Number(before2.amount_paid)) === 500 && round2(Number(before2.total_price)) === 500);

    const r2 = await proposeAndAccept(guest, host, bookings.cg2, shorten(before2, 1));
    check('accepted', r2.accepted && r2.accepted.body.ok, JSON.stringify(r2.accepted && r2.accepted.body).slice(0, 120));
    check('the route reports £100 refunded', r2.accepted && round2(Number(r2.accepted.body.refunded)) === 100,
        '£' + (r2.accepted && r2.accepted.body.refunded));

    const after2 = await booking(bookings.cg2);
    check('the whole dropped night (£100) came back', round2(Number(after2.amount_refunded)) === 100, '£' + after2.amount_refunded);
    check('the new total is £400', round2(Number(after2.total_price)) === 400, '£' + after2.total_price);
    check('no balance is left owing', round2(Number(after2.balance_amount || 0)) === 0, String(after2.balance_amount));
    await assertAgreesWithStripe(bookings.cg2);

    /* ---- cg3 ---- */

    scenario('cg3', 'Guest shortens a fully-paid stay OUTSIDE the free window (Firm) — 50% back');

    const before3 = await booking(bookings.cg3);
    // The form shows the warning before they send it.
    const quote3 = await post('/api/bookings/change/quote', guest, { bookingId: bookings.cg3, ...shorten(before3, 1) });
    check('the quote warns the guest they only get 50% back',
        typeof quote3.body.notice === 'string' && /50% back/.test(quote3.body.notice), quote3.body.notice);

    const r3 = await proposeAndAccept(guest, host, bookings.cg3, shorten(before3, 1));
    check('accepted', r3.accepted && r3.accepted.body.ok, JSON.stringify(r3.accepted && r3.accepted.body).slice(0, 120));
    check('the route reports £50 refunded — half the dropped night',
        r3.accepted && round2(Number(r3.accepted.body.refunded)) === 50, '£' + (r3.accepted && r3.accepted.body.refunded));

    const after3 = await booking(bookings.cg3);
    check('£50 came back, not the whole £100', round2(Number(after3.amount_refunded)) === 50, '£' + after3.amount_refunded);
    check('the booking total settles at £450 — the £50 penalty is retained',
        round2(Number(after3.total_price)) === 450, '£' + after3.total_price);
    await assertAgreesWithStripe(bookings.cg3);

    /* ---- cg4 ---- */

    scenario('cg4', 'Guest shortens a fully-paid stay in the NON-REFUNDABLE window (Firm) — nothing back');

    const before4 = await booking(bookings.cg4);
    const quote4 = await post('/api/bookings/change/quote', guest, { bookingId: bookings.cg4, ...shorten(before4, 1) });
    check('the quote warns the guest they get no refund',
        typeof quote4.body.notice === 'string' && /won’t get a refund/.test(quote4.body.notice), quote4.body.notice);
    check('the quote nets to zero — the dropped night forfeits, no money moves',
        round2(Number(quote4.body.delta)) === 0, 'delta £' + quote4.body.delta);

    // Nets to £0, so a guest change applies straight away (no host step) — the
    // dropped night forfeits rather than being credited.
    const r4 = await post('/api/bookings/change', guest, { bookingId: bookings.cg4, ...shorten(before4, 1) });
    check('the change applied instantly (nets to £0, nothing to approve)',
        r4.status === 200 && r4.body.ok && r4.body.applied === true, JSON.stringify(r4.body).slice(0, 120));

    const after4 = await booking(bookings.cg4);
    check('nothing was refunded', round2(Number(after4.amount_refunded)) === 0, '£' + after4.amount_refunded);
    check('the total is unchanged at £300 (forfeited, not credited)', round2(Number(after4.total_price)) === 300, '£' + after4.total_price);
    check('the stay is shortened all the same', String(after4.check_out).slice(0, 10) < String(before4.check_out).slice(0, 10),
        before4.check_out + ' → ' + after4.check_out);
    await assertAgreesWithStripe(bookings.cg4);

    /* ---- ch1 ---- */

    scenario('ch1', 'Host shortens a stay already paid out — full refund and host clawback');

    // Pay the host out first, so the shortening's refund has to be clawed back.
    await runPayouts();
    const paid = await booking(bookings.ch1);
    check('the stay was paid out (a real transfer exists)',
        !!paid.payout_transfer_id && round2(Number(paid.payout_amount)) === 450,
        'transfer=' + paid.payout_transfer_id + ' £' + paid.payout_amount);

    // Host proposes dropping two nights; the guest accepts.
    const r5 = await proposeAndAccept(host, guest, bookings.ch1, shorten(paid, 2));
    check('accepted', r5.accepted && r5.accepted.body.ok, JSON.stringify(r5.accepted && r5.accepted.body).slice(0, 120));
    check('the route refunds the two dropped nights in FULL (£200) — host-proposed',
        r5.accepted && round2(Number(r5.accepted.body.refunded)) === 200, '£' + (r5.accepted && r5.accepted.body.refunded));

    const after5 = await booking(bookings.ch1);
    check('£200 went back to the guest', round2(Number(after5.amount_refunded)) === 200, '£' + after5.amount_refunded);
    check('the new total is £300', round2(Number(after5.total_price)) === 300, '£' + after5.total_price);
    await assertAgreesWithStripe(bookings.ch1);

    const reversal = (await payoutsFor(bookings.ch1)).find((r) => r.kind === 'reversal' && r.status === 'succeeded');
    check('a clawback reversal row was written for £200', reversal && round2(Number(reversal.amount)) === -200,
        reversal ? '£' + reversal.amount : 'no reversal row');
    const transfer = paid.payout_transfer_id
        ? await stripe.request('GET', '/transfers/' + paid.payout_transfer_id).catch(() => null)
        : null;
    check('Stripe shows £200 reversed on the payout transfer',
        transfer && transfer.amount_reversed === 20000, transfer ? 'reversed ' + transfer.amount_reversed : 'no transfer');

    /* ---- cm1 ---- */

    scenario('cm1', 'Guest MOVES onto pricier nights — charges the difference, no penalty');

    const before6 = await booking(bookings.cm1);
    // Move the whole 3-night stay onto the £180 nights (dayOffset 50–52).
    const move = (() => {
        const ci = new Date(); ci.setDate(ci.getDate() + 50);
        const co = new Date(); co.setDate(co.getDate() + 53);
        return { checkIn: ci.toISOString().slice(0, 10), checkOut: co.toISOString().slice(0, 10), guests: before6.guests, children: before6.children || 0, pets: before6.pets || 0 };
    })();

    // A move is a charge, so the host proposes and the guest pays. Quote first:
    const quote6 = await post('/api/bookings/change/quote', guest, { bookingId: bookings.cm1, ...move });
    check('the quote charges the £240 difference (3 × £180 − 3 × £100), no penalty',
        round2(Number(quote6.body.delta)) === 240, 'delta £' + quote6.body.delta);
    check('a move onto pricier nights carries NO cancellation warning',
        !quote6.body.notice, String(quote6.body.notice));

    const created6 = await post('/api/bookings/change', host, { bookingId: bookings.cm1, ...move });
    check('the host proposed the move, frozen at +£240',
        created6.body.ok && round2(Number(created6.body.delta)) === 240, JSON.stringify(created6.body).slice(0, 120));

    // The guest pays the extra: a real test charge, landed by the webhook.
    const payment6 = await payChangeIncrease(created6.body.id, bookings.cm1, 240);
    check('the change payment succeeded and the webhook accepted it',
        payment6.webhookStatus === 200, 'webhook ' + payment6.webhookStatus);

    const after6 = await booking(bookings.cm1);
    check('the stay moved onto the new dates', String(after6.check_in).slice(0, 10) === move.checkIn && String(after6.check_out).slice(0, 10) === move.checkOut,
        after6.check_in + ' → ' + after6.check_out);
    check('the new total is £540', round2(Number(after6.total_price)) === 540, '£' + after6.total_price);
    check('the guest has now paid £540 in all', round2(Number(after6.amount_paid)) === 540, '£' + after6.amount_paid);
    check('nothing is left owing', round2(Number(after6.balance_amount || 0)) === 0, String(after6.balance_amount));
    check('a booking_change payment row of £240 was written',
        (await paymentsFor(bookings.cm1)).some((p) => p.kind === 'booking_change' && round2(Number(p.amount)) === 240));

    /* ------------------------------------------------------------ summary */

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    for (const r of results) {
        console.log(String(r.number).padStart(3) + '. ' + r.status.toUpperCase().padEnd(10) + r.title.slice(0, 58));
        for (const c of r.checks.filter((x) => !x.ok)) {
            console.log('      ✗ ' + c.description + (c.detail ? '  — ' + c.detail : ''));
        }
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    console.log('\n' + results.length + ' scenarios, ' + (results.length - failed) + ' passed, ' + failed + ' failed');
    const recorded = writeRunnerResults('change', SITE, results);
    console.log('\nrecorded in SCENARIO-RESULTS.json  ('
        + recorded.passed + ' passed, ' + recorded.failed + ' failed, '
        + recorded.untestable + ' not testable here)');

    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('\nrunner crashed:', err.stack || err.message);
    process.exit(2);
});
