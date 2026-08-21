// Scenarios 19-24 from PAYMENT-SCENARIOS.md — the payouts.
//
//   node scripts/seed-payments.mjs && node scripts/payout-scenarios.mjs
//
// Drives the real routes over HTTP against a `next dev` on :3000, with the
// real test-mode Stripe behind them. Each scenario checks Stripe and the
// database agree afterwards, which is where the bugs in this project live.

import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    readManifest, round2, sleep, signIn, SEED_DOMAIN, dayOffset,
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

function untestable(reason) {
    current.status = 'untestable';
    current.note = reason;
    console.log('   – not testable here: ' + reason);
}

/* --------------------------------------------------------------- helpers */

async function runPayouts() {
    const res = await fetch(SITE + '/api/cron/host-payouts', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    });
    const body = await res.json();
    console.log('   payout run → ' + res.status + ' ' + JSON.stringify(body));
    return { status: res.status, body };
}

async function booking(id) {
    const [row] = await db.select('bookings', '?select=*&id=eq.' + id);
    return row;
}

async function profile(id) {
    const [row] = await db.select('profiles', '?select=*&id=eq.' + id);
    return row;
}

async function payoutsFor(bookingId) {
    return db.select('payouts', '?select=*&booking_id=eq.' + bookingId + '&order=created_at.asc');
}

async function connectedBalance(accountId) {
    const b = await stripe.request('GET', '/balance', null, { account: accountId });
    const avail = (b.available || []).find((x) => x.currency === 'gbp');
    const pending = (b.pending || []).find((x) => x.currency === 'gbp');
    return { available: (avail ? avail.amount : 0) / 100, pending: (pending ? pending.amount : 0) / 100 };
}

// Moves a connected account's available balance out to its bank, so a later
// reversal has nothing to pull back. This is what really happens to a host
// before a late refund lands.
async function drainToBank(accountId) {
    const { available } = await connectedBalance(accountId);
    if (available <= 0) return 0;
    await stripe.request('POST', '/payouts', {
        amount: Math.round(available * 100), currency: 'gbp',
    }, { account: accountId });
    return available;
}

// The route works out the amount itself from the booking and the cancellation
// policy — it takes no amount from the caller — so this refunds in full.
// Puts money into a connected account so a reversal has something to pull
// against. Used to set up a failure that is NOT a shortfall.
async function topUpConnected(accountId, pounds) {
    await stripe.request('POST', '/transfers', {
        amount: Math.round(pounds * 100), currency: 'gbp', destination: accountId,
        description: 'scenario setup',
    });
}

async function refundAsHost(bookingId, hostLabel, reason) {
    const { cookie } = await signIn(env, hostLabel + '@' + SEED_DOMAIN, 'seed-password-' + hostLabel);
    const res = await fetch(SITE + '/api/stripe/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ bookingId, reason }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

/* ------------------------------------------------------------- scenarios */

async function main() {
    console.log('site:    ' + SITE);
    console.log('project: ' + manifest.project);

    const { bookings, users, accounts } = manifest;

    /* ---- 20: the transfer runs, at the rate stamped on the booking ---- */

    scenario(20, 'Transfer runs the day after check-in, commission at the booking’s stamped rate');

    const before20 = await booking(bookings.s20);
    check('booking starts unpaid-out', before20.paid_out_at === null);
    check('booking rate (10%) differs from listing rate (25%), so the wrong one would show',
        Number(before20.commission_rate) === 10);

    const run1 = await runPayouts();
    check('the run reported success', run1.status === 200 && run1.body.ok === true,
        JSON.stringify(run1.body));

    const after20 = await booking(bookings.s20);
    const collected20 = round2(Number(before20.amount_paid) - Number(before20.amount_refunded));
    const expectedHostShare = round2(Math.round(collected20 * 0.9 * 100) / 100);
    const expectedCommission = round2(collected20 - expectedHostShare);

    check('booking is marked paid out', after20.paid_out_at !== null);
    check('payout amount is the host share at 10%, not 25%: expected £' + expectedHostShare,
        round2(Number(after20.payout_amount)) === expectedHostShare,
        'got £' + after20.payout_amount);
    check('host share + commission equals exactly what was collected (£' + collected20 + ')',
        round2(expectedHostShare + expectedCommission) === collected20,
        expectedHostShare + ' + ' + expectedCommission);

    const transfer20 = after20.payout_transfer_id
        ? await stripe.request('GET', '/transfers/' + after20.payout_transfer_id).catch(() => null)
        : null;
    check('a real Stripe transfer exists', !!transfer20, 'no transfer id on the booking');
    if (transfer20) {
        check('Stripe transfer amount matches the database to the penny',
            transfer20.amount === Math.round(Number(after20.payout_amount) * 100),
            'stripe ' + transfer20.amount + ' vs db ' + Math.round(Number(after20.payout_amount) * 100));
        check('transfer went to the right connected account',
            transfer20.destination === accounts.ready, transfer20.destination);
    }

    const rows20 = await payoutsFor(bookings.s20);
    check('exactly one payout row was written', rows20.length === 1, rows20.length + ' rows');

    /* ---- 21: host has not finished onboarding ---- */

    scenario(21, 'Host has not finished Stripe onboarding — skipped, not failed');

    const after21 = await booking(bookings.s21);
    check('booking was not paid out', after21.paid_out_at === null);
    check('the run counted it as skipped, not failed',
        run1.body.skipped >= 1 && run1.body.failed === 0, JSON.stringify(run1.body));
    check('no payout row was written for it', (await payoutsFor(bookings.s21)).length === 0);

    // …and is picked up on a later run once they finish.
    await db.update('profiles', '?id=eq.' + users.hostPending, {
        stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true,
        stripe_account_id: accounts.spare,
    });
    const run2 = await runPayouts();
    const after21b = await booking(bookings.s21);
    check('once onboarding finishes, a later run picks it up',
        after21b.paid_out_at !== null && run2.body.sent >= 1, JSON.stringify(run2.body));

    /* ---- 22: clawback succeeds from the host's Stripe balance ---- */

    scenario(22, 'Clawback succeeds from the host’s Stripe balance');

    const paid22 = await booking(bookings.s22);
    check('the booking was paid out first', paid22.paid_out_at !== null && !!paid22.payout_transfer_id,
        'payout_transfer_id=' + paid22.payout_transfer_id);

    const bal22 = await connectedBalance(accounts.indebted);
    console.log('   host balance before refund: £' + bal22.available + ' available, £' + bal22.pending + ' pending');

    const refund22 = await refundAsHost(bookings.s22, 'host-indebted', 'goodwill');
    console.log('   refund → ' + refund22.status + ' ' + JSON.stringify(refund22.body).slice(0, 200));
    check('the refund route succeeded', refund22.status === 200 && refund22.body.ok === true,
        JSON.stringify(refund22.body).slice(0, 200));

    const rows22 = await payoutsFor(bookings.s22);
    const reversal22 = rows22.find((r) => r.kind === 'reversal');
    check('a reversal row was written', !!reversal22);
    if (reversal22) {
        check('the reversal is recorded as succeeded, not owed',
            reversal22.status === 'succeeded', 'status=' + reversal22.status);
    }
    const host22 = await profile(users.hostIndebted);
    check('nothing was carried forward as owed',
        round2(Number(host22.payout_balance_owed)) === 0, '£' + host22.payout_balance_owed);

    /* ---- 23: clawback fails, shortfall carried forward ---- */

    scenario(23, 'Clawback fails on an empty balance — shortfall recorded on payout_balance_owed');

    const paid23 = await booking(bookings.s23);
    check('the booking was paid out first', paid23.paid_out_at !== null && !!paid23.payout_transfer_id);

    const drained = await drainToBank(accounts.indebted);
    console.log('   drained £' + drained + ' from the host\u2019s Stripe balance to their bank');
    const bal23 = await connectedBalance(accounts.indebted);
    check('the host\u2019s Stripe balance is empty before the refund', bal23.available <= 0,
        '£' + bal23.available + ' still available');

    const owedBefore = round2(Number((await profile(users.hostIndebted)).payout_balance_owed));
    const refund23 = await refundAsHost(bookings.s23, 'host-indebted', 'goodwill');
    console.log('   refund → ' + refund23.status + ' ' + JSON.stringify(refund23.body).slice(0, 160));
    check('the guest still got their refund', refund23.status === 200 && refund23.body.ok === true,
        JSON.stringify(refund23.body).slice(0, 160));

    const rows23 = await payoutsFor(bookings.s23);
    const balAfter23 = await connectedBalance(accounts.indebted);
    console.log('   host balance after the clawback: £' + balAfter23.available);

    check('the host’s connected account was NOT left negative', balAfter23.available >= 0,
        '£' + balAfter23.available + ' — Stripe would absorb this out of their next transfer, '
        + 'recovering the same money twice');

    check('a reversal row was written as owed',
        !!rows23.find((r) => r.kind === 'reversal' && r.status === 'owed'),
        'rows: ' + rows23.map((r) => r.kind + '/' + r.status).join(', '));

    const host23 = await profile(users.hostIndebted);
    const owedAfter = round2(Number(host23.payout_balance_owed));
    check('the shortfall was added to payout_balance_owed',
        owedAfter > owedBefore, '£' + owedBefore + ' → £' + owedAfter);
    check('the debt is exactly what the host could not fund (£' + paid23.payout_amount + ')',
        round2(owedAfter - owedBefore) === round2(Number(paid23.payout_amount)),
        'expected £' + paid23.payout_amount + ', got £' + round2(owedAfter - owedBefore));

    /* ---- 23b: a clawback failure that is NOT a shortfall ---- */

    scenario('23b', 'A clawback that fails for any other reason is not billed to the host');

    // The host must actually have the money, or the clawback correctly carries
    // it forward as a shortfall and never reaches Stripe at all. With funds
    // present it attempts the reversal — against a transfer already reversed in
    // full, which Stripe refuses for a reason that is not a shortfall.
    await topUpConnected(accounts.indebted, 500);
    console.log('   topped the host up to £500 so the reversal is actually attempted');

    // Scenario 22's transfer was reversed in full; scenario 23's never was,
    // because the host had nothing to reverse against.
    await db.update('bookings', '?id=eq.' + bookings.s23b, {
        payout_transfer_id: paid22.payout_transfer_id,
        payout_amount: 150,
        paid_out_at: new Date().toISOString(),
    });

    const owedBefore23b = round2(Number((await profile(users.hostIndebted)).payout_balance_owed));
    const refund23b = await refundAsHost(bookings.s23b, 'host-indebted', 'goodwill');
    console.log('   refund → ' + refund23b.status + ' ' + JSON.stringify(refund23b.body).slice(0, 160));
    check('the guest still got their refund', refund23b.status === 200 && refund23b.body.ok === true,
        JSON.stringify(refund23b.body).slice(0, 160));

    const rows23b = await payoutsFor(bookings.s23b);
    check('the failed reversal is recorded as failed, not owed',
        !!rows23b.find((r) => r.kind === 'reversal' && r.status === 'failed'),
        'rows: ' + rows23b.map((r) => r.kind + '/' + r.status).join(', '));

    const owedAfter23b = round2(Number((await profile(users.hostIndebted)).payout_balance_owed));
    check('the host was NOT charged a debt they do not owe',
        owedAfter23b === owedBefore23b, '£' + owedBefore23b + ' → £' + owedAfter23b);

    /* ---- 24: next payout smaller than the debt ---- */

    scenario(24, 'The next payout is smaller than the debt — withheld entirely, carried forward');

    // The debt is whatever scenario 23 left behind — no longer set by hand.
    const DEBT = round2(Number((await profile(users.hostIndebted)).payout_balance_owed));
    console.log('   carrying £' + DEBT + ' of debt from scenario 23');

    // Its own week — scenario 23's booking already has the days either side of
    // check-in, and two confirmed stays cannot overlap.
    await db.update('bookings', '?id=eq.' + bookings.s24, {
        check_in: dayOffset(-9), check_out: dayOffset(-8),
    });

    const b24 = await booking(bookings.s24);
    const collected24 = round2(Number(b24.amount_paid) - Number(b24.amount_refunded));
    const share24 = Math.round(collected24 * 0.9 * 100) / 100;
    console.log('   debt £' + DEBT + ' vs this payout\u2019s host share £' + share24);
    check('the debt really is larger than the payout', DEBT > share24,
        'debt £' + DEBT + ' share £' + share24);

    const run3 = await runPayouts();
    check('the run reported success', run3.status === 200 && run3.body.ok === true);

    const after24 = await booking(bookings.s24);
    check('the booking is closed off as paid out', after24.paid_out_at !== null);
    check('nothing was transferred', round2(Number(after24.payout_amount)) === 0,
        '£' + after24.payout_amount);
    check('no Stripe transfer id was recorded', !after24.payout_transfer_id,
        String(after24.payout_transfer_id));

    const rows24 = await payoutsFor(bookings.s24);
    check('a withheld payout row was written',
        !!rows24.find((r) => r.status === 'withheld'),
        'rows: ' + rows24.map((r) => r.kind + '/' + r.status).join(', '));

    const remaining = round2(Number((await profile(users.hostIndebted)).payout_balance_owed));
    check('the remaining debt is carried forward, reduced by exactly the withheld share',
        remaining === round2(DEBT - share24),
        'expected £' + round2(DEBT - share24) + ', got £' + remaining);

    /* ---- 19: umbrella — a refund after a payout claws back ---- */

    scenario(19, 'A refund issued after the host has been paid out triggers a clawback');
    check('clawback ran on a paid-out booking and recovered from Stripe (scenario 22)',
        results.find((r) => r.number === 22).status === 'passed');
    check('a clawback that could not run did not invent a debt (scenario 23b)',
        results.find((r) => r.number === '23b').status === 'passed');

    /* ------------------------------------------------------------ summary */

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    for (const r of results) {
        const failedChecks = r.checks.filter((c) => !c.ok);
        console.log(
            String(r.number).padStart(2) + '. ' + r.status.toUpperCase().padEnd(10) +
            r.title.slice(0, 60)
        );
        for (const c of failedChecks) console.log('      ✗ ' + c.description + (c.detail ? '  — ' + c.detail : ''));
        if (r.note) console.log('      – ' + r.note);
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    const untested = results.filter((r) => r.status === 'untestable').length;
    console.log(
        '\n' + results.length + ' scenarios, ' + (results.length - failed - untested) +
        ' passed, ' + failed + ' failed, ' + untested + ' not testable here'
    );
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('\nrunner crashed:', err.stack || err.message);
    process.exit(2);
});
