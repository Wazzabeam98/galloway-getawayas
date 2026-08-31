// Shows what the Stripe webhook does when a handler throws, and what a retry
// of that event is worth.
//
//   npm run dev                     # in another terminal, first
//   node scripts/webhook-fault.mjs
//
// NO TEST-ONLY CODE IN THE ROUTE. This used to work by calling an
// injectedFault() hook that lived in app/api/stripe/webhook/route.ts and did
// nothing unless the Stripe key was a test key. That hook is gone, on the
// grounds that code sitting in the payment path purely for testing is exactly
// what gets forgotten and then trusted. Correct call.
//
// So the throw is now a real one, caused the way real ones are caused: an
// event whose shape the handler did not expect. `data.object` is absent, the
// handler reads `cs.metadata` off undefined, and TypeError comes out of the
// same catch that a dropped Supabase connection would.
//
// The one thing that costs: a malformed event carries no booking id, so the
// report says booking_id: null. A throw further in — the ordinary case —
// names the booking. tests/webhook-reporting.test.ts covers that, by stubbing
// the database to throw on a well-formed event.
//
// Nothing here asserts. It prints what happened and leaves the judgement to
// the person reading it, because the point is to SEE it rather than to be
// told a test passed. The transcript belongs in WEBHOOK-FAILURE.md.

import crypto from 'node:crypto';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);

// Through the guard, like every other runner that talks to the site. It asks
// the deployment what it is and refuses production, the production database,
// and a build behind master — see scripts/target.cjs and the test that makes
// having a target of your own a build failure.
//
// This one writes rows AND takes real test-mode payments, so it is squarely
// the kind of runner the guard was written for. A dev server on a port other
// than the default is named with `--host` on the command line, which the guard
// checks like any other target. Writing the address in a comment here would
// fail tests/runner-targets.test.ts, and rightly — a stale URL in a comment is
// how the last one hid.
const SITE = await resolveTarget({
    runner: 'scripts/webhook-fault.mjs',
    envNames: ['WEBHOOK_FAULT_SITE'],
    fallback: LOCAL_URL,
});

const log = (...a) => console.log(...a);
const money = (v) => '£' + Number(v || 0).toFixed(2);

/* ------------------------------------------------------------- signing --- */

// Signs a payload the way Stripe does, so the route accepts it.
async function signedWebhook(payload) {
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

/* --------------------------------------------------------------- state --- */

async function bookingRow(id) {
    const rows = await db.select(
        'bookings',
        '?select=id,status,payment_status,amount_paid,balance_amount,paid_at,confirmed_at,'
        + 'stripe_payment_intent_id,total_price,listing_id,guest_id&id=eq.' + id
    );
    return rows[0] || null;
}

async function paymentsFor(id) {
    return db.select('payments', '?select=id,kind,status,amount,stripe_payment_intent_id&booking_id=eq.' + id);
}

async function errorsSince(iso) {
    return db.select(
        'error_log',
        '?select=id,message,path,created_at&created_at=gt.' + encodeURIComponent(iso)
        + '&order=created_at.desc&limit=20'
    );
}

async function eventRow(eventId) {
    const rows = await db.select('stripe_events', '?select=event_id,event_type&event_id=eq.' + eventId);
    return rows[0] || null;
}

/* ----------------------------------------------------------------- run --- */

async function pickBooking() {
    // An unpaid, seeded booking. Deliberately one that has not been paid, so
    // the run starts from the state a real guest is in when they press pay.
    const rows = await db.select(
        'bookings',
        '?select=id,status,payment_status,total_price,listing_id,guest_id'
        + '&status=eq.pending_payment&order=created_at.desc&limit=1'
    );
    if (!rows.length) {
        throw new Error('no pending_payment booking to use — run node scripts/seed-payments.mjs first');
    }
    return rows[0];
}

async function run() {
    log('');
    log('='.repeat(74));
    log('A HANDLER THAT THROWS, ON A BOOKING THAT HAS GENUINELY BEEN PAID FOR');
    log('='.repeat(74));

    const target = await pickBooking();
    const before = await bookingRow(target.id);
    const paymentsBefore = await paymentsFor(target.id);
    const startedAt = new Date(Date.now() - 2000).toISOString();

    log('');
    log('booking ' + target.id);
    log('  before:  status=' + before.status
        + '  payment_status=' + before.payment_status
        + '  amount_paid=' + money(before.amount_paid));
    log('  payments ledger rows before: ' + paymentsBefore.length);

    /* --- the guest actually pays --- */

    const amountPence = Math.round(Number(before.total_price || 300) * 100);
    const intent = await stripe.request('POST', '/payment_intents', {
        amount: amountPence,
        currency: 'gbp',
        payment_method: 'pm_card_visa',
        payment_method_types: ['card'],
        confirm: 'true',
        description: 'webhook fault demo',
        metadata: { booking_id: target.id, demo: 'webhook-fault' },
    });

    log('');
    log('  STRIPE: payment intent ' + intent.id + ' → ' + intent.status
        + '  ' + money(intent.amount / 100));
    if (intent.status !== 'succeeded') {
        throw new Error('the demo needs a genuinely paid intent; got ' + intent.status);
    }

    /* --- the webhook arrives --- */

    // A REAL malformed event, not an injected fault. `data` with no `object`
    // on it: the handler does `const cs = event.data.object` and then reads
    // `cs.metadata`, which throws TypeError — out of the same catch that a
    // dropped connection or an unexpected Stripe field would come out of.
    const eventId = 'evt_fault_' + Date.now();
    const event = {
        id: eventId,
        type: 'checkout.session.completed',
        data: {},
        // Kept here so the transcript can say which payment this was about,
        // even though the handler never gets far enough to read it.
        _demo: { booking_id: target.id, payment_intent: intent.id },
    };

    const res = await fetch(SITE + '/api/stripe/webhook', await signedWebhook(event));
    const body = await res.json().catch(() => ({}));

    log('');
    log('  WHAT STRIPE SEES:  HTTP ' + res.status + '  ' + JSON.stringify(body));
    log('    → ' + (res.status >= 200 && res.status < 300
        ? 'Stripe marks this event DELIVERED and will not retry it.'
        : 'Stripe marks this event FAILED and will retry it.'));

    /* --- what actually happened --- */

    await new Promise((r) => setTimeout(r, 800));

    const after = await bookingRow(target.id);
    const paymentsAfter = await paymentsFor(target.id);
    const errors = await errorsSince(startedAt);
    const recorded = await eventRow(eventId);

    log('');
    log('  BOOKING AFTER:');
    log('    status=' + after.status + '  (was ' + before.status + ')');
    log('    payment_status=' + after.payment_status + '  (was ' + before.payment_status + ')');
    log('    amount_paid=' + money(after.amount_paid) + '  (was ' + money(before.amount_paid) + ')');
    log('    confirmed_at=' + (after.confirmed_at || 'null'));
    const confirmed = after.status === 'confirmed';
    log('    → the guest has paid ' + money(intent.amount / 100) + ' and their booking is '
        + (confirmed ? 'CONFIRMED' : 'STILL ' + String(after.status).toUpperCase()));

    log('');
    log('  PAYMENTS LEDGER: ' + paymentsBefore.length + ' rows before, '
        + paymentsAfter.length + ' after');
    for (const p of paymentsAfter) {
        log('    ' + p.kind + ' ' + p.status + ' ' + money(p.amount) + ' ' + (p.stripe_payment_intent_id || ''));
    }
    if (paymentsAfter.length === paymentsBefore.length) {
        log('    → nothing was written. The money is at Stripe and not in the ledger.');
    }

    log('');
    log('  /admin/errors — error_log rows written during this run: ' + errors.length);
    for (const e of errors) log('    ' + e.created_at + '  ' + e.path + '  ' + e.message);
    if (!errors.length) {
        log('    → NOTHING. Nobody is told. This is the whole point.');
    }

    log('');
    log('  stripe_events row for ' + eventId + ': ' + (recorded ? 'PRESENT' : 'absent'));
    if (recorded) {
        log('    → the event is recorded as seen BEFORE the handler runs, so a');
        log('      redelivery of this same event is short-circuited as a duplicate');
        log('      and the handler never runs again. Demonstrated next.');
    }

    /* --- what a Stripe retry of this same event would do --- */

    const replay = await fetch(SITE + '/api/stripe/webhook', await signedWebhook(event));
    const replayBody = await replay.json().catch(() => ({}));
    const afterReplay = await bookingRow(target.id);

    log('');
    log('  RETRY OF THE SAME EVENT: HTTP ' + replay.status + '  ' + JSON.stringify(replayBody));
    log('    booking status after retry: ' + afterReplay.status);
    if (replayBody.duplicate === true) {
        log('    → refused as a duplicate. The handler did not run. Returning 500');
        log('      instead of 200 would NOT have fixed this booking.');
    }

    /* --- put it back --- */

    await db.remove('payments', '?stripe_payment_intent_id=eq.' + intent.id);
    await db.remove('stripe_events', '?event_id=eq.' + eventId);
    await db.update('bookings', '?id=eq.' + target.id, {
        status: before.status,
        payment_status: before.payment_status,
        amount_paid: before.amount_paid,
        balance_amount: before.balance_amount,
        paid_at: before.paid_at,
        confirmed_at: before.confirmed_at,
        stripe_payment_intent_id: before.stripe_payment_intent_id,
    });
    log('');
    log('  (cleaned up: booking restored, demo rows removed)');
}

async function main() {
    log('Galloway Getaways — Stripe webhook fault demonstration');
    log('site: ' + SITE + '  (checked by scripts/target.cjs)');
    log('stripe: test mode (' + env.STRIPE_SECRET_KEY.slice(0, 12) + '…)');
    log('the throw is a real one: a malformed event, no test code in the route');

    await run();

    log('');
    log('done.');
}

main().catch((err) => {
    console.error('');
    console.error('FAILED: ' + (err && err.message));
    process.exit(1);
});
