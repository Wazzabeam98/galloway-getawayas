// Scenarios 12-18 from PAYMENT-SCENARIOS.md — the refunds.
//
//   node scripts/seed-payments.mjs && node scripts/refund-scenarios.mjs
//
// Driven through the real routes over HTTP with real test-mode Stripe behind
// them, checking afterwards that the refund at Stripe, the booking row and the
// payments row all agree.

import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    readManifest, round2, signIn, SEED_DOMAIN,
} from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);
const manifest = readManifest();
const SITE = process.env.SITE_URL || 'http://localhost:3000';

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
const profileOf = async (id) => (await db.select('profiles', '?select=*&id=eq.' + id))[0];
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

// What the host's browser does after the refund route returns. The route only
// moves money; BookingActions.tsx sets the status afterwards.
async function setStatus(id, status) {
    await db.update('bookings', '?id=eq.' + id, { status });
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

// The check PAYMENT-SCENARIOS.md asks for on every scenario: does the database
// agree with Stripe afterwards?
async function assertAgreesWithStripe(bookingId) {
    const b = await booking(bookingId);
    const atStripe = await refundedAtStripe(bookingId);
    check('the database and Stripe agree on what was refunded',
        round2(Number(b.amount_refunded)) === atStripe,
        'db £' + b.amount_refunded + ' vs Stripe £' + atStripe);
}

async function runPayouts() {
    const res = await fetch(SITE + '/api/cron/host-payouts', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    });
    const body = await res.json();
    console.log('   payout run → ' + res.status + ' ' + JSON.stringify(body));
    return body;
}

/* ------------------------------------------------------------- scenarios */

async function main() {
    console.log('site:    ' + SITE);
    console.log('project: ' + manifest.project);

    const { bookings, users } = manifest;
    const host = await as('host-ready');
    const guest = await as('guest');

    /* ---- 12 ---- */

    scenario(12, 'Host declines a pending request — guest refunded in full');

    const before12 = await booking(bookings.s12);
    check('starts as a pending request that has been paid',
        before12.status === 'pending' && Number(before12.amount_paid) === 450,
        before12.status + '/' + before12.amount_paid);

    const owed12Before = round2(Number((await profileOf(users.hostReady)).payout_balance_owed));
    const res12 = await post('/api/stripe/refund', host, { bookingId: bookings.s12, reason: 'declined' });
    console.log('   refund → ' + res12.status + ' ' + JSON.stringify(res12.body).slice(0, 140));
    await setStatus(bookings.s12, 'declined');

    const after12 = await booking(bookings.s12);
    check('the whole £450 went back', round2(Number(after12.amount_refunded)) === 450,
        '£' + after12.amount_refunded);
    check('payment_status is refunded', after12.payment_status === 'refunded', after12.payment_status);
    check('a refund payment row was written',
        (await paymentsFor(bookings.s12)).some((p) => p.kind === 'refund' && round2(Number(p.amount)) === 450));

    const owed12After = round2(Number((await profileOf(users.hostReady)).payout_balance_owed));
    check('declining costs the host nothing — no 5% fee',
        owed12After === owed12Before, '£' + owed12Before + ' → £' + owed12After);
    check('no penalty row was written',
        !(await payoutsFor(bookings.s12)).some((r) => r.kind === 'penalty'));
    await assertAgreesWithStripe(bookings.s12);

    /* ---- 13 ---- */

    scenario(13, 'Host cancels a confirmed booking — full refund, 5% fee, dates released');

    const before13 = await booking(bookings.s13);
    const penalty = round2(Number(before13.total_price) * 0.05);
    const owed13Before = round2(Number((await profileOf(users.hostReady)).payout_balance_owed));

    const res13 = await post('/api/stripe/refund', host, { bookingId: bookings.s13, reason: 'cancelled' });
    console.log('   refund → ' + res13.status + ' ' + JSON.stringify(res13.body).slice(0, 140));
    await setStatus(bookings.s13, 'cancelled');

    const after13 = await booking(bookings.s13);
    check('the guest got everything back', round2(Number(after13.amount_refunded)) === 700,
        '£' + after13.amount_refunded);
    check('payment_status is refunded', after13.payment_status === 'refunded', after13.payment_status);

    const owed13After = round2(Number((await profileOf(users.hostReady)).payout_balance_owed));
    check('the 5% fee (£' + penalty + ') was recorded against the host',
        round2(owed13After - owed13Before) === penalty,
        '£' + owed13Before + ' → £' + owed13After);
    check('a penalty row was written',
        (await payoutsFor(bookings.s13)).some((r) => r.kind === 'penalty' && round2(Number(r.amount)) === -penalty));
    check('the dates are released — the booking is cancelled', after13.status === 'cancelled');
    await assertAgreesWithStripe(bookings.s13);

    /* ---- 14 ---- */

    scenario(14, 'Host gives partial goodwill money back — stay stands, host still paid the rest');

    const before14 = await booking(bookings.s14);
    const GOODWILL = 60;
    const res14 = await post('/api/bookings/host-refund', host,
        { bookingId: bookings.s14, amount: GOODWILL });
    console.log('   refund → ' + res14.status + ' ' + JSON.stringify(res14.body).slice(0, 140));

    const after14 = await booking(bookings.s14);
    check('only the £' + GOODWILL + ' asked for went back',
        round2(Number(after14.amount_refunded)) === GOODWILL, '£' + after14.amount_refunded);
    check('the booking is still confirmed', after14.status === 'confirmed', after14.status);
    check('payment_status is partially_refunded',
        after14.payment_status === 'partially_refunded', after14.payment_status);
    await assertAgreesWithStripe(bookings.s14);

    // …and the host is still paid, on what is left after the goodwill.
    //
    // Scenario 13 left a £35 fee against this host, and the payout run takes it
    // off whichever due booking it happens to process first — which is not
    // necessarily this one. That interaction is scenario 24's job and passes
    // there. Clearing the debt here keeps this scenario about the one thing it
    // is meant to test: that the payout is worked out on what the guest was
    // left paying.
    await db.update('profiles', '?id=eq.' + users.hostReady, { payout_balance_owed: 0 });

    await runPayouts();

    const paid14 = await booking(bookings.s14);
    const kept14 = round2(Number(before14.amount_paid) - GOODWILL);
    const share14 = Math.round(kept14 * 0.9 * 100) / 100;

    check('the host was paid the remainder less commission: £' + share14,
        round2(Number(paid14.payout_amount)) === share14, '£' + paid14.payout_amount);
    check('the payout is on what was kept (£' + kept14 + '), not the original £'
        + before14.amount_paid,
        share14 !== Math.round(Number(before14.amount_paid) * 0.9 * 100) / 100);

    const transfer14 = paid14.payout_transfer_id
        ? await stripe.request('GET', '/transfers/' + paid14.payout_transfer_id).catch(() => null)
        : null;
    check('a real Stripe transfer went out for it', !!transfer14);
    if (transfer14) {
        check('Stripe and the database agree on the payout to the penny',
            transfer14.amount === Math.round(Number(paid14.payout_amount) * 100),
            'stripe ' + transfer14.amount + ' vs db ' + Math.round(Number(paid14.payout_amount) * 100));
    }

    /* ---- 15, 16, 17: the guest cancels, at three points in the tier ---- */

    const guestCancels = [
        { key: 's15', number: 15, title: 'Guest cancels inside the free window — full refund',
          policy: 'Flexible', paid: 300, expected: 300 },
        { key: 's16', number: 16, title: 'Guest cancels in the partial window — 50%',
          policy: 'Firm', paid: 500, expected: 250 },
        { key: 's17', number: 17, title: 'Guest cancels in the non-refundable window — nothing',
          policy: 'Firm', paid: 500, expected: 0 },
    ];

    for (const c of guestCancels) {
        scenario(c.number, c.title);

        const before = await booking(bookings[c.key]);
        const daysOut = Math.round(
            (new Date(before.check_in).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
        );
        console.log('   ' + c.policy + ', ' + daysOut + ' days before check-in, £' + before.amount_paid + ' paid');

        const res = await post('/api/bookings/cancel', guest, { bookingId: bookings[c.key] });
        console.log('   cancel → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 140));
        check('the cancellation was accepted', res.status === 200 && res.body.ok === true,
            JSON.stringify(res.body).slice(0, 140));

        const after = await booking(bookings[c.key]);
        check('£' + c.expected + ' came back', round2(Number(after.amount_refunded)) === c.expected,
            '£' + after.amount_refunded);
        check('the booking is cancelled', after.status === 'cancelled', after.status);
        check('no balance is left owing', round2(Number(after.balance_amount || 0)) === 0,
            String(after.balance_amount));
        await assertAgreesWithStripe(bookings[c.key]);
    }

    /* ---- 18 ---- */

    scenario(18, 'Guest cancels a deposit-only booking — they get back what they paid');

    const before18 = await booking(bookings.s18);
    console.log('   headline £' + before18.total_price + ', actually paid £' + before18.amount_paid);
    check('only the deposit has been taken',
        round2(Number(before18.amount_paid)) === 200 && round2(Number(before18.total_price)) === 800);

    const res18 = await post('/api/bookings/cancel', guest, { bookingId: bookings.s18 });
    console.log('   cancel → ' + res18.status + ' ' + JSON.stringify(res18.body).slice(0, 140));

    const after18 = await booking(bookings.s18);
    check('they got their £200 deposit back, not £800',
        round2(Number(after18.amount_refunded)) === 200, '£' + after18.amount_refunded);
    check('payment_status is refunded, because they got back all they paid',
        after18.payment_status === 'refunded', after18.payment_status);
    check('the outstanding balance was cleared so the balance charge cannot fire',
        round2(Number(after18.balance_amount || 0)) === 0, String(after18.balance_amount));
    await assertAgreesWithStripe(bookings.s18);

    /* ------------------------------------------------------------ summary */

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    for (const r of results) {
        console.log(String(r.number).padStart(2) + '. ' + r.status.toUpperCase().padEnd(10)
            + r.title.slice(0, 58));
        for (const c of r.checks.filter((x) => !x.ok)) {
            console.log('      ✗ ' + c.description + (c.detail ? '  — ' + c.detail : ''));
        }
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    console.log('\n' + results.length + ' scenarios, ' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('\nrunner crashed:', err.stack || err.message);
    process.exit(2);
});
