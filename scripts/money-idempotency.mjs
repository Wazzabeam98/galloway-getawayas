// Shows the two ways one balance payment can be recorded twice.
//
//   npm run dev                          # in another terminal, first
//   node scripts/money-idempotency.mjs
//
// THE STORY IT TELLS. A guest pays a £150 deposit at booking and the £150
// balance later. That is £300, and the booking should say £300. This walks a
// real one through, with a real test-mode payment, and then does the one thing
// that is documented as possible in WEBHOOK-FAILURE.md — lets the same event
// be handled twice — and shows the booking claiming the guest paid £450.
//
// HOW THE SECOND DELIVERY IS ARRANGED, AND WHY IT IS FAIR. The webhook records
// every event id in `stripe_events` before running the handler, and refuses a
// repeat. So normally a redelivery cannot reach the handler at all. But that
// insert can fail — and when it does, the code carries on and handles the
// event anyway, which is the right call and is now reported. From that moment
// the dedupe is off for that event, and Stripe's own retry runs the handler a
// second time.
//
// This script reproduces that state exactly: deliver, delete the stripe_events
// row (which is the state you are in if the insert never wrote), deliver the
// same event again. Same event id, same payment, no invented scenario.
//
// It cleans up after itself and can be run repeatedly.

import crypto from 'node:crypto';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);

// Through the guard, like every other runner that talks to the site: it
// refuses production, the production database and a stale build before this
// writes anything. See scripts/target.cjs.
const SITE = await resolveTarget({
    runner: 'scripts/money-idempotency.mjs',
    envNames: ['MONEY_IDEMPOTENCY_SITE'],
    fallback: LOCAL_URL,
});

const log = (...a) => console.log(...a);
const money = (v) => '£' + Number(v || 0).toFixed(2);
const rule = (t) => { log(''); log('='.repeat(74)); log(t); log('='.repeat(74)); };

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

async function bookingRow(id) {
    const rows = await db.select(
        'bookings',
        '?select=id,status,payment_status,amount_paid,balance_amount,total_price,'
        + 'stripe_payment_intent_id,paid_at,confirmed_at,guest_id&id=eq.' + id
    );
    return rows[0] || null;
}

const ledger = (id) =>
    db.select('payments', '?select=id,kind,status,amount,stripe_payment_intent_id&booking_id=eq.' + id
        + '&order=created_at.asc');

async function showLedger(bookingId, label) {
    const rows = await ledger(bookingId);
    const counted = rows.filter((r) => r.status === 'succeeded' && r.kind !== 'refund');
    const sum = counted.reduce((a, r) => a + Number(r.amount), 0);
    log('  PAYMENTS LEDGER ' + label + ': ' + rows.length + ' row(s)');
    for (const r of rows) {
        log('    ' + r.kind.padEnd(8) + r.status.padEnd(11) + money(r.amount).padEnd(9)
            + (r.stripe_payment_intent_id || '—'));
    }
    log('    money in, per the ledger: ' + money(sum));
    return sum;
}

async function main() {
    log('Galloway Getaways — one payment, recorded twice');
    log('site: ' + SITE + '  (checked by scripts/target.cjs)');
    log('stripe: test mode (' + env.STRIPE_SECRET_KEY.slice(0, 12) + '…)');

    const candidates = await db.select(
        'bookings',
        '?select=id,status,payment_status,total_price&status=eq.pending_payment&order=created_at.desc&limit=1'
    );
    if (!candidates.length) {
        throw new Error('no pending_payment booking to use — run node scripts/seed-payments.mjs first');
    }
    const id = candidates[0].id;
    const original = await bookingRow(id);
    const total = Number(original.total_price || 300);
    const deposit = Math.round(total * 50) / 100;   // half, to 2dp
    const balance = Math.round((total - deposit) * 100) / 100;

    rule('SETUP — a booking with the deposit already paid');

    // The state a real booking is in between the deposit and the balance.
    await db.update('bookings', '?id=eq.' + id, {
        status: 'confirmed',
        payment_status: 'deposit_paid',
        amount_paid: deposit,
        balance_amount: balance,
    });
    const depositIntent = 'pi_demo_deposit_' + Date.now();
    await db.insert('payments', {
        booking_id: id,
        kind: 'deposit',
        amount: deposit,
        status: 'succeeded',
        stripe_payment_intent_id: depositIntent,
    });

    log('  booking ' + id);
    log('  stay total ' + money(total) + ' — deposit ' + money(deposit)
        + ' paid, ' + money(balance) + ' still to come');
    await showLedger(id, 'now');

    rule('THE GUEST PAYS THE BALANCE — for real, at Stripe');

    const intent = await stripe.request('POST', '/payment_intents', {
        amount: Math.round(balance * 100),
        currency: 'gbp',
        payment_method: 'pm_card_visa',
        payment_method_types: ['card'],
        confirm: 'true',
        description: 'money-idempotency demo',
        metadata: { booking_id: id, kind: 'balance' },
    });
    log('  ' + intent.id + ' → ' + intent.status + '  ' + money(intent.amount / 100));
    if (intent.status !== 'succeeded') throw new Error('needed a real payment; got ' + intent.status);

    const eventId = 'evt_balance_' + Date.now();
    const event = {
        id: eventId,
        type: 'checkout.session.completed',
        data: {
            object: {
                payment_status: 'paid',
                amount_total: Math.round(balance * 100),
                payment_intent: intent.id,
                customer: null,
                client_reference_id: id,
                metadata: { booking_id: id, kind: 'balance' },
            },
        },
    };

    rule('FIRST DELIVERY — correct');

    let res = await fetch(SITE + '/api/stripe/webhook', await signedWebhook(event));
    log('  webhook → HTTP ' + res.status + ' ' + JSON.stringify(await res.json().catch(() => ({}))));
    await new Promise((r) => setTimeout(r, 600));

    let after = await bookingRow(id);
    log('  booking says the guest has paid: ' + money(after.amount_paid)
        + '   (right answer: ' + money(total) + ')');
    await showLedger(id, 'after one delivery');

    rule('THE DEDUPE RECORD GOES MISSING — the documented hole');

    // Exactly the state you are in when the stripe_events insert failed: the
    // handler ran, and nothing remembers the event was seen.
    await db.remove('stripe_events', '?event_id=eq.' + eventId);
    log('  deleted the stripe_events row for ' + eventId);
    log('  (this is the state after that insert fails — the webhook carries on');
    log('   and handles the event, which is right, but the dedupe is now off)');

    rule('SECOND DELIVERY — the same event, the same payment');

    res = await fetch(SITE + '/api/stripe/webhook', await signedWebhook(event));
    log('  webhook → HTTP ' + res.status + ' ' + JSON.stringify(await res.json().catch(() => ({}))));
    await new Promise((r) => setTimeout(r, 600));

    after = await bookingRow(id);
    const ledgerSum = await showLedger(id, 'after two deliveries');

    const claimed = Number(after.amount_paid);
    const balanceRows = (await ledger(id)).filter(
        (r) => r.kind === 'balance' && r.stripe_payment_intent_id === intent.id
    );
    const bug1 = claimed !== total;
    const bug2 = balanceRows.length > 1;

    rule(bug1 || bug2 ? 'WHAT IS NOW WRONG' : 'BOTH BUGS ARE GONE');

    log('  BUG 1 — one payment counted twice on the booking');
    log('    the guest really paid           ' + money(total));
    log('    the booking says they paid      ' + money(claimed));
    log('    ' + (bug1
        ? '→ OVERSTATED BY ' + money(claimed - total)
        : '→ CORRECT, after two deliveries of the same event'));
    log('');
    log('  BUG 2 — one payment counted twice in the ledger');
    log('    Stripe took                     ' + money(balance) + ' on ' + intent.id);
    log('    the ledger counts               ' + money(ledgerSum));
    log('    rows for that one payment intent: ' + balanceRows.length);
    log('    ' + (bug2
        ? '→ DUPLICATED. There is no unique key stopping it.'
        : '→ ONE ROW. The unique index refused the second.'));

    log('');
    if (bug1 || bug2) {
        log('  WHAT THAT COSTS, IN ORDER:');
        log('    · the books say ' + money(claimed) + ' came in for a ' + money(total) + ' stay');
        log('    · a refund is worked out from what was paid, so an over-recorded');
        log('      booking refunds more than the guest ever gave you');
        log('    · the host payout is netted off the same figure');
        log('    · nothing looks broken — the guest is happy and the stay is confirmed');
    } else {
        log('  The second delivery was answered {"ok":true,"counted":false} — the');
        log('  webhook is saying it recognised the payment and left the money alone.');
        log('  Everything that is safe to write again still was: payment_status is');
        log('  paid and the outstanding balance is zero either way.');
    }

    /* ------------------------------------------------------------- cleanup */

    await db.remove('payments', '?booking_id=eq.' + id);
    await db.remove('stripe_events', '?event_id=eq.' + eventId);
    await db.update('bookings', '?id=eq.' + id, {
        status: original.status,
        payment_status: original.payment_status,
        amount_paid: original.amount_paid,
        balance_amount: original.balance_amount,
        stripe_payment_intent_id: original.stripe_payment_intent_id,
        paid_at: original.paid_at,
        confirmed_at: original.confirmed_at,
    });
    log('');
    log('  (cleaned up: booking restored, demo rows removed)');
    log('');
    log('done.');
}

main().catch((err) => {
    console.error('');
    console.error('FAILED: ' + (err && err.message));
    process.exit(1);
});
