// Scenarios 25-29 from PAYMENT-SCENARIOS.md — the cross-cutting cases.
//
//   node scripts/seed-payments.mjs && node scripts/crosscutting-scenarios.mjs
//
// These are the races and the repeats: a price that moves under the guest, a
// calendar that fills up while they decide, two guests at once, the webhook
// arriving late, and anything being delivered or run twice.

import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    readManifest, round2, signIn, SEED_DOMAIN, dayOffset,
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
    runner: 'scripts/crosscutting-scenarios.mjs',
    envNames: ['SITE_URL'],
    fallback: LOCAL_URL,
});

const results = [];
let current = null;

function scenario(number, title) {
    current = { number, title, checks: [], status: 'passed' };
    results.push(current);
    console.log('\n── ' + number + '. ' + title);
}

function check(description, condition, detail) {
    const ok = !!condition;
    current.checks.push({ description, ok, detail });
    if (!ok) current.status = 'failed';
    console.log('   ' + (ok ? '✓' : '✗') + ' ' + description + (detail && !ok ? '  — ' + detail : ''));
}

const booking = async (id) => (await db.select('bookings', '?select=*&id=eq.' + id))[0];
const paymentsFor = async (id) => db.select('payments', '?select=*&booking_id=eq.' + id);
const payoutsFor = async (id) => db.select('payouts', '?select=*&booking_id=eq.' + id);

async function checkout(cookie, bookingId, plan) {
    const res = await fetch(SITE + '/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ bookingId, plan: plan || 'full' }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
    console.log('site:    ' + SITE);
    console.log('project: ' + manifest.project);

    const { bookings, listings, users } = manifest;
    const cookie = (await signIn(env, 'guest@' + SEED_DOMAIN, 'seed-password-guest')).cookie;

    /* ---- 25 ---- */

    scenario(25, 'The price changes between loading the page and pressing pay');

    const before25 = await booking(bookings.s25);
    check('the booking agrees with the listing to start with',
        round2(Number(before25.total_price)) === 300, '£' + before25.total_price);

    // The host puts the nightly rate up while the guest is deciding.
    await db.update('listings', '?id=eq.' + listings.price, { price_per_night: 140 });

    const res25 = await checkout(cookie, bookings.s25, 'full');
    console.log('   checkout → ' + res25.status + ' ' + JSON.stringify(res25.body).slice(0, 160));

    check('checkout was refused', res25.status === 409 && res25.body.ok === false);
    check('the guest is told the new price rather than charged either figure',
        /price for these dates has changed/i.test(String(res25.body.error || '')),
        String(res25.body.error));

    const after25 = await booking(bookings.s25);
    check('nothing was charged', round2(Number(after25.amount_paid)) === 0);
    check('no payment was recorded', (await paymentsFor(bookings.s25)).length === 0);
    check('the booking was corrected to the new total (£420), so a retry is honest',
        round2(Number(after25.total_price)) === 420, '£' + after25.total_price);

    // And once the guest reloads and accepts the new price, it goes through.
    const res25b = await checkout(cookie, bookings.s25, 'full');
    check('at the corrected price the same booking is accepted',
        res25b.status === 200 && !!res25b.body.url, JSON.stringify(res25b.body).slice(0, 120));

    /* ---- 26 ---- */

    scenario(26, 'Dates taken on Airbnb while the guest is deciding');

    const b26 = await booking(bookings.s26);

    // What the iCal sync would have cached a few hours ago.
    await db.insert('listing_ical_feeds', {
        listing_id: listings.ical,
        url: 'https://www.airbnb.co.uk/calendar/ical/seed.ics',
        label: 'Airbnb',
        last_synced_at: new Date().toISOString(),
        last_status: 'ok',
        events: [{ start: b26.check_in, end: b26.check_out, summary: 'Reserved' }],
    });

    const res26 = await checkout(cookie, bookings.s26, 'full');
    console.log('   checkout → ' + res26.status + ' ' + JSON.stringify(res26.body).slice(0, 160));

    check('checkout was refused', res26.status === 409 && res26.body.ok === false);
    check('the guest is told the dates have gone',
        /just been taken|just been booked/i.test(String(res26.body.error || '')),
        String(res26.body.error));

    const after26 = await booking(bookings.s26);
    check('nothing was charged', round2(Number(after26.amount_paid)) === 0);
    check('no payment was recorded', (await paymentsFor(bookings.s26)).length === 0);

    /* ---- 27 ---- */

    scenario(27, 'Two guests book the same dates at the same moment');

    const a = await booking(bookings.s27a);
    const b = await booking(bookings.s27b);
    check('both are for the same listing and the same nights',
        a.listing_id === b.listing_id && a.check_in === b.check_in, a.check_in + ' / ' + b.check_in);

    // Both press pay at once.
    const [r1, r2] = await Promise.all([
        checkout(cookie, bookings.s27a, 'full'),
        checkout(cookie, bookings.s27b, 'full'),
    ]);
    console.log('   guest A → ' + r1.status + '  guest B → ' + r2.status);

    const accepted = [r1, r2].filter((r) => r.status === 200).length;
    check('only one of them is allowed to pay', accepted === 1,
        accepted + ' of 2 were accepted — both can now pay for the same nights');

    const refused = [r1, r2].find((r) => r.status === 409);
    if (refused) {
        check('the one turned away is told to come back rather than that it is gone for good',
            /paying for those dates right now/i.test(String(refused.body.error || '')),
            String(refused.body.error));
    }

    // The hold must lapse, or a guest who wanders off blocks the dates for
    // ever — which is the thing scenario 5 exists to prevent.
    await db.update('bookings', '?id=eq.' + bookings.s27a, {
        created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    });
    const r3 = await checkout(cookie, bookings.s27b, 'full');
    check('once the first guest’s half hour is up, the dates come back',
        r3.status === 200 && !!r3.body.url, JSON.stringify(r3.body).slice(0, 140));

    /* ---- 27b: the database has the final say ---- */

    scenario('27b', 'A guest who pays for nights taken meanwhile is refunded and told');

    // The hold only covers half an hour. This is the guest who sat on the
    // Stripe page longer than that, and paid for nights someone else has since
    // been confirmed for.
    const held = await booking(bookings.s27a);
    await db.update('bookings', '?id=eq.' + bookings.s27a, { status: 'confirmed' });

    // A real payment for the overlapping stay.
    const intent = await stripe.request('POST', '/payment_intents', {
        amount: 30000, currency: 'gbp', payment_method: 'pm_card_visa',
        payment_method_types: ['card'], confirm: 'true',
        description: 'oversold test',
    });
    check('the guest really did pay', intent.status === 'succeeded', intent.status);

    const b27b = await booking(bookings.s27b);
    const event = {
        id: 'evt_oversold_' + Date.now(),
        type: 'checkout.session.completed',
        data: {
            object: {
                payment_status: 'paid',
                amount_total: 30000,
                payment_intent: intent.id,
                customer: null,
                client_reference_id: b27b.id,
                metadata: { booking_id: b27b.id, kind: 'full' },
            },
        },
    };

    const res27b = await fetch(SITE + '/api/stripe/webhook', await signedWebhook(event));
    const body27b = await res27b.json().catch(() => ({}));
    console.log('   webhook → ' + res27b.status + ' ' + JSON.stringify(body27b));

    check('the webhook saw it could not confirm and said so',
        body27b.oversold === true, JSON.stringify(body27b));

    const after27b = await booking(bookings.s27b);
    check('the guest was not given the nights', after27b.status !== 'confirmed', after27b.status);
    check('the booking is called off', after27b.status === 'cancelled', after27b.status);
    check('what they paid and what came back are both recorded',
        round2(Number(after27b.amount_paid)) === 300
            && round2(Number(after27b.amount_refunded)) === 300,
        'paid £' + after27b.amount_paid + ', refunded £' + after27b.amount_refunded);
    check('payment_status is refunded', after27b.payment_status === 'refunded', after27b.payment_status);

    const refunds27b = await stripe.request('GET', '/refunds', { payment_intent: intent.id, limit: 10 });
    const backAtStripe = round2(
        (refunds27b.data || []).reduce((sum, r) => sum + r.amount, 0) / 100
    );
    check('Stripe actually sent the money back, in full', backAtStripe === 300,
        '£' + backAtStripe);
    check('a refund row was written',
        (await paymentsFor(bookings.s27b)).some((p) => p.kind === 'refund'));

    // Redelivery must not refund twice.
    const replayEvent = { ...event, id: 'evt_oversold_replay_' + Date.now() };
    await fetch(SITE + '/api/stripe/webhook', await signedWebhook(replayEvent));
    const refundsAgain = await stripe.request('GET', '/refunds', { payment_intent: intent.id, limit: 10 });
    const totalAfterReplay = round2(
        (refundsAgain.data || []).reduce((sum, r) => sum + r.amount, 0) / 100
    );
    check('a redelivered event does not refund twice', totalAfterReplay === 300,
        '£' + totalAfterReplay);

    // And the stay that won is untouched.
    const winner = await booking(bookings.s27a);
    check('the guest who got there first still has their stay',
        winner.status === 'confirmed', winner.status);

    await db.update('bookings', '?id=eq.' + bookings.s27a, { status: held.status });

    /* ---- 28 ---- */

    scenario(28, 'The webhook arrives after the guest reaches the confirmation page');

    const page = async () => {
        const res = await fetch(SITE + '/booking-confirmed/' + bookings.s28);
        return { status: res.status, html: await res.text() };
    };

    // The guest is back from Stripe, the webhook has not landed yet.
    const waiting = await page();
    check('the page loads without a session', waiting.status === 200, String(waiting.status));
    check('it says the payment is being confirmed',
        /just confirming your payment/i.test(waiting.html));
    check('it does not tell them anything has gone wrong',
        !/failed|unsuccessful|not been paid|problem with your payment/i.test(waiting.html));
    check('it does not show the stay as cancelled or unconfirmed',
        !/cancelled/i.test(waiting.html));

    // The webhook lands.
    await db.update('bookings', '?id=eq.' + bookings.s28, {
        payment_status: 'paid', amount_paid: 300, balance_amount: 0,
        status: 'confirmed', paid_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
    });

    const settled = await page();
    check('the same page now shows the payment received',
        /payment received/i.test(settled.html));
    check('and the stay as confirmed', /your stay is confirmed/i.test(settled.html));

    /* ---- 29 ---- */

    scenario(29, 'A webhook delivered twice, or a scheduled job run twice');

    // A webhook replayed. The event id is the primary key on stripe_events.
    const events = await db.select('stripe_events', '?select=event_id,event_type,payload&order=received_at.desc&limit=1');
    if (!events.length) {
        check('there is a real webhook event to replay', false, 'none recorded yet');
    } else {
        const replay = events[0];
        const signed = await signedWebhook(replay.payload);
        const first = await fetch(SITE + '/api/stripe/webhook', signed);
        const body = await first.json().catch(() => ({}));
        console.log('   replayed ' + replay.event_type + ' → ' + first.status + ' ' + JSON.stringify(body));
        check('a repeat delivery is recognised and ignored',
            first.status === 200 && body.duplicate === true, JSON.stringify(body));
    }

    // A payout run repeated on the same day. Run it once so there is something
    // already paid out to run against.
    const payoutRun = () => fetch(SITE + '/api/cron/host-payouts', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    }).then((r) => r.json());

    const firstPayout = await payoutRun();
    console.log('   first payout run → ' + JSON.stringify(firstPayout));

    const paidOut = (await db.select(
        'bookings',
        '?select=id,payout_amount,payout_transfer_id&paid_out_at=not.is.null&limit=1'
    ))[0];

    if (paidOut) {
        const rowsBefore = (await payoutsFor(paidOut.id)).length;
        const secondPayout = await payoutRun();
        console.log('   second payout run → ' + JSON.stringify(secondPayout));
        const rowsAfter = (await payoutsFor(paidOut.id)).length;
        const still = await booking(paidOut.id);
        check('a second payout run does not pay an already-paid booking again',
            rowsAfter === rowsBefore
                && still.payout_transfer_id === paidOut.payout_transfer_id,
            rowsBefore + ' → ' + rowsAfter + ' payout rows');
    } else {
        check('there is a paid-out booking to re-run against', false, 'none found');
    }

    // A balance run repeated on the same day.
    const due = (await db.select(
        'bookings',
        '?select=id,balance_attempts&payment_status=eq.deposit_paid&balance_amount=gt.0&limit=1'
    ))[0];

    if (due) {
        const balanceRun = () => fetch(SITE + '/api/cron/balance-charges', {
            headers: { authorization: 'Bearer ' + env.CRON_SECRET },
        }).then((r) => r.json());

        // The first run is this booking's first attempt; the repeat is what is
        // under test.
        await balanceRun();
        const attemptsBefore = Number((await booking(due.id)).balance_attempts);
        const repeat = await balanceRun();
        console.log('   repeat balance run → ' + JSON.stringify(repeat));
        const attemptsAfter = Number((await booking(due.id)).balance_attempts);
        check('a second balance run the same day does not take another attempt',
            attemptsAfter === attemptsBefore,
            attemptsBefore + ' → ' + attemptsAfter);
    }

    /* ------------------------------------------------------------ summary */

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    for (const r of results) {
        console.log(String(r.number).padStart(2) + '. ' + r.status.toUpperCase().padEnd(9)
            + r.title.slice(0, 56));
        for (const c of r.checks.filter((x) => !x.ok)) {
            console.log('      ✗ ' + c.description + (c.detail ? '  — ' + c.detail : ''));
        }
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    console.log('\n' + results.length + ' scenarios, ' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}

// Signs a payload the way Stripe does, so the webhook route accepts it.
async function signedWebhook(payload) {
    const crypto = await import('node:crypto');
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
        .createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
        .update(timestamp + '.' + body)
        .digest('hex');
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'stripe-signature': 't=' + timestamp + ',v1=' + signature,
        },
        body,
    };
}

main().catch((err) => {
    console.error('\nrunner crashed:', err.stack || err.message);
    process.exit(2);
});
