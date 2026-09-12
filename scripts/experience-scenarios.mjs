// Guest-experience money scenarios — the gap PAYMENT-SCENARIOS.md never covered.
//
//   node scripts/experience-scenarios.mjs
//
// Nothing in this project had ever moved money through a guest-experience order
// — no test, no person. This does. It drives the REAL routes against a guarded
// `next dev`, with REAL test-mode Stripe and a REAL connected account behind
// them, and reads every figure back FROM STRIPE (PaymentIntent status, captured
// amount, application fee, transfer, connected-account balance) rather than
// trusting the app's own service_orders rows.
//
// WHAT IT CANNOT DO, AND HOW IT STANDS IN — exactly the wall the cottage
// scenarios 1/2/4/5 hit: a hosted Checkout page cannot be completed over the
// API. So where a real guest's money would be born on the Checkout page, this
// creates the PaymentIntent directly with the IDENTICAL destination-charge
// fields the route sets (on_behalf_of, application_fee_amount,
// transfer_data.destination, capture_method, metadata), and — for the order row
// the webhook creates — delivers a SELF-SIGNED checkout.session.completed to the
// webhook exactly as Stripe would (same secret, same signature scheme). The
// money movement is faithful; only the hosted page is skipped. Time is
// fast-forwarded for the sweep cases by ageing expires_at directly, the same
// move seed-payments makes with past check-in dates.
//
// Needs: a dev server with GUEST_EXPERIENCES_OPEN=true (the routes 403
// otherwise), the test Stripe key, and the test Supabase project. Reuses a
// connected account from the payments manifest if one is present, else creates
// one (slow, ~2 min, cached in its own manifest).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    signIn, sleep, round2, dayOffset, ROOT,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);

const SITE = await resolveTarget({
    runner: 'scripts/experience-scenarios.mjs',
    envNames: ['SITE_URL'],
    fallback: LOCAL_URL,
});

const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not set — cannot sign webhook events.');
    process.exit(1);
}

const EXP_DOMAIN = 'gallowayexp.test';
const EXP_TAG = 'gg-experience-seed';
const RESULTS = path.join(ROOT, 'SCENARIO-RESULTS-EXPERIENCES.json');

/* ----------------------------------------------------------- scenario harness */

const results = [];
let current = null;
function scenario(number, title) {
    current = { number, title, checks: [], status: 'passed', note: null };
    results.push(current);
    console.log('\n── ' + number + '. ' + title);
}
function check(description, condition, detail) {
    const ok = !!condition;
    current.checks.push({ description, ok, detail: detail || null });
    if (!ok) current.status = 'failed';
    console.log('   ' + (ok ? '✓' : '✗') + ' ' + description + (detail && !ok ? '  — ' + detail : ''));
}
function note(text) {
    current.note = text;
    console.log('   · ' + text);
}

/* ------------------------------------------------------------------ Stripe help */

// The two figures priceOrder derives, replicated so the direct PaymentIntent
// matches what the route's Checkout would have charged — fee by subtraction, no
// independent rounding, exactly as lib/serviceOrders.ts priceOrder does.
function priceParts(total) {
    const amountPence = Math.round(total * 100);
    const commission = Math.round(total * 0.10 * 100) / 100;
    const net = Math.round((total - commission) * 100) / 100;
    const feePence = amountPence - Math.round(net * 100);
    return { amountPence, feePence, netPence: Math.round(net * 100) };
}

// A real destination charge, the guest's money. `capture: 'manual'` is the
// request shape's held card; omit it for the slot shape's instant charge.
async function destinationPI({ total, account, capture, metadata, pm = 'pm_card_visa' }) {
    const { amountPence, feePence } = priceParts(total);
    const body = {
        amount: amountPence,
        currency: 'gbp',
        payment_method: pm,
        payment_method_types: ['card'],
        confirm: 'true',
        on_behalf_of: account,
        application_fee_amount: feePence,
        transfer_data: { destination: account },
        description: EXP_TAG + ' destination charge',
        metadata: metadata || {},
    };
    if (capture) body.capture_method = capture;
    return stripe.request('POST', '/payment_intents', body);
}

async function getPI(id) {
    return stripe.request('GET', '/payment_intents/' + id + '?expand[]=latest_charge');
}

// The charge, read directly. With on_behalf_of == transfer_data.destination
// (what the routes set), Stripe settles a destination charge whose Transfer and
// Application Fee objects populate a few seconds AFTER the charge — so reading
// the PI's latest_charge immediately shows transfer/application_fee as absent.
// This polls until the transfer has landed (or times out), which is the honest
// "the money has actually moved" signal.
async function chargeOf(piId) {
    const pi = await getPI(piId);
    const lc = pi.latest_charge;
    const id = typeof lc === 'string' ? lc : (lc && lc.id);
    return id ? stripe.request('GET', '/charges/' + id) : null;
}
async function settledCharge(piId, { needTransfer = true, tries = 12, gapMs = 2000 } = {}) {
    let ch = null;
    for (let i = 0; i < tries; i++) {
        ch = await chargeOf(piId);
        if (ch && (!needTransfer || ch.transfer)) return ch;
        await sleep(gapMs);
    }
    return ch;
}

async function connectedBalance(account) {
    const b = await stripe.request('GET', '/balance', null, { account });
    const pick = (arr) => ((arr || []).find((x) => x.currency === 'gbp') || {}).amount || 0;
    return { available: pick(b.available) / 100, pending: pick(b.pending) / 100 };
}

// A self-signed Stripe event, delivered to the webhook exactly as Stripe does.
// `secret` defaults to the real one (a valid delivery); pass a wrong secret to
// reproduce the stale-whsec_ failure that leaves an order stuck.
async function postWebhook(eventObject, { secret = WEBHOOK_SECRET } = {}) {
    const payload = JSON.stringify({
        id: 'evt_exp_' + crypto.randomBytes(10).toString('hex'),
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: eventObject },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(t + '.' + payload).digest('hex');
    const res = await fetch(SITE + '/api/stripe/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + t + ',v1=' + sig },
        body: payload,
    });
    const text = await res.text();
    return { status: res.status, body: text };
}

// A checkout.session.completed that mirrors what the request-order route's
// Checkout would carry: all order metadata, the held PaymentIntent, the total.
function sessionForServiceOrder({ pi, total, provider, guest, booking, serviceDate, item }) {
    return {
        object: 'checkout_session',
        payment_status: 'no_payment_required',
        payment_intent: pi,
        amount_total: Math.round(total * 100),
        customer_email: guest.email,
        customer_details: { email: guest.email },
        metadata: {
            kind: 'service_order',
            provider_id: provider.id,
            booking_id: booking.id,
            guest_id: guest.id,
            listing_id: booking.listing_id || '',
            service_date: serviceDate,
            guests: String(booking.guests ?? ''),
            commission_rate: '0.1',
            note: '',
            allergy: '',
            item_id: item.id,
            item_name: item.name,
            item_description: item.description || '',
            item_unit: 'flat',
            unit_price: String(total),
            quantity: '1',
        },
    };
}

/* ----------------------------------------------------------------- HTTP helpers */

async function asUser(label) {
    const { cookie } = await signIn(env, label + '@' + EXP_DOMAIN, 'seed-password-' + label);
    return cookie;
}
async function postRoute(routePath, cookie, body) {
    const res = await fetch(SITE + routePath, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
}
async function runOrderSweep() {
    const res = await fetch(SITE + '/api/cron/service-orders', {
        headers: { authorization: 'Bearer ' + env.CRON_SECRET },
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function orderRow(id) {
    const [row] = await db.select('service_orders', '?select=*&id=eq.' + id);
    return row;
}

/* ----------------------------------------------------------------------- seeding */

async function resetSeed() {
    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + EXP_DOMAIN));
    if (!seeded.length) return;
    const ids = '(' + seeded.map((u) => u.id).join(',') + ')';

    const providers = await db.select('service_providers', '?select=id&owner_id=in.' + ids);
    for (const p of providers) {
        await db.remove('service_orders', '?provider_id=eq.' + p.id);
        await db.remove('slot_sessions', '?provider_id=eq.' + p.id);
        await db.remove('slot_availability', '?provider_id=eq.' + p.id);
        await db.remove('slot_blocks', '?provider_id=eq.' + p.id);
        await db.remove('service_provider_items', '?provider_id=eq.' + p.id);
    }
    await db.remove('service_providers', '?owner_id=in.' + ids);

    const bookings = await db.select('bookings', '?select=id&guest_id=in.' + ids);
    for (const b of bookings) {
        await db.remove('service_orders', '?booking_id=eq.' + b.id);
        for (const t of ['payouts', 'payments', 'messages']) await db.remove(t, '?booking_id=eq.' + b.id);
    }
    await db.remove('bookings', '?guest_id=in.' + ids);
    await db.remove('listings', '?host_id=in.' + ids);
    await db.remove('profiles', '?id=in.' + ids);
    for (const u of seeded) await db.auth('DELETE', '/admin/users/' + u.id);
    console.log('  reset ' + seeded.length + ' previous experience-seed user(s)');
}

async function createUser(label, fullName) {
    const email = label + '@' + EXP_DOMAIN;
    const user = await db.auth('POST', '/admin/users', {
        email, password: 'seed-password-' + label, email_confirm: true,
        user_metadata: { full_name: fullName, [EXP_TAG]: true },
    });
    // A trigger on auth.users auto-creates the profiles row, so update rather
    // than insert (the payments seeder does the same).
    const existing = await db.select('profiles', '?select=id&id=eq.' + user.id);
    if (existing.length) await db.update('profiles', '?id=eq.' + user.id, { email, full_name: fullName });
    else await db.insert('profiles', { id: user.id, email, full_name: fullName });
    return { id: user.id, email, label };
}

// Reuse a connected account that can take a destination charge (transfers +
// card_payments active, payouts enabled). Prefer the payments manifest's
// accounts; fall back to creating one.
async function pickAccount() {
    const manifestPath = path.join(ROOT, 'scripts', '.seed-manifest.json');
    const candidates = [];
    if (fs.existsSync(manifestPath)) {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const id of Object.values(m.accounts || {})) candidates.push(id);
    }
    for (const id of candidates) {
        const a = await stripe.request('GET', '/accounts/' + id).catch(() => null);
        const caps = (a && a.capabilities) || {};
        if (a && a.payouts_enabled && caps.transfers === 'active' && caps.card_payments === 'active') {
            console.log('  reusing connected account ' + id + ' (transfers+card_payments active)');
            return id;
        }
    }
    throw new Error(
        'no reusable connected account with transfers+card_payments active — run '
        + '`node scripts/seed-payments.mjs` first (it creates them), then re-run this.'
    );
}

/* --------------------------------------------------------------------------- main */

async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('stripe:  ' + env.STRIPE_SECRET_KEY.slice(0, 12) + '… (test mode)');
    console.log('site:    ' + SITE);

    console.log('\nseeding…');
    await resetSeed();
    const account = await pickAccount();

    const guest = await createUser('guest', 'Exp Guest');
    const host = await createUser('host', 'Exp Host');
    const owner = await createUser('owner', 'Exp Provider Owner');

    const [listing] = await db.insert('listings', {
        host_id: host.id, title: 'EXP — cottage', description: 'seed',
        location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 6,
        status: 'published', cancellation_policy: 'Moderate',
    });
    // A stay that spans every service date the scenarios use.
    const [booking] = await db.insert('bookings', {
        listing_id: listing.id, guest_id: guest.id, host_id: host.id,
        check_in: dayOffset(1), check_out: dayOffset(12), guests: 2, adults: 2,
        total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500,
        commission_rate: 10, paid_at: new Date().toISOString(),
    });

    // The request-shape provider (a chef — comes_to_you, exclusive per date).
    const [chef] = await db.insert('service_providers', {
        owner_id: owner.id, business_name: 'EXP Chef', trade: 'chef', audience: 'guest',
        status: 'approved', plan: 'commission', commission_rate: 0.10,
        shape: 'comes_to_you', exclusive_per_date: true,
        contact_email: 'owner@' + EXP_DOMAIN,
        stripe_account_id: account, stripe_payouts_enabled: true,
        stripe_charges_enabled: true, stripe_details_submitted: true,
    });
    const [chefItem] = await db.insert('service_provider_items', {
        provider_id: chef.id, name: 'Private dinner', description: 'Three courses',
        price: 180, unit: 'flat', active: true, sort_order: 0,
    });

    // The slot-shape provider (a sauna — instant, timed, capacity 1 flat slot).
    const [sauna] = await db.insert('service_providers', {
        owner_id: owner.id, business_name: 'EXP Sauna', trade: 'sauna', audience: 'guest',
        status: 'approved', plan: 'commission', commission_rate: 0.10,
        shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_capacity: 1,
        cancellation_window_hours: 12, contact_email: 'owner@' + EXP_DOMAIN,
        stripe_account_id: account, stripe_payouts_enabled: true,
        stripe_charges_enabled: true, stripe_details_submitted: true,
    });
    const [saunaItem] = await db.insert('service_provider_items', {
        provider_id: sauna.id, name: 'Wood-fired sauna hour', description: 'Private, up to 4',
        price: 60, unit: 'flat', active: true, sort_order: 0,
    });
    // Open every weekday 09:00–17:00 so any session date in the stay offers 10:00/11:00.
    for (let d = 0; d < 7; d++) {
        await db.insert('slot_availability', {
            provider_id: sauna.id, day_of_week: d, open_time: '09:00', close_time: '17:00',
        });
    }

    console.log('  guest=' + guest.id.slice(0, 8) + ' chef=' + chef.id.slice(0, 8)
        + ' sauna=' + sauna.id.slice(0, 8) + ' account=' + account);

    const guestCookie = await asUser('guest');
    const ownerCookie = await asUser('owner');

    // The routes check auth BEFORE the flag, so an unauthenticated probe is
    // uninformative (always 401). Probe as the signed-in guest: a 403 now means
    // GUEST_EXPERIENCES_OPEN is off on this server.
    const flagProbe = await postRoute('/api/services/order', guestCookie, {});
    if (flagProbe.status === 403) {
        console.error('\nGUEST_EXPERIENCES_OPEN is not true on this server — every route will 403.');
        console.error('Start a dev server with it set, e.g.:  GUEST_EXPERIENCES_OPEN=true PORT=3190 npm run dev');
        console.error('then point this runner at it with the SITE_URL env var (chosen and checked by scripts/target.cjs).');
        await resetSeed();
        process.exit(1);
    }

    /* =================================== 1. LOST WEBHOOK — RECONCILED (the fix) */
    // The worst case, proven first. A slot is booked (seat claimed, holding
    // order). The guest pays for real (immediate destination charge — money
    // splits to the provider at once). The confirming webhook is delivered with
    // a WRONG signature (the stale-whsec_ failure), so it is rejected and the
    // order is stuck 'holding' with the money already taken. We age the hold and
    // run the sweep — which must now RECONCILE against Stripe: find the succeeded
    // payment, confirm the order, and KEEP the seat, rather than expiring paid
    // money. (Against the unfixed cron this scenario fails — which is how it
    // proved the bug in the first place.)
    scenario('1', 'Lost webhook on a slot: the sweep reconciles against Stripe — confirms the paid order, keeps the seat');
    {
        const sessionDate = dayOffset(4);
        const book = await postRoute('/api/services/slots/book', guestCookie, {
            providerId: sauna.id, bookingId: booking.id, sessionDate, sessionTime: '10:00', quantity: 1,
        });
        check('slot/book accepted and returned a Checkout url', book.status === 200 && book.body.ok && !!book.body.url,
            'HTTP ' + book.status + ' ' + JSON.stringify(book.body).slice(0, 160));

        const holds = await db.select('service_orders',
            '?select=*&provider_id=eq.' + sauna.id + '&service_date=eq.' + sessionDate + '&order=created_at.desc&limit=1');
        const hold = holds[0];
        check('a holding order exists after booking', hold && hold.status === 'holding', hold && hold.status);
        const sess = hold && hold.slot_session_id
            ? (await db.select('slot_sessions', '?select=*&id=eq.' + hold.slot_session_id))[0] : null;
        check('the seat was claimed (seats_taken = 1)', sess && sess.seats_taken === 1, sess && String(sess.seats_taken));

        // The guest pays — real money, immediate capture, split to the provider.
        const balBefore = await connectedBalance(account);
        const pi = await destinationPI({
            total: 60, account, capture: null,
            metadata: { kind: 'slot_order', order_id: hold.id, provider_id: sauna.id, booking_id: booking.id },
        });
        check('the guest was charged (PaymentIntent succeeded)', pi.status === 'succeeded', pi.status);

        // The webhook arrives, signed with the WRONG secret — the classic failure.
        const wh = await postWebhook(
            { ...sessionForServiceOrder({ pi: pi.id, total: 60, provider: sauna, guest, booking, serviceDate: sessionDate, item: saunaItem }),
              metadata: { kind: 'slot_order', order_id: hold.id, provider_id: sauna.id, booking_id: booking.id } },
            { secret: WEBHOOK_SECRET + '-wrong' }
        );
        check('the mis-signed webhook was rejected (400), so nothing confirmed it', wh.status === 400, 'HTTP ' + wh.status);

        const stillHolding = await orderRow(hold.id);
        check('the order is still holding (the webhook never landed)', stillHolding.status === 'holding', stillHolding.status);

        // Fast-forward past the 30-min hold + 5-min grace, then run the real sweep.
        await db.update('service_orders', '?id=eq.' + hold.id, { expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
        const swept = await runOrderSweep();
        check('the sweep ran', swept.status === 200 && swept.body.ok, JSON.stringify(swept.body).slice(0, 160));

        // Now read the truth from both sides. Let the transfer settle first.
        const afterOrder = await orderRow(hold.id);
        const afterSess = hold.slot_session_id
            ? (await db.select('slot_sessions', '?select=*&id=eq.' + hold.slot_session_id))[0] : null;
        const charge = await settledCharge(pi.id);
        const balAfter = await connectedBalance(account);
        const delta = round2((balAfter.available + balAfter.pending) - (balBefore.available + balBefore.pending));

        check('the sweep reported a reconciliation', Number(swept.body.reconciled) >= 1, 'reconciled=' + swept.body.reconciled);
        check('STRIPE: the charge is captured (money really moved)', charge && charge.captured === true && charge.amount_captured === 6000,
            charge && (charge.status + ' captured=' + charge.amount_captured));
        check('STRIPE: the provider was paid — £6 fee to us, £54 transferred to them',
            charge && charge.application_fee_amount === 600 && !!charge.transfer,
            'fee=' + (charge && charge.application_fee_amount) + ' transfer=' + (charge && charge.transfer));
        check('STRIPE: the provider’s connected balance rose by ~£54 net', delta >= 53.9, 'delta £' + delta);
        check('APP: the order was RECONCILED to confirmed (not expired)', afterOrder.status === 'confirmed', afterOrder.status);
        check('APP: the order now carries the PaymentIntent id', afterOrder.stripe_payment_intent_id === pi.id, afterOrder.stripe_payment_intent_id);
        check('APP: the seat was KEPT (seats_taken still 1 — not resold)', afterSess && afterSess.seats_taken === 1,
            afterSess && String(afterSess.seats_taken));

        const fixed = charge && charge.captured && charge.amount_captured === 6000
            && afterOrder.status === 'confirmed' && afterOrder.stripe_payment_intent_id === pi.id
            && afterSess && afterSess.seats_taken === 1;
        note(fixed
            ? 'FIXED: the paid order was reconciled to confirmed and the seat kept — the charge is no longer orphaned.'
            : 'NOT FIXED — the paid order was not reconciled to confirmed; see failing checks above.');
        current.fixVerified = !!fixed;
    }

    /* ===================================================== 2. REQUEST → CONFIRM */
    scenario('2', 'Request-and-confirm (chef): held on request, captured on confirm, 10% fee + 90% to provider');
    {
        const serviceDate = dayOffset(5);
        // The real entry route builds a valid Checkout (proves pricing + gates).
        const started = await postRoute('/api/services/order', guestCookie, {
            itemId: chefItem.id, bookingId: booking.id, serviceDate, quantity: 1,
        });
        check('services/order accepted and returned a Checkout url', started.status === 200 && started.body.ok && !!started.body.url,
            'HTTP ' + started.status + ' ' + JSON.stringify(started.body).slice(0, 160));

        // The guest pays: a HELD card (manual capture), real destination charge.
        const pi = await destinationPI({
            total: 180, account, capture: 'manual',
            metadata: { kind: 'service_order', provider_id: chef.id, booking_id: booking.id },
        });
        check('the card is HELD not charged (requires_capture)', pi.status === 'requires_capture', pi.status);
        const chargeHeld = (await getPI(pi.id)).latest_charge;
        check('STRIPE: nothing captured yet', chargeHeld && chargeHeld.captured === false, chargeHeld && String(chargeHeld.captured));

        // The webhook lands (correctly signed) and creates the authorised order.
        const wh = await postWebhook(sessionForServiceOrder({ pi: pi.id, total: 180, provider: chef, guest, booking, serviceDate, item: chefItem }));
        check('the webhook was accepted (200)', wh.status === 200, 'HTTP ' + wh.status);
        const auths = await db.select('service_orders',
            '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1');
        const order = auths[0];
        check('an authorised order was created by the webhook', order && order.status === 'authorised', order && order.status);
        check('the order carries the held PaymentIntent', order && order.stripe_payment_intent_id === pi.id, order && order.stripe_payment_intent_id);

        // The provider confirms — the real route captures the hold.
        const balBefore = await connectedBalance(account);
        const resp = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        check('orders/respond confirm succeeded', resp.status === 200 && resp.body.status === 'confirmed',
            'HTTP ' + resp.status + ' ' + JSON.stringify(resp.body).slice(0, 120));

        const charge = await settledCharge(pi.id);
        const balAfter = await connectedBalance(account);
        const delta = round2((balAfter.available + balAfter.pending) - (balBefore.available + balBefore.pending));
        const afterOrder = await orderRow(order.id);
        check('STRIPE: the hold was captured (£180)', charge && charge.captured === true && charge.amount_captured === 18000,
            charge && (charge.status + ' captured=' + charge.amount_captured));
        check('STRIPE: our fee is £18 and the transfer went to the provider',
            charge && charge.application_fee_amount === 1800 && !!charge.transfer, 'fee=' + (charge && charge.application_fee_amount));
        check('STRIPE: the provider gained ~£162 net', delta >= 161.9, 'delta £' + delta);
        check('APP: the order is confirmed', afterOrder.status === 'confirmed', afterOrder.status);
    }

    /* =========================================================== 3. SLOT (happy) */
    scenario('3', 'Instant slot (sauna): seat claimed, charged immediately, confirmed by the webhook');
    {
        const sessionDate = dayOffset(5);
        const book = await postRoute('/api/services/slots/book', guestCookie, {
            providerId: sauna.id, bookingId: booking.id, sessionDate, sessionTime: '11:00', quantity: 1,
        });
        check('slot/book accepted', book.status === 200 && book.body.ok, 'HTTP ' + book.status);
        const hold = (await db.select('service_orders',
            '?select=*&provider_id=eq.' + sauna.id + '&service_date=eq.' + sessionDate + '&service_time=eq.11:00:00&order=created_at.desc&limit=1'))[0];
        check('a holding order exists', hold && hold.status === 'holding', hold && hold.status);

        const pi = await destinationPI({
            total: 60, account, capture: null,
            metadata: { kind: 'slot_order', order_id: hold.id, provider_id: sauna.id, booking_id: booking.id },
        });
        check('STRIPE: charged immediately (succeeded)', pi.status === 'succeeded', pi.status);
        const charge = await settledCharge(pi.id);
        check('STRIPE: fee £6, transfer to provider', charge && charge.application_fee_amount === 600 && !!charge.transfer,
            'fee=' + (charge && charge.application_fee_amount) + ' transfer=' + (charge && charge.transfer));

        const wh = await postWebhook({ ...sessionForServiceOrder({ pi: pi.id, total: 60, provider: sauna, guest, booking, serviceDate: sessionDate, item: saunaItem }),
            metadata: { kind: 'slot_order', order_id: hold.id, provider_id: sauna.id, booking_id: booking.id } });
        check('the webhook was accepted (200)', wh.status === 200, 'HTTP ' + wh.status);
        const afterOrder = await orderRow(hold.id);
        check('APP: the order is confirmed and carries the PaymentIntent',
            afterOrder.status === 'confirmed' && afterOrder.stripe_payment_intent_id === pi.id, afterOrder.status);
    }

    /* ====================================================== 4. CARD DECLINED */
    scenario('4', 'Card declined halfway (request shape): no order stranded, nothing held');
    {
        const serviceDate = dayOffset(8);
        let declined = false, code = null;
        try {
            await destinationPI({
                total: 180, account, capture: 'manual', pm: 'pm_card_chargeDeclined',
                metadata: { kind: 'service_order', provider_id: chef.id, booking_id: booking.id },
            });
        } catch (err) { declined = true; code = err.stripeCode || err.message; }
        check('STRIPE: the charge was declined', declined, code || '(it did not decline)');
        check('STRIPE: code is card_declined', code === 'card_declined', String(code));
        const rows = await db.select('service_orders', '?select=id&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate);
        check('APP: no order row was created (the webhook never fired)', rows.length === 0, rows.length + ' row(s)');
        note('Slot shape differs: the seat is claimed before the card, so a decline there parks the seat until the sweep (~35 min). Nothing is charged either way.');
    }

    /* ================================================ 5. PROVIDER NEVER RESPONDS */
    scenario('5', 'Provider never responds: the 48h hold is released by the sweep, nothing captured');
    {
        const serviceDate = dayOffset(6);
        const pi = await destinationPI({
            total: 180, account, capture: 'manual',
            metadata: { kind: 'service_order', provider_id: chef.id, booking_id: booking.id },
        });
        await postWebhook(sessionForServiceOrder({ pi: pi.id, total: 180, provider: chef, guest, booking, serviceDate, item: chefItem }));
        const order = (await db.select('service_orders',
            '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        check('an authorised order exists', order && order.status === 'authorised', order && order.status);

        // Fast-forward the 48h window and run the sweep.
        await db.update('service_orders', '?id=eq.' + order.id, { expires_at: new Date(Date.now() - 60 * 1000).toISOString() });
        const swept = await runOrderSweep();
        check('the sweep ran', swept.status === 200 && swept.body.ok, JSON.stringify(swept.body).slice(0, 120));

        const afterPI = await getPI(pi.id);
        const afterOrder = await orderRow(order.id);
        check('STRIPE: the hold was cancelled, nothing captured', afterPI.status === 'canceled', afterPI.status);
        check('APP: the order is expired', afterOrder.status === 'expired', afterOrder.status);
        note('The sweep sends the guest no email on expiry (the decline path does) — a notification gap, not a money error.');
    }

    /* ============================================ 6. LATE CANCEL (forfeit) */
    scenario('6', 'Cancel after payment, inside the window: provider keeps 90%, platform keeps its 10%, no refund');
    {
        const serviceDate = dayOffset(1); // within 48h of the stay start → inside the free-cancel window
        const pi = await destinationPI({
            total: 180, account, capture: 'manual',
            metadata: { kind: 'service_order', provider_id: chef.id, booking_id: booking.id },
        });
        await postWebhook(sessionForServiceOrder({ pi: pi.id, total: 180, provider: chef, guest, booking, serviceDate, item: chefItem }));
        const order = (await db.select('service_orders',
            '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        const confirmed = await orderRow(order.id);
        check('the order is confirmed and captured', confirmed.status === 'confirmed', confirmed.status);

        const cancel = await postRoute('/api/services/orders/cancel', guestCookie, { orderId: order.id, mode: 'forfeit' });
        check('cancel (forfeit) succeeded with no refund', cancel.status === 200 && cancel.body.refunded === 0,
            'HTTP ' + cancel.status + ' ' + JSON.stringify(cancel.body).slice(0, 120));
        const charge = await settledCharge(pi.id);
        const fee = charge && charge.application_fee ? await stripe.request('GET', '/application_fees/' + charge.application_fee).catch(() => null) : null;
        check('STRIPE: nothing was refunded (money stays put)', charge && Number(charge.amount_refunded) === 0, charge && String(charge.amount_refunded));
        check('STRIPE: our £18 application fee was NOT refunded', charge && charge.application_fee_amount === 1800 && fee && fee.refunded === false,
            'fee=' + (charge && charge.application_fee_amount) + ' refunded=' + (fee && fee.refunded));
        const afterOrder = await orderRow(order.id);
        check('APP: the order is cancelled and records the forfeit (cancel_ack)', afterOrder.status === 'cancelled' && !!afterOrder.cancel_ack, afterOrder.status);
        note('Provider keeps 90% and the platform keeps its 10% on an experience that will not happen — a policy choice for the solicitor.');
    }

    /* =================================================== 7. REFUND + COMMISSION UNWIND */
    scenario('7', 'Refund issued: full refund to the guest, our 10% returned, the transfer reversed');
    {
        const serviceDate = dayOffset(7);
        const pi = await destinationPI({
            total: 180, account, capture: 'manual',
            metadata: { kind: 'service_order', provider_id: chef.id, booking_id: booking.id },
        });
        await postWebhook(sessionForServiceOrder({ pi: pi.id, total: 180, provider: chef, guest, booking, serviceDate, item: chefItem }));
        const order = (await db.select('service_orders',
            '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        check('the order is confirmed and captured', (await orderRow(order.id)).status === 'confirmed', null);

        // The provider's own goodwill refund — unconditional on a confirmed order,
        // and it shares the exact Stripe call the guest free-window cancel makes.
        const refund = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'refund' });
        check('orders/respond refund succeeded', refund.status === 200 && refund.body.status === 'refunded',
            'HTTP ' + refund.status + ' ' + JSON.stringify(refund.body).slice(0, 120));

        // The refund's three effects — guest refund, application-fee refund, and
        // transfer reversal — each settle a few seconds after the call, so poll
        // until they have all landed (or time out).
        let charge = null, fee = null, tr = null;
        for (let i = 0; i < 12; i++) {
            charge = await chargeOf(pi.id);
            fee = charge && charge.application_fee ? await stripe.request('GET', '/application_fees/' + charge.application_fee).catch(() => null) : null;
            tr = charge && charge.transfer ? await stripe.request('GET', '/transfers/' + charge.transfer).catch(() => null) : null;
            if (charge && Number(charge.amount_refunded) === 18000 && fee && fee.refunded && tr && tr.amount_reversed === tr.amount) break;
            await sleep(2000);
        }
        check('STRIPE: the guest was refunded in full (£180)', charge && Number(charge.amount_refunded) === 18000, charge && String(charge.amount_refunded));
        check('STRIPE: our application fee was refunded — commission UNWOUND', fee && fee.refunded === true && fee.amount_refunded === 1800,
            fee ? ('refunded=' + fee.refunded + ' amount_refunded=' + fee.amount_refunded) : 'no application_fee object');
        check('STRIPE: the transfer to the provider was fully reversed', tr && tr.amount_reversed === tr.amount && tr.amount > 0,
            tr ? ('reversed ' + tr.amount_reversed + '/' + tr.amount) : 'no transfer on the charge');
        check('APP: the order is refunded', (await orderRow(order.id)).status === 'refunded', null);
        note('No partial-refund path exists for experiences, so the cottage "partial refund keeps the fee" bug has no analogue here.');
    }

    /* ================================= 8. UNPAID HOLD still expires (regression) */
    // The fix must rescue only PAID holds. A genuinely unpaid one — the guest
    // started Checkout and walked away — must still expire and free its seat, or
    // the reconciliation would quietly turn into "never release anything".
    scenario('8', 'Slot hold never paid: still expired and the seat released (the fix didn’t break this)');
    {
        const sessionDate = dayOffset(6);
        const book = await postRoute('/api/services/slots/book', guestCookie, {
            providerId: sauna.id, bookingId: booking.id, sessionDate, sessionTime: '12:00', quantity: 1,
        });
        check('slot/book accepted', book.status === 200 && book.body.ok, 'HTTP ' + book.status);
        const hold = (await db.select('service_orders',
            '?select=*&provider_id=eq.' + sauna.id + '&service_date=eq.' + sessionDate + '&service_time=eq.12:00:00&order=created_at.desc&limit=1'))[0];
        check('a holding order exists', hold && hold.status === 'holding', hold && hold.status);
        const sess0 = hold && hold.slot_session_id ? (await db.select('slot_sessions', '?select=*&id=eq.' + hold.slot_session_id))[0] : null;
        check('the seat was claimed (seats_taken = 1)', sess0 && sess0.seats_taken === 1, sess0 && String(sess0.seats_taken));

        // No payment at all — nothing carries this order_id at Stripe. Age + sweep.
        await db.update('service_orders', '?id=eq.' + hold.id, { expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
        const swept = await runOrderSweep();
        check('the sweep ran', swept.status === 200 && swept.body.ok, JSON.stringify(swept.body).slice(0, 120));

        const after = await orderRow(hold.id);
        const sess1 = hold.slot_session_id ? (await db.select('slot_sessions', '?select=*&id=eq.' + hold.slot_session_id))[0] : null;
        check('APP: the unpaid order is EXPIRED', after.status === 'expired', after.status);
        check('APP: the seat was released (seats_taken back to 0)', sess1 && sess1.seats_taken === 0, sess1 && String(sess1.seats_taken));
        note('Reconciliation rescues only paid holds; a genuinely unpaid one still expires and frees its seat.');
    }

    /* ----------------------------------------------------------------- write + sum */
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(RESULTS, JSON.stringify({
        ranAt: new Date().toISOString(), target: SITE, account, passed, failed,
        lostWebhookReconciled: !!(results[0] && results[0].fixVerified),
        scenarios: results,
    }, null, 2) + '\n');

    console.log('\n' + '='.repeat(70));
    console.log('  passed ' + passed + '   failed ' + failed);
    console.log('  lost-webhook slot fix: ' + (results[0] && results[0].fixVerified ? 'VERIFIED (paid order reconciled, seat kept)' : 'NOT verified'));
    console.log('  written to ' + path.relative(ROOT, RESULTS));
    console.log('='.repeat(70));

    console.log('\ncleaning up seeded rows…');
    await resetSeed();
    console.log('done. (The connected account is left as-is; the payments seeder normalises its balance.)');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('\nexperience scenarios failed to run:', err && (err.stack || err.message));
    process.exit(1);
});
