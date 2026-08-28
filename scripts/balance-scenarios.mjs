// Scenarios 3 and 7-11 from PAYMENT-SCENARIOS.md — the automatic balance
// charge and its failure ladder.
//
//   node scripts/seed-payments.mjs && node scripts/balance-scenarios.mjs
//
// The cron takes one attempt per booking per day, so between ladder steps this
// winds `balance_last_attempt_at` back a day. That is the only thing faked;
// the charges, declines and refunds are all real test-mode Stripe.

import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    readManifest, round2,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);
const manifest = readManifest();
// Checked before anything is written: never production, never the production
// database, never a build behind master. See scripts/target.mjs.
const SITE = await resolveTarget({
    runner: 'scripts/balance-scenarios.mjs',
    envNames: ['SITE_URL'],
    fallback: LOCAL_URL,
});

const results = [];
let current = null;

function scenario(number, title) {
    current = { number, title, checks: [], status: 'passed', notes: [] };
    results.push(current);
    console.log('\n── ' + number + '. ' + title);
}

function check(description, condition, detail) {
    const ok = !!condition;
    current.checks.push({ description, ok, detail });
    if (!ok) current.status = 'failed';
    console.log('   ' + (ok ? '✓' : '✗') + ' ' + description + (detail && !ok ? '  — ' + detail : ''));
}

function note(text) {
    current.notes.push(text);
    console.log('   ! ' + text);
}

/* --------------------------------------------------------------- helpers */

const booking = async (id) => (await db.select('bookings', '?select=*&id=eq.' + id))[0];
const paymentsFor = async (id) =>
    db.select('payments', '?select=*&booking_id=eq.' + id + '&order=created_at.asc');

async function runBalanceCharges() {
    const res = await fetch(SITE + '/api/cron/balance-charges', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    });
    const body = await res.json();
    console.log('   balance run → ' + res.status + ' ' + JSON.stringify(body));
    return body;
}

// The job allows one attempt per booking per day. Winding the clock back on
// the last attempt is what makes tomorrow's run happen today.
async function aDayPasses(id) {
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await db.update('bookings', '?id=eq.' + id, { balance_last_attempt_at: yesterday });
}

/* ------------------------------------------------------------- scenarios */

async function main() {
    console.log('site:    ' + SITE);
    console.log('project: ' + manifest.project);

    const { bookings } = manifest;

    // Captured before anything runs — the first balance run touches every due
    // booking, not just scenario 11's.
    const startState = {
        s03: await booking(bookings.s03),
        s07: await booking(bookings.s07),
        s11: await booking(bookings.s11),
    };

    /* ---- 11 first: the card wants the guest to authenticate ---- */

    scenario(11, 'Card requires authentication when charged off-session');

    const before11 = startState.s11;
    check('starts deposit-paid with £600 outstanding',
        before11.payment_status === 'deposit_paid' && round2(Number(before11.balance_amount)) === 600,
        before11.payment_status + '/' + before11.balance_amount);

    await runBalanceCharges();

    const after11 = await booking(bookings.s11);
    const rows11 = await paymentsFor(bookings.s11);
    const failure11 = rows11.filter((p) => p.status === 'failed').pop();

    check('the charge did not go through', round2(Number(after11.balance_amount)) === 600,
        '£' + after11.balance_amount + ' outstanding');
    check('the booking was left alone — not cancelled', after11.status === 'confirmed', after11.status);
    check('it counted as one attempt', Number(after11.balance_attempts) === 1,
        String(after11.balance_attempts));
    check('a failed payment row was recorded', !!failure11);

    if (failure11) {
        console.log('   recorded reason: "' + failure11.failure_reason + '"');

        // This is the whole point of the scenario. The guest's card is fine —
        // their bank wants them to confirm the payment — but the record and the
        // email both call it a decline.
        // Stripe's own message for this opens with 'Your card was declined',
        // so anyone reading the payments table saw a decline that wasn't one.
        check('the record does not call it a decline',
            !/declined/i.test(String(failure11.failure_reason || '')),
            '"' + failure11.failure_reason + '"');
        check('the record says the guest has to authenticate it',
            /authenticat/i.test(String(failure11.failure_reason || '')),
            '"' + failure11.failure_reason + '"');
    }

    check('the payment intent Stripe created was kept against the booking',
        !!after11.balance_payment_intent_id,
        'nothing recorded, so there is no trail from the booking to the attempt');

    /* ---- 11b: the week a bank-authentication case gets ---- */

    scenario('11b', 'A booking waiting on the guest’s bank gets a week, not 72 hours');

    // Three more runs. On a declined card the fourth would cancel the booking.
    for (let i = 0; i < 3; i++) {
        await aDayPasses(bookings.s11);
        await runBalanceCharges();
    }

    const day4 = await booking(bookings.s11);
    check('four failed attempts, and the booking is still alive',
        Number(day4.balance_attempts) === 4 && day4.status === 'confirmed',
        day4.balance_attempts + ' attempts, status ' + day4.status);
    check('the balance is still outstanding, so it is still being chased',
        round2(Number(day4.balance_amount)) === 600);

    // Jump to the end of the week rather than running three more days of cron.
    await db.update('bookings', '?id=eq.' + bookings.s11, { balance_attempts: 7 });
    await aDayPasses(bookings.s11);
    const run11b = await runBalanceCharges();

    const day8 = await booking(bookings.s11);
    check('after a week it is cancelled', day8.status === 'cancelled', day8.status);
    check('the run reported the cancellation', Number(run11b.cancelled) >= 1, JSON.stringify(run11b));
    check('the deposit came back', round2(Number(day8.amount_refunded)) === 200,
        '£' + day8.amount_refunded);

    /* ---- 3: the happy path ---- */

    scenario(3, 'Balance charged automatically against the saved card');

    const before3 = startState.s03;
    check('started deposit-paid with £600 outstanding',
        before3.payment_status === 'deposit_paid' && round2(Number(before3.balance_amount)) === 600,
        before3.payment_status + '/' + before3.balance_amount);

    const after3 = await booking(bookings.s03);
    check('the balance was taken', round2(Number(after3.balance_amount)) === 0,
        '£' + after3.balance_amount + ' still outstanding');
    check('payment_status is paid', after3.payment_status === 'paid', after3.payment_status);
    check('amount_paid is the deposit plus the balance',
        round2(Number(after3.amount_paid)) === 800, '£' + after3.amount_paid);
    check('a succeeded balance payment row was written',
        (await paymentsFor(bookings.s03)).some((p) => p.kind === 'balance' && p.status === 'succeeded'));

    const intent3 = after3.balance_payment_intent_id
        ? await stripe.request('GET', '/payment_intents/' + after3.balance_payment_intent_id).catch(() => null)
        : null;
    check('Stripe agrees the £600 was taken',
        !!intent3 && intent3.status === 'succeeded' && intent3.amount === 60000,
        intent3 ? intent3.status + '/' + intent3.amount : 'no intent recorded');

    /* ---- 7, 8, 9: the ladder ---- */

    const ladder = [
        { number: 8, attempt: 2, hours: 48 },
        { number: 9, attempt: 3, hours: 24 },
    ];

    scenario(7, 'First balance attempt fails — guest told, 72 hours given, booking untouched');

    const after7 = await booking(bookings.s07);
    check('one attempt has been counted', Number(after7.balance_attempts) === 1,
        String(after7.balance_attempts));
    check('the booking is untouched', after7.status === 'confirmed'
        && after7.payment_status === 'deposit_paid',
        after7.status + '/' + after7.payment_status);
    check('the balance is still outstanding', round2(Number(after7.balance_amount)) === 600);
    check('the failure was recorded against the booking',
        (await paymentsFor(bookings.s07)).some((p) => p.kind === 'balance' && p.status === 'failed'));

    for (const step of ladder) {
        scenario(step.number, 'Attempt ' + step.attempt + ' fails — ' + step.hours + ' hours');

        await aDayPasses(bookings.s07);
        await runBalanceCharges();

        const b = await booking(bookings.s07);
        check('attempt ' + step.attempt + ' was counted',
            Number(b.balance_attempts) === step.attempt, String(b.balance_attempts));
        check('the booking is still alive', b.status === 'confirmed', b.status);
        check('the balance is still outstanding', round2(Number(b.balance_amount)) === 600);
        check('there are now ' + step.attempt + ' recorded failures',
            (await paymentsFor(bookings.s07)).filter((p) => p.status === 'failed').length === step.attempt);
    }

    /* ---- 10: the fourth run gives up ---- */

    scenario(10, 'Fourth run cancels the booking and refunds per the tier in force');

    const before10 = await booking(bookings.s07);
    const paidBefore = round2(Number(before10.amount_paid));
    console.log('   £' + paidBefore + ' paid, check-in ' + before10.check_in + ', Moderate policy');

    await aDayPasses(bookings.s07);
    const run10 = await runBalanceCharges();

    const after10 = await booking(bookings.s07);
    check('the run reported a cancellation', Number(run10.cancelled) === 1, JSON.stringify(run10));
    check('the booking is cancelled', after10.status === 'cancelled', after10.status);
    check('nothing is left owing so it cannot be retried',
        round2(Number(after10.balance_amount)) === 0, String(after10.balance_amount));

    // Check-in is 30 days out on a Moderate policy, which is a full refund of
    // what they actually paid — the deposit, not the headline price.
    check('the deposit came back in full (£' + paidBefore + ')',
        round2(Number(after10.amount_refunded)) === paidBefore, '£' + after10.amount_refunded);
    check('payment_status is refunded', after10.payment_status === 'refunded', after10.payment_status);
    check('they were not refunded the £800 headline price',
        round2(Number(after10.amount_refunded)) !== 800, '£' + after10.amount_refunded);

    const refunds10 = await stripe.request('GET', '/refunds', {
        payment_intent: after10.stripe_payment_intent_id, limit: 100,
    });
    const atStripe10 = round2(
        (refunds10.data || []).reduce((sum, r) => sum + r.amount, 0) / 100
    );
    check('the database and Stripe agree on the refund',
        atStripe10 === round2(Number(after10.amount_refunded)),
        'db £' + after10.amount_refunded + ' vs Stripe £' + atStripe10);

    /* ------------------------------------------------------------ summary */

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    for (const r of results) {
        console.log(String(r.number).padStart(2) + '. ' + r.status.toUpperCase().padEnd(9)
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
