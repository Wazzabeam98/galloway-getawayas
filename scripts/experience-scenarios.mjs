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
// creates the PaymentIntent directly with the IDENTICAL fields the route sets —
// since 30 Sep 2026 a charge ON BEHALF OF the provider (on_behalf_of, so they
// are the seller and their name is on the statement; capture_method + metadata,
// with the funds_flow 'held' marker and our frozen fee; no transfer_data or
// application fee — the money is held by us and paid to the provider by the
// experience-payouts run the day after the experience) — and — for the order row
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

// The guest's money, as the routes now take it: a charge on behalf of the
// provider (lib/experienceFunds heldChargeSeller — they are the seller) whose
// money is held by us (heldChargeMetadata; no transfer_data, no application
// fee). `capture: 'manual'` is the request shape's held card; omit it for the
// slot shape's instant charge.
async function guestPI({ total, account, capture, metadata, pm = 'pm_card_visa' }) {
    const { amountPence, feePence } = priceParts(total);
    const body = {
        amount: amountPence,
        currency: 'gbp',
        payment_method: pm,
        payment_method_types: ['card'],
        confirm: 'true',
        // No account: a provider still setting up Stripe — sold as us (no
        // on_behalf_of), exactly as lib/experienceFunds heldChargeSeller does.
        ...(account ? { on_behalf_of: account } : {}),
        description: EXP_TAG + (account ? ' held charge on behalf of the provider' : ' held charge, sold as the platform (provider not set up yet)'),
        metadata: { funds_flow: 'held', platform_fee_pence: String(feePence), ...(metadata || {}) },
    };
    if (capture) body.capture_method = capture;
    return stripe.request('POST', '/payment_intents', body);
}

// The OLD flow, kept for the legacy-order scenario only: a destination charge
// exactly as every order before 30 Sep 2026 was made — on_behalf_of, the
// application fee and the transfer to the provider all on the charge.
async function legacyDestinationPI({ total, account, capture, metadata, pm = 'pm_card_visa' }) {
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
        description: EXP_TAG + ' legacy destination charge',
        metadata: metadata || {},
    };
    if (capture) body.capture_method = capture;
    return stripe.request('POST', '/payment_intents', body);
}

// THE SELLER. On a held charge the provider — not Galloway Getaways — is the
// settlement merchant: the charge names their account in on_behalf_of, and the
// statement descriptor Stripe works out for the guest's card statement is
// theirs, not ours. Read from Stripe itself, not from anything we sent.
let platformDescriptor = null;
async function sellerIsProvider(charge, account) {
    if (platformDescriptor === null) {
        const me = await stripe.request('GET', '/account');
        platformDescriptor = String((me && me.settings && me.settings.payments && me.settings.payments.statement_descriptor) || '').toUpperCase();
    }
    const acct = await stripe.request('GET', '/accounts/' + account);
    const theirs = String((acct && acct.settings && acct.settings.payments && acct.settings.payments.statement_descriptor) || '').toUpperCase();
    const shown = String((charge && charge.calculated_statement_descriptor) || '').toUpperCase();
    const onBehalf = charge && charge.on_behalf_of === account;
    const named = !!shown && (theirs ? shown.indexOf(theirs) === 0 : true) && (!platformDescriptor || shown.indexOf(platformDescriptor) !== 0);
    return { ok: onBehalf && named, detail: 'on_behalf_of=' + (charge && charge.on_behalf_of) + ' statement="' + shown + '" provider="' + theirs + '" platform="' + platformDescriptor + '"' };
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
async function settledCharge(piId, { needTransfer = false, tries = 12, gapMs = 2000 } = {}) {
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
function sessionForServiceOrder({ pi, total, provider, guest, booking, serviceDate, item, legacy = false }) {
    // A held order's session carries the flow marker and our frozen fee; a
    // legacy (pre-30-Sep) session carried neither.
    const flow = legacy ? {} : { funds_flow: 'held', platform_fee_pence: String(priceParts(total).feePence) };
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
            ...flow,
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
        await db.remove('service_order_refunds', '?provider_id=eq.' + p.id);
        await db.remove('service_orders', '?provider_id=eq.' + p.id);
        await db.remove('slot_sessions', '?provider_id=eq.' + p.id);
        await db.remove('slot_availability', '?provider_id=eq.' + p.id);
        await db.remove('slot_blocks', '?provider_id=eq.' + p.id);
        await db.remove('service_provider_items', '?provider_id=eq.' + p.id);
        // An enquiry against a seeded provider (made by a walkthrough on the
        // shared test project) restricts the provider's delete.
        await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
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
        // Placed, so a provider who travels (comes_to_you) can be checked as
        // reaching it — the delivery-reach gate added 25 Sep refuses an
        // unplaceable cottage.
        postcode: 'DG7 1AA', latitude: 54.942865, longitude: -3.927194,
    });
    // A stay that spans every service date the scenarios use.
    const [booking] = await db.insert('bookings', {
        listing_id: listing.id, guest_id: guest.id, host_id: host.id,
        check_in: dayOffset(1), check_out: dayOffset(25), guests: 8, adults: 8,
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
    // A per-person chef item — used for the change-count (down = refund, up =
    // request) scenarios, which price by head.
    const [chefPerson] = await db.insert('service_provider_items', {
        provider_id: chef.id, name: 'Chef per head', description: 'Per person',
        price: 55, unit: 'person', active: true, sort_order: 1,
    });
    // A flat item with EXTRA-GUESTS pricing — £220 for up to 4, +£40/adult.
    const [chefEG] = await db.insert('service_provider_items', {
        provider_id: chef.id, name: 'Whole dinner', description: 'Group price',
        price: 220, unit: 'flat', active: true, sort_order: 2,
        included_guests: 4, extra_adult_fee: 40, extra_child_fee: 15, max_party: 8,
    });

    // The made-to-order provider (a baker — a cart of items; standard books
    // instantly, custom is a request).
    const [baker] = await db.insert('service_providers', {
        owner_id: owner.id, business_name: 'EXP Bakehouse', trade: 'baker', audience: 'guest',
        status: 'approved', plan: 'commission', commission_rate: 0.10,
        shape: 'made_to_order', exclusive_per_date: false, fulfilment: 'collection',
        cancellation_window_hours: 48, lead_time_days: 1, contact_email: 'owner@' + EXP_DOMAIN,
        stripe_account_id: account, stripe_payouts_enabled: true,
        stripe_charges_enabled: true, stripe_details_submitted: true,
    });
    const [bakerStd] = await db.insert('service_provider_items', {
        provider_id: baker.id, name: 'Box of bakes', description: 'Off the shelf',
        price: 24, unit: 'flat', active: true, sort_order: 0, is_custom: false,
    });
    const [bakerStd2] = await db.insert('service_provider_items', {
        provider_id: baker.id, name: 'Traybake', description: 'Each',
        price: 8, unit: 'item', active: true, sort_order: 1, is_custom: false,
    });
    const [bakerCustom] = await db.insert('service_provider_items', {
        provider_id: baker.id, name: 'Celebration cake', description: 'Made to your design',
        price: 42, unit: 'flat', active: true, sort_order: 2, is_custom: true,
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

    // A PER-PERSON slot provider (a yoga class — shared table, capacity 6). This
    // is the only shape "add guests" exists for: each seat is a separately paid
    // place, and a top-up buys more of them on the same session.
    const [yoga] = await db.insert('service_providers', {
        owner_id: owner.id, business_name: 'EXP Yoga', trade: 'yoga', audience: 'guest',
        status: 'approved', plan: 'commission', commission_rate: 0.10,
        shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60,
        slot_capacity: 6, slot_min_people: 1,
        cancellation_window_hours: 12, contact_email: 'owner@' + EXP_DOMAIN,
        stripe_account_id: account, stripe_payouts_enabled: true,
        stripe_charges_enabled: true, stripe_details_submitted: true,
    });
    const [yogaItem] = await db.insert('service_provider_items', {
        provider_id: yoga.id, name: 'Sunrise yoga class', description: 'Per person, up to 6',
        price: 20, unit: 'person', active: true, sort_order: 0, capacity: 6, min_people: 1,
    });
    for (let d = 0; d < 7; d++) {
        await db.insert('slot_availability', {
            provider_id: yoga.id, day_of_week: d, open_time: '09:00', close_time: '17:00',
        });
    }

    console.log('  guest=' + guest.id.slice(0, 8) + ' chef=' + chef.id.slice(0, 8)
        + ' sauna=' + sauna.id.slice(0, 8) + ' yoga=' + yoga.id.slice(0, 8) + ' account=' + account);

    const guestCookie = await asUser('guest');
    const ownerCookie = await asUser('owner');
    // A director, for the admin refund (scenarios 25–29). is_admin is set with
    // the service key, as the journeys seeder does.
    const director = await createUser('director', 'Exp Director');
    await db.update('profiles', '?id=eq.' + director.id, { is_admin: true });
    const adminCookie = await asUser('director');

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
        const pi = await guestPI({
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
        check('STRIPE: the money is HELD by us — no transfer and no application fee at payment',
            charge && !charge.transfer && !charge.application_fee,
            'fee=' + (charge && charge.application_fee) + ' transfer=' + (charge && charge.transfer));
        {
            const seller = await sellerIsProvider(charge, account);
            check('STRIPE: the provider is the seller — the charge is on their behalf and their name is on the statement', seller.ok, seller.detail);
        }
        check('APP: the order is marked held with our frozen £6 fee', afterOrder.funds_flow === 'held' && Number(afterOrder.platform_fee) === 6,
            afterOrder.funds_flow + ' fee £' + afterOrder.platform_fee);
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
    scenario('2', 'Request-and-confirm (chef): held on request, captured on confirm — to us, not yet to the provider');
    {
        const serviceDate = dayOffset(5);
        // The real entry route builds a valid Checkout (proves pricing + gates).
        const started = await postRoute('/api/services/order', guestCookie, {
            itemId: chefItem.id, bookingId: booking.id, serviceDate, quantity: 1,
        });
        check('services/order accepted and returned a Checkout url', started.status === 200 && started.body.ok && !!started.body.url,
            'HTTP ' + started.status + ' ' + JSON.stringify(started.body).slice(0, 160));

        // The guest pays: a HELD card (manual capture), real destination charge.
        const pi = await guestPI({
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
        check('STRIPE: captured to the platform — no transfer to the provider at confirm, no application fee',
            charge && !charge.transfer && !charge.application_fee, 'fee=' + (charge && charge.application_fee) + ' transfer=' + (charge && charge.transfer));
        {
            const seller = await sellerIsProvider(charge, account);
            check('STRIPE: the provider is the seller — the charge is on their behalf and their name is on the statement', seller.ok, seller.detail);
        }
        check('APP: the order is confirmed, held, with our £18 fee frozen', afterOrder.status === 'confirmed' && afterOrder.funds_flow === 'held' && Number(afterOrder.platform_fee) === 18,
            afterOrder.status + ' ' + afterOrder.funds_flow + ' £' + afterOrder.platform_fee);
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

        const pi = await guestPI({
            total: 60, account, capture: null,
            metadata: { kind: 'slot_order', order_id: hold.id, provider_id: sauna.id, booking_id: booking.id },
        });
        check('STRIPE: charged immediately (succeeded)', pi.status === 'succeeded', pi.status);
        const charge = await settledCharge(pi.id);
        check('STRIPE: held by us — no transfer, no application fee', charge && !charge.transfer && !charge.application_fee,
            'fee=' + (charge && charge.application_fee) + ' transfer=' + (charge && charge.transfer));
        {
            const seller = await sellerIsProvider(charge, account);
            check('STRIPE: the provider is the seller — the charge is on their behalf and their name is on the statement', seller.ok, seller.detail);
        }

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
            await guestPI({
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
        const pi = await guestPI({
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
    scenario('6', 'Cancel after payment, inside the window: no refund — the money stays held for the provider’s payout');
    {
        const serviceDate = dayOffset(1); // within 48h of the stay start → inside the free-cancel window
        const pi = await guestPI({
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
        check('STRIPE: nothing was refunded (money stays put)', charge && Number(charge.amount_refunded) === 0, charge && String(charge.amount_refunded));
        check('STRIPE: still held by us — no transfer yet', charge && !charge.transfer, charge && String(charge.transfer));
        const afterOrder = await orderRow(order.id);
        check('APP: the order is cancelled and records the forfeit (cancel_ack)', afterOrder.status === 'cancelled' && !!afterOrder.cancel_ack, afterOrder.status);
        note('The walk-away keeps the order payable: the payout run pays the provider their 90% the day after the date (cancel_ack marks it kept). A policy choice for the solicitor.');
    }

    /* =================================================== 7. REFUND + COMMISSION UNWIND */
    scenario('7', 'Refund before payout: full refund to the guest from the money we hold — no transfer to reverse');
    {
        const serviceDate = dayOffset(7);
        const pi = await guestPI({
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
        let charge = null;
        for (let i = 0; i < 6; i++) {
            charge = await chargeOf(pi.id);
            if (charge && Number(charge.amount_refunded) === 18000) break;
            await sleep(1000);
        }
        const refunds = await stripe.request('GET', '/refunds?payment_intent=' + pi.id);
        const r0 = refunds && refunds.data && refunds.data[0];
        check('STRIPE: the guest was refunded in full (£180)', charge && Number(charge.amount_refunded) === 18000, charge && String(charge.amount_refunded));
        check('STRIPE: a plain refund from us — no transfer existed, none reversed', charge && !charge.transfer && r0 && !r0.transfer_reversal,
            'transfer=' + (charge && charge.transfer) + ' reversal=' + (r0 && r0.transfer_reversal));
        check('APP: the order is refunded', (await orderRow(order.id)).status === 'refunded', null);
        note('Our 10% goes back with it, as before — we simply keep none of a refunded order. No partial-refund path exists for experiences.');
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

    /* ============================ 9. LOST WEBHOOK ON A REQUEST — RECONCILED (the fix) */
    // The request shape's version of scenario 1. A request holds the card and
    // writes NO row until checkout.session.completed lands; if that webhook is
    // lost the order never exists, the provider is never told, and the hold
    // lapses ~7 days later with the guest thinking they booked. The sweep must
    // now RECONCILE against Stripe: find the held request PI that has no order and
    // rebuild the authorised order from the metadata the PI carries — the same
    // way the slot sweep rescues a paid hold, one shape along.
    scenario('9', 'Lost webhook on a request (chef): the sweep reconciles against Stripe — rebuilds the authorised order, hold kept');
    {
        const serviceDate = dayOffset(9);   // a chef date no other scenario uses
        // The guest's held card, born the way the Checkout page would — a manual-
        // capture destination charge carrying the FULL order shape the route now
        // puts on the PaymentIntent (not just kind/provider/booking), so the sweep
        // can rebuild from the PI alone.
        const pi = await guestPI({
            total: 180, account, capture: 'manual',
            metadata: {
                kind: 'service_order', provider_id: chef.id, booking_id: booking.id,
                guest_id: guest.id, listing_id: booking.listing_id || '',
                service_date: serviceDate, guests: String(booking.guests ?? ''),
                commission_rate: '0.1', note: '', allergy: '',
                item_id: chefItem.id, item_name: chefItem.name, item_description: chefItem.description || '',
                item_unit: 'flat', unit_price: '180', quantity: '1',
            },
        });
        check('the card is HELD not charged (requires_capture)', pi.status === 'requires_capture', pi.status);

        // The confirming webhook is LOST — a mis-signed delivery, rejected, so
        // nothing records the order. This is the fault the fix rescues.
        const wh = await postWebhook(
            sessionForServiceOrder({ pi: pi.id, total: 180, provider: chef, guest, booking, serviceDate, item: chefItem }),
            { secret: 'whsec_wrong_' + Date.now() },
        );
        check('the mis-signed webhook was rejected (400)', wh.status === 400, 'HTTP ' + wh.status);
        const before = await db.select('service_orders', '?select=id&stripe_payment_intent_id=eq.' + pi.id);
        check('APP: no order row exists yet (the webhook never landed)', before.length === 0, before.length + ' row(s)');

        // The sweep runs and reconciles: the held request PI with no order is
        // rebuilt to an authorised order.
        const swept = await runOrderSweep();
        check('the sweep ran', swept.status === 200 && swept.body.ok, JSON.stringify(swept.body).slice(0, 160));
        check('the sweep reported a rebuild', Number(swept.body.rebuilt) >= 1, 'rebuilt=' + swept.body.rebuilt);

        const rows = await db.select('service_orders', '?select=*&stripe_payment_intent_id=eq.' + pi.id);
        const order = rows[0];
        check('APP: an order row now exists (rebuilt from Stripe)', !!order, rows.length + ' row(s)');
        check('APP: it is authorised, awaiting the provider', order && order.status === 'authorised', order && order.status);
        check('APP: it carries the held PaymentIntent', order && order.stripe_payment_intent_id === pi.id, order && order.stripe_payment_intent_id);
        check('APP: it belongs to the right guest and provider',
            order && order.guest_id === guest.id && order.provider_id === chef.id, order && (order.guest_id + '/' + order.provider_id));

        const afterPI = await getPI(pi.id);
        check('STRIPE: the hold is still LIVE (requires_capture — nothing captured early, nothing lost)',
            afterPI.status === 'requires_capture', afterPI.status);

        // And the recovered order is a real, completable booking — the provider
        // confirms and the held card captures, exactly as it would have without
        // the lost webhook.
        const resp = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        check('the recovered order can be confirmed and captured',
            resp.status === 200 && resp.body.status === 'confirmed',
            'HTTP ' + resp.status + ' ' + JSON.stringify(resp.body).slice(0, 120));
        const charge = await settledCharge(pi.id);
        check('STRIPE: the hold was captured on confirm (£180)',
            charge && charge.captured === true && charge.amount_captured === 18000,
            charge && (charge.captured + ' ' + charge.amount_captured));

        current.fixVerified = !!(order && order.status === 'authorised' && afterPI.status === 'requires_capture');
        note('FIXED: a request order whose webhook was lost is rebuilt to authorised by the sweep — the provider is told and the held card is intact.');
    }

    /* ============================================= 10. ADD GUESTS (per-person top-up) */
    // Buying more places on a per-person session already booked. Each added place
    // is a CHILD order on the same session (parent_order_id), its own charge and
    // its own seats, reusing the slot machine. Four things are proved with real
    // money: the seat CAS (two racing top-ups, one wins), an abandoned top-up
    // swept and released, a full cancel that refunds BOTH PaymentIntents and frees
    // BOTH seat claims (read back from Stripe), and the invite cap rising on confirm.
    scenario('10', 'Add guests: child-order top-up — race, abandon+sweep, cancel refunds both PIs + both seats, invite cap rises');
    {
        // Pay a slot order for real and confirm it through the webhook, the way a
        // completed Checkout would. Works for a parent booking and for a top-up
        // child alike — both carry kind:'slot_order' and their own order_id.
        const payAndConfirm = async (orderId, total) => {
            const pi = await guestPI({
                total, account, capture: null,
                metadata: { kind: 'slot_order', order_id: orderId, provider_id: yoga.id },
            });
            await postWebhook({
                object: 'checkout_session', payment_status: 'no_payment_required',
                payment_intent: pi.id, amount_total: Math.round(total * 100),
                customer_email: guest.email, customer_details: { email: guest.email },
                metadata: { kind: 'slot_order', order_id: orderId, provider_id: yoga.id },
            });
            return pi;
        };
        const latestChild = async (parentId) => (await db.select('service_orders',
            '?select=*&parent_order_id=eq.' + parentId + '&order=created_at.desc&limit=1'))[0];

        // ---- A. RACE: two top-ups for the last seat, only one wins -------------
        {
            const sessionDate = dayOffset(10);
            const book = await postRoute('/api/services/slots/book', guestCookie, {
                providerId: yoga.id, bookingId: booking.id, sessionDate, sessionTime: '09:00', quantity: 5,
            });
            check('A: booked 5 of 6 places', book.status === 200 && book.body.ok, 'HTTP ' + book.status);
            const parent = (await db.select('service_orders',
                '?select=*&provider_id=eq.' + yoga.id + '&service_date=eq.' + sessionDate + '&service_time=eq.09:00:00&parent_order_id=is.null&order=created_at.desc&limit=1'))[0];
            await payAndConfirm(parent.id, 100);
            check('A: the parent is confirmed', (await orderRow(parent.id)).status === 'confirmed', null);

            // Two tabs top up +1 at the same instant; the session has one seat left.
            const [r1, r2] = await Promise.all([
                postRoute('/api/services/slots/top-up', guestCookie, { orderId: parent.id, quantity: 1 }),
                postRoute('/api/services/slots/top-up', guestCookie, { orderId: parent.id, quantity: 1 }),
            ]);
            const wins = [r1, r2].filter((r) => r.status === 200 && r.body.ok).length;
            const losses = [r1, r2].filter((r) => r.status === 409).length;
            check('A: exactly one top-up won the last seat', wins === 1 && losses === 1,
                'r1=' + r1.status + ' r2=' + r2.status);
            const sess = (await db.select('slot_sessions', '?select=*&provider_id=eq.' + yoga.id + '&session_date=eq.' + sessionDate + '&session_time=eq.09:00:00'))[0];
            check('A: the session is full (seats_taken = 6), never oversold', sess && sess.seats_taken === 6, sess && String(sess.seats_taken));
        }

        // ---- B. ABANDONED top-up is swept and its seats released ----------------
        {
            const sessionDate = dayOffset(10);
            const book = await postRoute('/api/services/slots/book', guestCookie, {
                providerId: yoga.id, bookingId: booking.id, sessionDate, sessionTime: '11:00', quantity: 1,
            });
            check('B: booked 1 place', book.status === 200 && book.body.ok, 'HTTP ' + book.status);
            const parent = (await db.select('service_orders',
                '?select=*&provider_id=eq.' + yoga.id + '&service_date=eq.' + sessionDate + '&service_time=eq.11:00:00&parent_order_id=is.null&order=created_at.desc&limit=1'))[0];
            await payAndConfirm(parent.id, 20);

            const top = await postRoute('/api/services/slots/top-up', guestCookie, { orderId: parent.id, quantity: 1 });
            check('B: top-up accepted (holding child + Checkout)', top.status === 200 && top.body.ok, 'HTTP ' + top.status);
            const child = await latestChild(parent.id);
            check('B: a holding child order exists', child && child.status === 'holding', child && child.status);
            const sessBefore = (await db.select('slot_sessions', '?select=*&id=eq.' + child.slot_session_id))[0];
            check('B: the added seat was claimed (seats_taken = 2)', sessBefore.seats_taken === 2, String(sessBefore.seats_taken));

            // Never paid — age the hold and sweep. No PI carries this order_id.
            await db.update('service_orders', '?id=eq.' + child.id, { expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
            const swept = await runOrderSweep();
            check('B: the sweep ran', swept.status === 200 && swept.body.ok, JSON.stringify(swept.body).slice(0, 120));
            check('B: the abandoned child is EXPIRED', (await orderRow(child.id)).status === 'expired', null);
            const sessAfter = (await db.select('slot_sessions', '?select=*&id=eq.' + child.slot_session_id))[0];
            check('B: the added seat was released (back to 1)', sessAfter.seats_taken === 1, String(sessAfter.seats_taken));
        }

        // ---- C. CANCEL refunds BOTH PaymentIntents and frees BOTH seat claims ---
        //    plus D: the invite cap rises when the top-up confirms.
        {
            const sessionDate = dayOffset(11);   // >12h out → inside the FREE-cancel window
            const book = await postRoute('/api/services/slots/book', guestCookie, {
                providerId: yoga.id, bookingId: booking.id, sessionDate, sessionTime: '14:00', quantity: 2,
            });
            check('C: booked 2 places', book.status === 200 && book.body.ok, 'HTTP ' + book.status);
            const parent = (await db.select('service_orders',
                '?select=*&provider_id=eq.' + yoga.id + '&service_date=eq.' + sessionDate + '&service_time=eq.14:00:00&parent_order_id=is.null&order=created_at.desc&limit=1'))[0];
            const piParent = await payAndConfirm(parent.id, 40);
            check('C: the parent is confirmed', (await orderRow(parent.id)).status === 'confirmed', null);

            // D (before): the invite cap on a confirmed 2-seat order is 1.
            const capBefore = await postRoute('/api/booking-guests', guestCookie, { action: 'ensure-seats', orderId: parent.id });
            check('D: invite cap is 1 before the top-up (2 seats − the booker)', capBefore.body && capBefore.body.capacity === 1,
                'capacity=' + (capBefore.body && capBefore.body.capacity));
            // The RPC itself minted one seat row (proves ensure_order_seats reads
            // the per-person quantity, not attendees — which was NULL, capping at 0).
            check('D: ensure_order_seats minted 1 seat row for the 2-seat order',
                capBefore.body && Array.isArray(capBefore.body.seats) && capBefore.body.seats.length === 1,
                'seats=' + (capBefore.body && capBefore.body.seats && capBefore.body.seats.length));

            // Top up +1 and pay it — its own PI.
            const top = await postRoute('/api/services/slots/top-up', guestCookie, { orderId: parent.id, quantity: 1 });
            check('C: top-up accepted', top.status === 200 && top.body.ok, 'HTTP ' + top.status);
            const child = await latestChild(parent.id);
            const piChild = await payAndConfirm(child.id, 20);
            check('C: the top-up child is confirmed', (await orderRow(child.id)).status === 'confirmed', null);
            check('C: the parent total was NOT rewritten (still £40)', Number((await orderRow(parent.id)).price) === 40, String((await orderRow(parent.id)).price));

            // D (after): a confirmed top-up raises the cap to 2 (3 seats − the booker).
            const capAfter = await postRoute('/api/booking-guests', guestCookie, { action: 'ensure-seats', orderId: parent.id });
            check('D: invite cap rose to 2 after the top-up confirmed', capAfter.body && capAfter.body.capacity === 2,
                'capacity=' + (capAfter.body && capAfter.body.capacity));
            check('D: ensure_order_seats minted a 2nd seat row once the top-up confirmed (family = 3 − booker)',
                capAfter.body && Array.isArray(capAfter.body.seats) && capAfter.body.seats.length === 2,
                'seats=' + (capAfter.body && capAfter.body.seats && capAfter.body.seats.length));

            const sessFull = (await db.select('slot_sessions', '?select=*&provider_id=eq.' + yoga.id + '&session_date=eq.' + sessionDate + '&session_time=eq.14:00:00'))[0];
            check('C: the session holds all 3 seats', sessFull.seats_taken === 3, String(sessFull.seats_taken));

            // Cancel the whole booking, inside the free window → full refund of BOTH.
            const cancel = await postRoute('/api/services/orders/cancel', guestCookie, { orderId: parent.id });
            check('C: cancel refunded (free window)', cancel.status === 200 && cancel.body.status === 'refunded',
                'HTTP ' + cancel.status + ' ' + JSON.stringify(cancel.body).slice(0, 120));

            // READ BACK FROM STRIPE: both charges refunded in full, from the money
            // we hold — neither ever had a transfer to reverse.
            const settle = async (piId, wantPence) => {
                let charge = null;
                for (let i = 0; i < 6; i++) {
                    charge = await chargeOf(piId);
                    if (charge && Number(charge.amount_refunded) === wantPence) break;
                    await sleep(1000);
                }
                return { charge };
            };
            const pr = await settle(piParent.id, 4000);
            const cr = await settle(piChild.id, 2000);
            check('C: STRIPE — the original £40 was refunded, from the held money (no transfer)',
                pr.charge && Number(pr.charge.amount_refunded) === 4000 && !pr.charge.transfer,
                pr.charge && ('refunded=' + pr.charge.amount_refunded + ' transfer=' + pr.charge.transfer));
            check('C: STRIPE — the added £20 refunded SEPARATELY, from the held money',
                cr.charge && Number(cr.charge.amount_refunded) === 2000 && !cr.charge.transfer,
                cr.charge && ('refunded=' + cr.charge.amount_refunded + ' transfer=' + cr.charge.transfer));
            check('C: APP — the parent and the top-up are both held orders', (await orderRow(parent.id)).funds_flow === 'held' && (await orderRow(child.id)).funds_flow === 'held', null);

            check('C: APP — both orders are refunded', (await orderRow(parent.id)).status === 'refunded' && (await orderRow(child.id)).status === 'refunded', null);
            const sessFreed = (await db.select('slot_sessions', '?select=*&provider_id=eq.' + yoga.id + '&session_date=eq.' + sessionDate + '&session_time=eq.14:00:00'))[0];
            check('C: BOTH seat claims were released (seats_taken back to 0)', sessFreed.seats_taken === 0, String(sessFreed.seats_taken));
        }
        note('Add-guests reuses the slot machine: child order per added place, its own PI and seats, confirmed by the same webhook, swept if unpaid; a full cancel settles the whole family.');
    }

    /* ============================== 11. MOVE a slot booking (and its family) to another session */
    // A confirmed per-person booking plus a confirmed top-up child = one family
    // of three paid seats on a session. Moving it is ALL-OR-NOTHING: either the
    // whole family lands on the new session, or nobody moves and the old session
    // is untouched. Proven here with real test money on the shelf (the seats were
    // paid for), moving between sessions on the yoga provider (capacity 6, 12h
    // window). The provider-email content (naming BOTH times) is asserted by the
    // unit test tests/experience-move.test.ts; here we prove the move path carries
    // both the old and the new time to that notification.
    scenario('11', 'Move a booking: the whole family (parent + top-up) moves together, or nobody does; a full target and a past-cutoff target are both refused');
    {
        const payAndConfirm = async (orderId, total) => {
            const pi = await guestPI({
                total, account, capture: null,
                metadata: { kind: 'slot_order', order_id: orderId, provider_id: yoga.id },
            });
            await postWebhook({
                object: 'checkout_session', payment_status: 'no_payment_required',
                payment_intent: pi.id, amount_total: Math.round(total * 100),
                customer_email: guest.email, customer_details: { email: guest.email },
                metadata: { kind: 'slot_order', order_id: orderId, provider_id: yoga.id },
            });
            return pi;
        };
        const latestChild = async (parentId) => (await db.select('service_orders',
            '?select=*&parent_order_id=eq.' + parentId + '&order=created_at.desc&limit=1'))[0];
        const sessAt = async (date, time) => (await db.select('slot_sessions',
            '?select=*&provider_id=eq.' + yoga.id + '&session_date=eq.' + date + '&session_time=eq.' + time))[0];
        // A declared target session created up front, the way a class exists before
        // anyone books it — a real, capacity-bearing move target.
        const declareSession = async (date, time, seatsTaken) => (await db.insert('slot_sessions', {
            provider_id: yoga.id, session_date: date, session_time: time,
            capacity: 6, seats_taken: seatsTaken, private: false, declared: true,
            title: 'Declared ' + time, duration_minutes: 60, turnaround_minutes: 0,
        }))[0];

        // Build a paid family of THREE seats (parent 2 + top-up 1) on session A.
        const buildFamily = async (date, time, parentTotal) => {
            const book = await postRoute('/api/services/slots/book', guestCookie, {
                providerId: yoga.id, bookingId: booking.id, sessionDate: date, sessionTime: time, quantity: 2,
            });
            if (!(book.status === 200 && book.body.ok)) return { book, ok: false };
            const parent = (await db.select('service_orders',
                '?select=*&provider_id=eq.' + yoga.id + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00&parent_order_id=is.null&order=created_at.desc&limit=1'))[0];
            await payAndConfirm(parent.id, parentTotal);
            const top = await postRoute('/api/services/slots/top-up', guestCookie, { orderId: parent.id, quantity: 1 });
            const child = await latestChild(parent.id);
            await payAndConfirm(child.id, 20);
            return { book, top, parent, child, ok: true };
        };

        // ---- A. THE WHOLE FAMILY MOVES TOGETHER --------------------------------
        // Dates dayOffset(6)/(7) are used only by this scenario — scenario 10's
        // yoga sessions sit on dayOffset(10)/(11), so these don't collide with a
        // session it already filled.
        if (true) {
            const fromDate = dayOffset(6), fromTime = '09:00';
            const toDate = dayOffset(6), toTime = '10:00';
            const fam = await buildFamily(fromDate, fromTime, 40);
            check('A: paid family of 3 built (parent 2 + top-up 1)',
                fam.ok && (await orderRow(fam.parent.id)).status === 'confirmed' && (await orderRow(fam.child.id)).status === 'confirmed',
                'book HTTP ' + (fam.book && fam.book.status));
            if (!fam.ok) { note('A: could not build the family — skipping the move checks'); }
            else {
            const srcId = fam.parent.slot_session_id;
            const src0 = await sessAt(fromDate, fromTime + ':00');
            check('A: the source holds all 3 seats before the move', src0 && src0.seats_taken === 3, src0 && String(src0.seats_taken));

            const dest = await declareSession(toDate, toTime + ':00', 0);

            const mv = await postRoute('/api/services/slots/move', guestCookie, {
                orderId: fam.parent.id, sessionDate: toDate, sessionTime: toTime,
            });
            check('A: move succeeded', mv.status === 200 && mv.body.ok, 'HTTP ' + mv.status + ' ' + JSON.stringify(mv.body).slice(0, 120));
            check('A: the WHOLE family moved (2 rows, 3 seats)', mv.body.moved === 2 && mv.body.seats === 3,
                'moved=' + mv.body.moved + ' seats=' + mv.body.seats);
            // Both the old and the new time are carried to the provider notice.
            check('A: the move names BOTH times (old → new)',
                mv.body.from && mv.body.from.time === '09:00' && mv.body.serviceTime === '10:00',
                'from=' + JSON.stringify(mv.body.from) + ' to=' + mv.body.serviceTime);

            const p = await orderRow(fam.parent.id), c = await orderRow(fam.child.id);
            check('A: parent repointed to the new session, re-dated, and stamped',
                p.slot_session_id === dest.id && String(p.service_time).slice(0, 5) === '10:00'
                && p.moved_from_session_id === srcId && p.move_count === 1,
                'session=' + (p.slot_session_id === dest.id) + ' time=' + p.service_time + ' from=' + (p.moved_from_session_id === srcId) + ' count=' + p.move_count);
            check('A: the top-up child rode along (same new session, stamped)',
                c.slot_session_id === dest.id && c.moved_from_session_id === srcId && c.move_count === 1, null);
            const srcAfter = await sessAt(fromDate, fromTime + ':00');
            const destAfter = (await db.select('slot_sessions', '?select=*&id=eq.' + dest.id))[0];
            check('A: the source released all 3 seats', srcAfter.seats_taken === 0, String(srcAfter.seats_taken));
            check('A: the target claimed all 3 seats', destAfter.seats_taken === 3, String(destAfter.seats_taken));
            }
        }

        // ---- B. A TARGET WITHOUT ROOM LEAVES EVERYONE UNTOUCHED -----------------
        if (true) {
            const fromDate = dayOffset(7), fromTime = '09:00';
            const toDate = dayOffset(7), toTime = '10:00';
            const fam = await buildFamily(fromDate, fromTime, 40);
            check('B: paid family of 3 built on a second session',
                fam.ok && (await orderRow(fam.parent.id)).status === 'confirmed' && (await orderRow(fam.child.id)).status === 'confirmed', null);
            if (!fam.ok) { note('B: could not build the family — skipping the move checks'); }
            else {
            const srcId = fam.parent.slot_session_id;

            // A declared target with only 2 of its 6 seats free — the family of 3
            // cannot fit.
            const dest = await declareSession(toDate, toTime + ':00', 4);

            const mv = await postRoute('/api/services/slots/move', guestCookie, {
                orderId: fam.parent.id, sessionDate: toDate, sessionTime: toTime,
            });
            check('B: the move was REFUSED (no room for the whole family)', mv.status === 409 && !mv.body.ok, 'HTTP ' + mv.status);
            const p = await orderRow(fam.parent.id), c = await orderRow(fam.child.id);
            check('B: the family did NOT move (still on the source, never stamped)',
                p.slot_session_id === srcId && c.slot_session_id === srcId
                && p.move_count === 0 && c.move_count === 0 && p.moved_from_session_id === null,
                'p.session=' + (p.slot_session_id === srcId) + ' count=' + p.move_count);
            const srcAfter = await sessAt(fromDate, fromTime + ':00');
            const destAfter = (await db.select('slot_sessions', '?select=*&id=eq.' + dest.id))[0];
            check('B: the source is untouched (still 3 seats)', srcAfter.seats_taken === 3, String(srcAfter.seats_taken));
            check('B: the full target is untouched (still 4 seats)', destAfter.seats_taken === 4, String(destAfter.seats_taken));

            // ---- C. A TARGET PAST ITS OWN CUTOFF IS REFUSED --------------------
            // Reuse the same untouched family. A target session that has already
            // started (yesterday) is inside its own free-cancel window, so moving
            // INTO it is refused — and again nobody moves.
            const pastDate = dayOffset(-1), pastTime = '10:00';
            const pastDest = await declareSession(pastDate, pastTime + ':00', 0);
            const mvPast = await postRoute('/api/services/slots/move', guestCookie, {
                orderId: fam.parent.id, sessionDate: pastDate, sessionTime: pastTime,
            });
            check('C: a move into a slot past its own cutoff is REFUSED', mvPast.status === 409 && !mvPast.body.ok, 'HTTP ' + mvPast.status);
            const p2 = await orderRow(fam.parent.id), c2 = await orderRow(fam.child.id);
            check('C: the family still did NOT move', p2.slot_session_id === srcId && c2.slot_session_id === srcId && p2.move_count === 0, null);
            const pastAfter = (await db.select('slot_sessions', '?select=*&id=eq.' + pastDest.id))[0];
            check('C: the past-cutoff target claimed nobody', pastAfter.seats_taken === 0, String(pastAfter.seats_taken));
            }
        }
        note('The move is one atomic RPC: it locks the family and both sessions, re-checks capacity and the cutoff under lock, then claims the target and releases the source — or raises and rolls the whole thing back, leaving the source exactly as it was.');
    }

    // A confirmed per-person chef order for `qty` on `serviceDate`, £55/head.
    async function confirmedChefOrder(serviceDate, qty, pm) {
        const total = 55 * qty;
        const pi = await guestPI({ total, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id }, ...(pm ? { pm } : {}) });
        const base = sessionForServiceOrder({ pi: pi.id, total, provider: chef, guest, booking, serviceDate, item: chefPerson });
        await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'person', unit_price: '55', quantity: String(qty), adults: String(qty), children: '0' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        return { order, pi };
    }

    // A CONFIRMED extra-guests flat order (the chef's £220-for-4 dinner). A party
    // above the included four pays the per-adult fee (party 6 → £300).
    async function confirmedChefEGOrder(serviceDate, adults) {
        const total = 220 + Math.max(0, adults - 4) * 40;
        const pi = await guestPI({ total, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id } });
        const base = sessionForServiceOrder({ pi: pi.id, total, provider: chef, guest, booking, serviceDate, item: chefEG });
        await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'flat', unit_price: String(total), quantity: '1', guests: String(adults), adults: String(adults), children: '0' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        return { order, pi };
    }

    /* ================================================ 12. CHANGE COUNT — DOWN */
    scenario('12', 'Reductions are gone: a lower count is refused and nothing is refunded');
    {
        // Per-person comes-to-you.
        const { order, pi } = await confirmedChefOrder(dayOffset(13), 3);
        const conf = await orderRow(order.id);
        check('a confirmed per-person order, £165 for 3', conf.status === 'confirmed' && Number(conf.price) === 165, conf.status + ' £' + conf.price);
        const red = await postRoute('/api/services/order/change-count', guestCookie, { orderId: order.id, count: 2 });
        check('a per-person reduction is REFUSED (400)', red.status === 400 && !red.body.ok, 'HTTP ' + red.status + ' ' + JSON.stringify(red.body).slice(0, 120));
        const ch = await chargeOf(pi.id);
        check('STRIPE — nothing was refunded', ch && ch.amount_refunded === 0, 'refunded=' + (ch && ch.amount_refunded));
        const after = await orderRow(order.id);
        check('the order is untouched — still £165 for 3, no refund recorded', Number(after.price) === 165 && Number(after.quantity) === 3 && Number(after.amount_refunded) === 0, '£' + after.price + ' q' + after.quantity + ' refunded ' + after.amount_refunded);

        // Extra-guests flat: a smaller party is refused too, and the deleted
        // reduce-and-refund path takes no money.
        const eg = await confirmedChefEGOrder(dayOffset(12), 6);   // £300 for a party of 6
        const egRed = await postRoute('/api/services/order/change-count', guestCookie, { orderId: eg.order.id, count: 4, adults: 4, children: 0 });
        check('an extra-guests reduction is REFUSED (400)', egRed.status === 400 && !egRed.body.ok, 'HTTP ' + egRed.status + ' ' + JSON.stringify(egRed.body).slice(0, 120));
        const egAfter = await orderRow(eg.order.id);
        check('the extra-guests order is untouched — still £300, party 6, nothing refunded', Number(egAfter.price) === 300 && Number(egAfter.attendees) === 6 && Number(egAfter.amount_refunded) === 0, '£' + egAfter.price + ' party ' + egAfter.attendees + ' refunded ' + egAfter.amount_refunded);
        note('Guest-count reductions and the reduce-and-refund path are removed everywhere. To lower a party a guest cancels or messages the provider.');
    }

    /* =========================================== 13. EXTRA GUESTS + PARTY CAP */
    scenario('13', 'Extra-guest fees are charged at booking, and the party is capped at the stay');
    {
        const book6 = await postRoute('/api/services/order', guestCookie, { itemId: chefEG.id, bookingId: booking.id, serviceDate: dayOffset(14), adults: 6, children: 0 });
        check('a party of 6 on the £220-for-4 item is accepted (stay is 8)', book6.status === 200 && book6.body.ok && !!book6.body.url, 'HTTP ' + book6.status + ' ' + JSON.stringify(book6.body).slice(0, 140));
        const pi = await guestPI({ total: 300, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id } });
        const base = sessionForServiceOrder({ pi: pi.id, total: 300, provider: chef, guest, booking, serviceDate: dayOffset(15), item: chefEG });
        await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'flat', unit_price: '300', quantity: '1', guests: '6', adults: '6', children: '0' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + dayOffset(15) + '&order=created_at.desc&limit=1'))[0];
        check('the order records £300 for a party of 6 (220 + 2×£40)', order && Number(order.price) === 300 && Number(order.attendees) === 6, order && ('£' + order.price + ' party ' + order.attendees));
        const book9 = await postRoute('/api/services/order', guestCookie, { itemId: chefEG.id, bookingId: booking.id, serviceDate: dayOffset(16), adults: 9, children: 0 });
        check('a party of 9 is REFUSED — over the stay of 8 / the item max', book9.status === 400 && !book9.body.ok, 'HTTP ' + book9.status);
    }

    /* ============================================ 14. INCREASE = REQUEST, ACCEPTED */
    scenario('14', 'An increase holds the extra on the card; the provider accepts and it is captured');
    {
        const { order } = await confirmedChefOrder(dayOffset(17), 2);
        const up = await postRoute('/api/services/order/change-count', guestCookie, { orderId: order.id, count: 3 });
        check('the increase is a REQUEST — a Checkout hold, not an instant charge', up.status === 200 && up.body.ok && !!up.body.url && up.body.requested === true, 'HTTP ' + up.status + ' ' + JSON.stringify(up.body).slice(0, 140));
        const child = (await db.select('service_orders', '?select=*&parent_order_id=eq.' + order.id + '&order=created_at.desc&limit=1'))[0];
        check('a holding child was written for the extra place (£55)', child && child.status === 'holding' && Number(child.price) === 55, child && (child.status + ' £' + child.price));
        const childPi = await guestPI({ total: 55, account, capture: 'manual', metadata: { kind: 'change_request', order_id: child.id } });
        await postWebhook({ object: 'checkout_session', payment_status: 'no_payment_required', payment_intent: childPi.id, amount_total: 5500, customer_email: guest.email, customer_details: { email: guest.email }, metadata: { kind: 'change_request', order_id: child.id, parent_order_id: order.id, provider_id: chef.id, guest_id: guest.id } });
        const held = await orderRow(child.id);
        check('the completed hold is now AUTHORISED — a request to answer', held.status === 'authorised' && held.stripe_payment_intent_id === childPi.id, held.status);
        const acc = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: child.id, decision: 'confirm' });
        check('accept succeeds', acc.status === 200 && acc.body.ok, 'HTTP ' + acc.status + ' ' + JSON.stringify(acc.body).slice(0, 140));
        const ch = await settledCharge(childPi.id);
        check('STRIPE — the £55 hold was CAPTURED on accept', ch && ch.captured === true && ch.amount_captured === 5500, 'captured=' + (ch && ch.captured) + ' amt=' + (ch && ch.amount_captured));
        check('APP — the accepted extra is its own held order, paid out with the rest', (await orderRow(child.id)).funds_flow === 'held' && !ch.transfer, null);
        note('The accepted extra is its own held charge, so the provider payout is the sum across the order family.');
    }

    /* ============================= 15. INCREASE = REQUEST, DECLINED / EXPIRED */
    scenario('15', 'A declined increase releases the hold; an unanswered one is released by the 48h sweep');
    {
        const { order } = await confirmedChefOrder(dayOffset(18), 2);
        // Declined.
        await postRoute('/api/services/order/change-count', guestCookie, { orderId: order.id, count: 3 });
        const child = (await db.select('service_orders', '?select=*&parent_order_id=eq.' + order.id + '&order=created_at.desc&limit=1'))[0];
        const childPi = await guestPI({ total: 55, account, capture: 'manual', metadata: { kind: 'change_request', order_id: child.id } });
        await postWebhook({ object: 'checkout_session', payment_status: 'no_payment_required', payment_intent: childPi.id, amount_total: 5500, customer_email: guest.email, customer_details: { email: guest.email }, metadata: { kind: 'change_request', order_id: child.id, parent_order_id: order.id, provider_id: chef.id, guest_id: guest.id } });
        const dec = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: child.id, decision: 'decline' });
        check('decline succeeds and the child is declined', dec.status === 200 && dec.body.ok && (await orderRow(child.id)).status === 'declined', 'HTTP ' + dec.status);
        const ch = await chargeOf(childPi.id);
        check('STRIPE — the hold was released, nothing captured', ch && ch.captured === false, 'captured=' + (ch && ch.captured));
        // Expired by the sweep.
        await postRoute('/api/services/order/change-count', guestCookie, { orderId: order.id, count: 3 });
        const child2 = (await db.select('service_orders', '?select=*&parent_order_id=eq.' + order.id + '&status=eq.holding&order=created_at.desc&limit=1'))[0];
        const child2Pi = await guestPI({ total: 55, account, capture: 'manual', metadata: { kind: 'change_request', order_id: child2.id } });
        await postWebhook({ object: 'checkout_session', payment_status: 'no_payment_required', payment_intent: child2Pi.id, amount_total: 5500, customer_email: guest.email, customer_details: { email: guest.email }, metadata: { kind: 'change_request', order_id: child2.id, parent_order_id: order.id, provider_id: chef.id, guest_id: guest.id } });
        await db.update('service_orders', '?id=eq.' + child2.id, { expires_at: dayOffset(-1) + 'T00:00:00Z' });
        await runOrderSweep();
        const swept = await orderRow(child2.id);
        check('the unanswered hold is EXPIRED by the sweep', swept.status === 'expired', swept.status);
        const ch2 = await chargeOf(child2Pi.id);
        check('STRIPE — the expired hold was released, nothing captured', ch2 && ch2.captured === false, 'captured=' + (ch2 && ch2.captured));
    }

    /* ================================================ 16. CLOSED WINDOW + DATE REQUEST */
    scenario('16', 'Past the window every change is closed; inside it a date change is a provider request');
    {
        const { order: closedOrder } = await confirmedChefOrder(dayOffset(0), 2);   // today → past the window
        const red = await postRoute('/api/services/order/change-count', guestCookie, { orderId: closedOrder.id, count: 1 });
        check('change-count is CLOSED past the window (409)', red.status === 409 && !red.body.ok, 'HTTP ' + red.status);
        const dtClosed = await postRoute('/api/services/order/change-date', guestCookie, { orderId: closedOrder.id, date: dayOffset(22) });
        check('change-date is CLOSED past the window (409)', dtClosed.status === 409 && !dtClosed.body.ok, 'HTTP ' + dtClosed.status);
        // Inside the window: a date change is a REQUEST the provider accepts.
        const { order: liveOrder } = await confirmedChefOrder(dayOffset(19), 2);
        const dtReq = await postRoute('/api/services/order/change-date', guestCookie, { orderId: liveOrder.id, date: dayOffset(20) });
        check('a date change is a REQUEST, not an instant move', dtReq.status === 200 && dtReq.body.ok && dtReq.body.requested === true, 'HTTP ' + dtReq.status + ' ' + JSON.stringify(dtReq.body).slice(0, 140));
        const parked = await orderRow(liveOrder.id);
        check('the requested date is parked and the order stays on its date', parked.status === 'confirmed' && String(parked.pending_service_date).slice(0, 10) === dayOffset(20) && String(parked.service_date).slice(0, 10) === dayOffset(19), 'pending=' + parked.pending_service_date + ' date=' + parked.service_date);
        const acc = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: liveOrder.id, decision: 'accept_date' });
        check('the provider accepts the date and it applies', acc.status === 200 && acc.body.ok, 'HTTP ' + acc.status);
        const moved = await orderRow(liveOrder.id);
        check('the booking is now on the new date, the request cleared', String(moved.service_date).slice(0, 10) === dayOffset(20) && !moved.pending_service_date, 'date=' + moved.service_date);
    }

    /* ======================================= 17. PROVIDER FULL REFUND */
    scenario('17', 'A provider’s full refund records the full amount and reverses the payout to nothing');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(21), 4);   // £220
        const before = (Number((await orderRow(order.id)).price) - Number((await orderRow(order.id)).amount_refunded)) * 0.9;
        const ref = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'refund' });
        check('the provider’s full refund succeeds', ref.status === 200 && ref.body.ok, 'HTTP ' + ref.status + ' ' + JSON.stringify(ref.body).slice(0, 120));
        const ch = await settledCharge(pi.id, { needTransfer: false });
        check('STRIPE — the full £220 was refunded to the card', ch && ch.amount_refunded === 22000, 'refunded=' + (ch && ch.amount_refunded));
        const r = await orderRow(order.id);
        const net = (Number(r.price) - Number(r.amount_refunded)) * 0.9;
        check('amount_refunded is set to the FULL amount and orderNet is £0', r.status === 'refunded' && Number(r.amount_refunded) === 220 && Math.round(before) === 198 && Math.round(net) === 0, r.status + ' refunded £' + r.amount_refunded + ' net £' + net.toFixed(2));
        note('A provider refund writes amount_refunded = price, so orderNet reads zero — and the order is never paid out (it is no longer confirmed).');
    }

    /* ================================ 18. LOST CHANGE-REQUEST WEBHOOK */
    scenario('18', 'A lost change-request webhook: the rebuild sweep reconciles the hold; an expired one has its PaymentIntent cancelled');
    {
        // (a) The webhook that would authorise the increase never lands. The child
        // is stuck 'holding'; the rebuild sweep must reconcile it to 'authorised',
        // keeping the manual-capture hold.
        const { order } = await confirmedChefOrder(dayOffset(23), 2);
        const up = await postRoute('/api/services/order/change-count', guestCookie, { orderId: order.id, count: 3 });
        check('the increase is a request — a holding child is written', up.status === 200 && up.body.requested === true, 'HTTP ' + up.status + ' ' + JSON.stringify(up.body).slice(0, 120));
        const child = (await db.select('service_orders', '?select=*&parent_order_id=eq.' + order.id + '&status=eq.holding&order=created_at.desc&limit=1'))[0];
        const childPi = await guestPI({ total: 55, account, capture: 'manual', metadata: { kind: 'change_request', order_id: child.id } });
        // NO webhook is delivered — the lost case. The rebuild sweep asks Stripe.
        await runOrderSweep();
        const rebuilt = await orderRow(child.id);
        check('the rebuild sweep reconciled the lost hold to AUTHORISED', rebuilt.status === 'authorised' && rebuilt.stripe_payment_intent_id === childPi.id, rebuilt.status + ' pi=' + rebuilt.stripe_payment_intent_id);
        const heldPi = await getPI(childPi.id);
        check('the hold is kept — the PaymentIntent still requires capture', heldPi.status === 'requires_capture', heldPi.status);

        // (b) A change-request hold that reaches its expiry with the webhook still
        // lost: the sweep must CANCEL the held PaymentIntent so the card is freed.
        const { order: o2 } = await confirmedChefOrder(dayOffset(24), 2);
        await postRoute('/api/services/order/change-count', guestCookie, { orderId: o2.id, count: 3 });
        const child2 = (await db.select('service_orders', '?select=*&parent_order_id=eq.' + o2.id + '&status=eq.holding&order=created_at.desc&limit=1'))[0];
        const child2Pi = await guestPI({ total: 55, account, capture: 'manual', metadata: { kind: 'change_request', order_id: child2.id } });
        await db.update('service_orders', '?id=eq.' + child2.id, { expires_at: dayOffset(-1) + 'T00:00:00Z' });
        await runOrderSweep();
        const exp2 = await orderRow(child2.id);
        check('the expired hold is marked expired', exp2.status === 'expired', exp2.status);
        const cancelledPi = await getPI(child2Pi.id);
        check('STRIPE — the held PaymentIntent was CANCELLED, releasing the card', cancelledPi.status === 'canceled', cancelledPi.status);
    }

    /* ============================ 19. MADE-TO-ORDER CART — INSTANT (all standard) */
    scenario('19', 'A made-to-order cart of standard items books and charges instantly');
    {
        const bookRes = await postRoute('/api/services/order', guestCookie, { items: [{ itemId: bakerStd.id, qty: 2 }, { itemId: bakerStd2.id, qty: 3 }], bookingId: booking.id, serviceDate: dayOffset(6), collectionTime: 'around 10am' });
        check('the order is INSTANT (books straight away, not a request)', bookRes.status === 200 && bookRes.body.ok && bookRes.body.instant === true && !!bookRes.body.url, 'HTTP ' + bookRes.status + ' ' + JSON.stringify(bookRes.body).slice(0, 140));
        // Auto-capture (no capture_method) — the money moves at once, like a slot.
        const pi = await guestPI({ total: 72, account, metadata: { kind: 'service_order', provider_id: baker.id } });
        await postWebhook({ object: 'checkout_session', payment_status: 'paid', payment_intent: pi.id, amount_total: 7200, customer_email: guest.email, customer_details: { email: guest.email }, metadata: { kind: 'service_order', provider_id: baker.id, booking_id: booking.id, guest_id: guest.id, listing_id: listing.id, service_date: dayOffset(6), service_time: '', fulfilment: 'collection', instant: '1', cart: bakerStd.id + ':2,' + bakerStd2.id + ':3', collection_note: 'around 10am', commission_rate: '0.1', item_name: 'EXP Bakehouse order', item_unit: 'order', funds_flow: 'held', platform_fee_pence: '720' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + baker.id + '&service_date=eq.' + dayOffset(6) + '&order=created_at.desc&limit=1'))[0];
        check('the order is CONFIRMED at once — no provider step', order && order.status === 'confirmed', order && order.status);
        check('it records the cart lines and the £72 total', order && Array.isArray(order.line_items) && order.line_items.length === 2 && Number(order.price) === 72, order && ('£' + order.price + ' · ' + (order.line_items || []).length + ' lines'));
        const ch = await settledCharge(pi.id, { needTransfer: false });
        check('STRIPE — the £72 was captured immediately', ch && ch.captured === true && ch.amount_captured === 7200, 'captured=' + (ch && ch.captured) + ' amt=' + (ch && ch.amount_captured));
    }

    /* ============================ 20. MADE-TO-ORDER CART — CUSTOM = REQUEST */
    scenario('20', 'A made-to-order cart with a custom item is a request the provider accepts');
    {
        const bookRes = await postRoute('/api/services/order', guestCookie, { items: [{ itemId: bakerStd.id, qty: 1 }, { itemId: bakerCustom.id, qty: 1 }], bookingId: booking.id, serviceDate: dayOffset(7), collectionTime: 'afternoon' });
        check('the order is a REQUEST (held, not instant)', bookRes.status === 200 && bookRes.body.ok && bookRes.body.requested === true && !bookRes.body.instant, 'HTTP ' + bookRes.status + ' ' + JSON.stringify(bookRes.body).slice(0, 140));
        const pi = await guestPI({ total: 66, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: baker.id } });
        await postWebhook({ object: 'checkout_session', payment_status: 'no_payment_required', payment_intent: pi.id, amount_total: 6600, customer_email: guest.email, customer_details: { email: guest.email }, metadata: { kind: 'service_order', provider_id: baker.id, booking_id: booking.id, guest_id: guest.id, listing_id: listing.id, service_date: dayOffset(7), service_time: '', fulfilment: 'collection', instant: '', cart: bakerStd.id + ':1,' + bakerCustom.id + ':1', collection_note: 'afternoon', commission_rate: '0.1', item_name: 'EXP Bakehouse order', item_unit: 'order', funds_flow: 'held', platform_fee_pence: '660' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + baker.id + '&service_date=eq.' + dayOffset(7) + '&order=created_at.desc&limit=1'))[0];
        check('the held order is AUTHORISED — a request to answer', order && order.status === 'authorised', order && order.status);
        check('it carries both cart lines and the £66 total', order && Array.isArray(order.line_items) && order.line_items.length === 2 && Number(order.price) === 66, order && ('£' + order.price));
        const acc = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        check('the provider accepts and it is captured', acc.status === 200 && acc.body.ok, 'HTTP ' + acc.status);
        const ch = await settledCharge(pi.id);
        check('STRIPE — the £66 hold was captured on accept', ch && ch.captured === true && ch.amount_captured === 6600, 'captured=' + (ch && ch.captured) + ' amt=' + (ch && ch.amount_captured));
        note('Any custom item turns the whole order into a request; an all-standard cart is instant.');
    }

    /* ======================== 21–24. HELD MONEY — THE PAYOUT RUN (30 Sep 2026) */
    // Since 30 Sep 2026 an experience's money is held by us until the day after
    // it happens, then /api/cron/experience-payouts transfers the provider's
    // share. These prove it against real Stripe: timing, amount, source, never
    // twice, a no-show refunded from what we hold, a legacy order left alone, and
    // a refund after payout clawing the transfer back.
    const runPayouts = async () => {
        const res = await fetch(SITE + '/api/cron/experience-payouts', { headers: { authorization: 'Bearer ' + env.CRON_SECRET } });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const transfersFor = async (orderId) => {
        const list = await stripe.request('GET', '/transfers?limit=10&transfer_group=service_order_' + orderId);
        return (list && list.data) || [];
    };
    const refundsFor = async (piId) => {
        const list = await stripe.request('GET', '/refunds?payment_intent=' + piId);
        return (list && list.data) || [];
    };

    scenario('21', 'Held money is paid the day after the experience: nothing before, total − 10% after, drawn on the charge, never twice');
    {
        // Yesterday's dinner for two, £110 (our fee £11).
        const { order, pi } = await confirmedChefOrder(dayOffset(-1), 2);
        const held = await orderRow(order.id);
        check('APP: confirmed, held, £11 fee frozen, not yet paid out',
            held.status === 'confirmed' && held.funds_flow === 'held' && Number(held.platform_fee) === 11 && !held.paid_out_at,
            held.status + ' ' + held.funds_flow + ' £' + held.platform_fee + ' paid_out_at=' + held.paid_out_at);
        const charge = await chargeOf(pi.id);
        check('STRIPE: captured to us, no transfer at confirm', charge && charge.captured && !charge.transfer, charge && String(charge.transfer));

        const run1 = await runPayouts();
        check('the payout run ran', run1.status === 200 && run1.body.ok, 'HTTP ' + run1.status + ' ' + JSON.stringify(run1.body).slice(0, 160));
        const paid = await orderRow(order.id);
        check('APP: the order is paid out — £99 (£110 less our £11)', !!paid.paid_out_at && Number(paid.payout_amount) === 99 && !!paid.payout_transfer_id,
            'paid_out_at=' + paid.paid_out_at + ' £' + paid.payout_amount);
        const tr = paid.payout_transfer_id ? await stripe.request('GET', '/transfers/' + paid.payout_transfer_id) : null;
        check('STRIPE: a £99 transfer to the provider’s account', tr && tr.amount === 9900 && tr.destination === account,
            tr && ('amount=' + tr.amount + ' dest=' + tr.destination));
        check('STRIPE: drawn on the order’s own charge (source_transaction), in the order’s transfer group',
            tr && tr.source_transaction === (charge && charge.id) && tr.transfer_group === 'service_order_' + order.id,
            tr && ('source=' + tr.source_transaction + ' group=' + tr.transfer_group));

        // Nothing dated today or later was paid.
        const future = await db.select('service_orders', '?select=id,paid_out_at,service_date&funds_flow=eq.held&status=eq.confirmed&provider_id=eq.' + chef.id + '&service_date=gt.' + dayOffset(-1));
        check('APP: no order dated today or later was paid — only the day after', future.length > 0 && future.every((o) => !o.paid_out_at),
            future.length + ' future order(s), paid: ' + future.filter((o) => o.paid_out_at).length);

        // Run again: the transfer group already has it — no second payment.
        const run2 = await runPayouts();
        const group = await transfersFor(order.id);
        const again = await orderRow(order.id);
        check('a second run pays nothing more — one transfer in the group, the order unchanged',
            run2.status === 200 && group.length === 1 && again.payout_transfer_id === paid.payout_transfer_id,
            'transfers=' + group.length);

        // The payout is final in the database: clearing it is refused.
        let refused = false;
        try { await db.update('service_orders', '?id=eq.' + order.id, { paid_out_at: null }); } catch (e) { refused = /final/.test(String(e.message)); }
        check('DB: a payout cannot be un-stamped (trigger refuses)', refused, null);
    }

    scenario('22', 'Provider no-show: refunded in full from the money we hold — no transfer reversal, and the payout run then pays nothing');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(-2), 2);
        // The owner refunds the guest in the Stripe dashboard (a plain platform
        // refund), before the payout run — nothing to chase from the provider.
        await stripe.request('POST', '/refunds', { payment_intent: pi.id });
        const refunds = await refundsFor(pi.id);
        const charge = await chargeOf(pi.id);
        check('STRIPE: the guest has the full £110 back', charge && Number(charge.amount_refunded) === 11000, charge && String(charge.amount_refunded));
        check('STRIPE: no transfer existed and none was reversed', charge && !charge.transfer && refunds[0] && !refunds[0].transfer_reversal,
            'transfer=' + (charge && charge.transfer));
        const run = await runPayouts();
        const row = await orderRow(order.id);
        const group = await transfersFor(order.id);
        check('the payout run sends the provider nothing and settles the order at £0',
            run.status === 200 && group.length === 0 && !!row.paid_out_at && Number(row.payout_amount) === 0,
            'transfers=' + group.length + ' payout=£' + row.payout_amount);
    }

    scenario('23', 'Legacy order (paid under the old destination-charge flow): never paid again, and still refunds the old way');
    {
        const total = 110;
        const serviceDate = dayOffset(-3);
        const pi = await legacyDestinationPI({ total, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id } });
        const base = sessionForServiceOrder({ pi: pi.id, total, provider: chef, guest, booking, serviceDate, item: chefPerson, legacy: true });
        await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'person', unit_price: '55', quantity: '2', adults: '2', children: '0' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        check('APP: a pre-change session writes a DIRECT order', order && order.funds_flow === 'direct' && order.platform_fee === null, order && order.funds_flow);
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        const charge = await settledCharge(pi.id, { needTransfer: true });
        check('STRIPE: the provider was paid by Stripe at capture (old flow)', charge && !!charge.transfer && charge.application_fee_amount === 1100,
            charge && ('transfer=' + charge.transfer + ' fee=' + charge.application_fee_amount));

        let refused = false;
        try { await db.update('service_orders', '?id=eq.' + order.id, { funds_flow: 'held' }); } catch (e) { refused = /funds_flow cannot change/.test(String(e.message)); }
        check('DB: a paid direct order cannot be re-marked held (trigger refuses)', refused, null);

        await runPayouts();
        const after = await orderRow(order.id);
        const group = await transfersFor(order.id);
        check('the payout run leaves it alone — no second payment', !after.paid_out_at && group.length === 0, 'paid_out_at=' + after.paid_out_at + ' transfers=' + group.length);

        const ref = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'refund' });
        let ch = null, fee = null, tr = null;
        for (let i = 0; i < 12; i++) {
            ch = await chargeOf(pi.id);
            fee = ch && ch.application_fee ? await stripe.request('GET', '/application_fees/' + ch.application_fee).catch(() => null) : null;
            tr = ch && ch.transfer ? await stripe.request('GET', '/transfers/' + ch.transfer).catch(() => null) : null;
            if (ch && Number(ch.amount_refunded) === 11000 && fee && fee.refunded && tr && tr.amount_reversed === tr.amount) break;
            await sleep(2000);
        }
        check('refunds the old way: guest refunded, our fee returned, the provider’s transfer reversed',
            ref.status === 200 && ch && Number(ch.amount_refunded) === 11000 && fee && fee.refunded && tr && tr.amount_reversed === tr.amount,
            'refunded=' + (ch && ch.amount_refunded) + ' fee_refunded=' + (fee && fee.refunded) + ' reversed=' + (tr && tr.amount_reversed));
    }

    scenario('24', 'Refund after payout: the guest is refunded from us and the provider’s payout is clawed back');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(-4), 2);
        await runPayouts();
        const paid = await orderRow(order.id);
        check('paid out £99 the day after', Number(paid.payout_amount) === 99 && !!paid.payout_transfer_id, '£' + paid.payout_amount);
        const ref = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'refund' });
        check('the provider’s refund succeeds', ref.status === 200 && ref.body.ok, 'HTTP ' + ref.status + ' ' + JSON.stringify(ref.body).slice(0, 120));
        const charge = await chargeOf(pi.id);
        const tr = paid.payout_transfer_id ? await stripe.request('GET', '/transfers/' + paid.payout_transfer_id) : null;
        const row = await orderRow(order.id);
        check('STRIPE: the guest has the full £110 back', charge && Number(charge.amount_refunded) === 11000, charge && String(charge.amount_refunded));
        check('STRIPE: the £99 payout was reversed in full', tr && tr.amount_reversed === 9900, tr && ('reversed ' + tr.amount_reversed));
        check('APP: the reversal is recorded on the order, nothing owed', Number(row.payout_reversed) === 99 && Number(row.payout_clawback_owed) === 0 && row.status === 'refunded',
            'reversed £' + row.payout_reversed + ' owed £' + row.payout_clawback_owed + ' ' + row.status);
    }


    /* ================================ 25–29. THE ADMIN REFUND (30 Sep 2026) */
    // An admin refunding all or part of an order from /admin/experience-orders,
    // against real Stripe: before the payout run the money comes from what we
    // hold and the provider is paid only on what is left; after it, the
    // provider's share is clawed back — and what their balance can't cover is
    // owed and the directors told. Legacy direct orders refund the old way.
    const REASON = 'Scenario: the provider could not deliver what was booked.';
    const adminRefund = (orderId, amount, expectedRefunded) =>
        postRoute('/api/admin/experience-orders/refund', adminCookie, { orderId, amount, reason: REASON, expectedRefunded });
    const refundRows = (orderId) => db.select('service_order_refunds', '?select=*&order_id=eq.' + orderId + '&order=created_at.asc');

    scenario('25', 'Admin full refund BEFORE payout: refunded from the money we hold, the order refunded, and the payout run pays the provider nothing');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(-5), 2);
        const denied = await postRoute('/api/admin/experience-orders/refund', ownerCookie, { orderId: order.id, amount: 110, reason: REASON, expectedRefunded: 0 });
        check('a non-admin (the provider) is refused and nothing moves', denied.status === 403 && Number((await chargeOf(pi.id)).amount_refunded) === 0, 'HTTP ' + denied.status);
        const shortReason = await postRoute('/api/admin/experience-orders/refund', adminCookie, { orderId: order.id, amount: 110, reason: 'sorry', expectedRefunded: 0 });
        check('a reason under the minimum is refused before any money moves', shortReason.status === 400 && (await refundRows(order.id)).length === 0, 'HTTP ' + shortReason.status);
        const tooMuch = await adminRefund(order.id, 110.01, 0);
        check('more than was paid is refused (capped from Stripe, not the browser)', tooMuch.status === 400, 'HTTP ' + tooMuch.status + ' ' + JSON.stringify(tooMuch.body).slice(0, 100));

        const res = await adminRefund(order.id, 110, 0);
        check('the admin refund succeeds', res.status === 200 && res.body.ok && res.body.status === 'refunded' && res.body.afterPayout === false,
            'HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
        const charge = await chargeOf(pi.id);
        const refunds = await refundsFor(pi.id);
        check('STRIPE: the guest has the full £110 back, as a plain refund (no transfer to reverse)',
            Number(charge.amount_refunded) === 11000 && refunds.length === 1 && !refunds[0].transfer_reversal && !charge.transfer,
            'refunded=' + charge.amount_refunded + ' refunds=' + refunds.length);
        const [row] = await refundRows(order.id);
        check('STRIPE: the refund carries the audit row id, and the key was built from it',
            refunds[0].metadata && refunds[0].metadata.admin_refund_request === (row && row.id), refunds[0].metadata && refunds[0].metadata.admin_refund_request);
        const after = await orderRow(order.id);
        check('APP: the order is refunded, amount_refunded £110', after.status === 'refunded' && Number(after.amount_refunded) === 110,
            after.status + ' £' + after.amount_refunded);
        check('AUDIT: who, what, why, when, flow, before payout, the Stripe refund id',
            row && row.status === 'succeeded' && row.admin_id === director.id && Number(row.amount) === 110 && row.reason === REASON
                && row.funds_flow === 'held' && row.after_payout === false && row.stripe_refund_id === refunds[0].id && !!row.completed_at,
            JSON.stringify(row).slice(0, 220));
        const run = await runPayouts();
        const group = await transfersFor(order.id);
        const settled = await orderRow(order.id);
        check('the payout run sends the provider nothing — no transfer, never paid out',
            run.status === 200 && group.length === 0 && !settled.payout_transfer_id, 'transfers=' + group.length + ' payout=' + settled.payout_amount);
    }

    scenario('26', 'Admin PART refund before payout (a double click sends one refund): the payout run pays the remainder less our fee');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(-6), 2);
        // Two clicks at once, same amount, same page.
        const [a, b] = await Promise.all([adminRefund(order.id, 30, 0), adminRefund(order.id, 30, 0)]);
        const statuses = [a.status, b.status].sort();
        const refunds = await refundsFor(pi.id);
        check('a double click refunds ONCE — one 200, one refused, one refund at Stripe',
            statuses[0] === 200 && statuses[1] === 409 && refunds.length === 1 && refunds[0].amount === 3000,
            'HTTP ' + statuses.join('/') + ' refunds=' + refunds.length);
        // A late second click from the same stale page is refused too.
        const late = await adminRefund(order.id, 30, 0);
        check('a late click from the stale page is refused (the refunded figure moved)', late.status === 409 && (await refundsFor(pi.id)).length === 1, 'HTTP ' + late.status);
        const mid = await orderRow(order.id);
        check('APP: still confirmed, £30 recorded as refunded', mid.status === 'confirmed' && Number(mid.amount_refunded) === 30, mid.status + ' £' + mid.amount_refunded);
        await runPayouts();
        const paid = await orderRow(order.id);
        const tr = paid.payout_transfer_id ? await stripe.request('GET', '/transfers/' + paid.payout_transfer_id) : null;
        check('the payout run pays £72 — the £80 left less our £8 fee on it', Number(paid.payout_amount) === 72 && tr && tr.amount === 7200,
            '£' + paid.payout_amount + ' transfer=' + (tr && tr.amount));
    }

    scenario('27', 'Admin PART refund after payout: the guest is refunded and the provider\'s share of it is clawed back');
    {
        const { order, pi } = await confirmedChefOrder(dayOffset(-7), 2);
        await runPayouts();
        const paid = await orderRow(order.id);
        check('paid out £99 first', Number(paid.payout_amount) === 99 && !!paid.payout_transfer_id, '£' + paid.payout_amount);
        const res = await adminRefund(order.id, 30, 0);
        check('the admin refund succeeds, after payout', res.status === 200 && res.body.ok && res.body.afterPayout === true && res.body.status === 'confirmed',
            'HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
        const charge = await chargeOf(pi.id);
        const tr = await stripe.request('GET', '/transfers/' + paid.payout_transfer_id);
        const row = await orderRow(order.id);
        const [audit] = await refundRows(order.id);
        check('STRIPE: the guest has £30 back', Number(charge.amount_refunded) === 3000, String(charge.amount_refunded));
        check('STRIPE: £27 of the £99 payout reversed — what the provider would not have been paid (£99 − £72)', tr.amount_reversed === 2700, 'reversed ' + tr.amount_reversed);
        check('APP: payout_reversed £27, nothing owed, still confirmed', Number(row.payout_reversed) === 27 && Number(row.payout_clawback_owed) === 0 && row.status === 'confirmed',
            'reversed £' + row.payout_reversed + ' owed £' + row.payout_clawback_owed);
        check('AUDIT: after payout, the reversal id and £27 recorded', audit && audit.after_payout === true && Number(audit.reversed) === 27 && !!audit.reversal_id && Number(audit.shortfall) === 0,
            JSON.stringify(audit).slice(0, 200));
    }

    scenario('28', 'Admin full refund after payout with the provider\'s balance empty: the shortfall is owed on the order and the directors are told');
    {
        // Paid with a card whose funds are available at once, so the payout's
        // money is in the provider's AVAILABLE balance — where draining it to
        // their bank leaves nothing to pull back (a transfer still pending on
        // the charge's clock is always reachable; see lib/clawback.ts).
        const { order, pi } = await confirmedChefOrder(dayOffset(-8), 2, 'pm_card_bypassPending');
        await runPayouts();
        const paid = await orderRow(order.id);
        check('paid out £99 first', Number(paid.payout_amount) === 99 && !!paid.payout_transfer_id, '£' + paid.payout_amount);
        const bal = await connectedBalance(account);
        if (bal.available > 0) {
            await stripe.request('POST', '/payouts', { amount: Math.round(bal.available * 100), currency: 'gbp' }, { account });
        }
        const drained = await connectedBalance(account);
        check('the provider\'s available Stripe balance is empty before the refund', drained.available <= 0, '£' + drained.available + ' available');
        const since = new Date(Date.now() - 1000).toISOString();
        const res = await adminRefund(order.id, 110, 0);
        check('the guest is still refunded in full', res.status === 200 && res.body.ok && res.body.status === 'refunded' && Number(res.body.shortfall) === 99,
            'HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
        const charge = await chargeOf(pi.id);
        const tr = await stripe.request('GET', '/transfers/' + paid.payout_transfer_id);
        const row = await orderRow(order.id);
        const [audit] = await refundRows(order.id);
        check('STRIPE: the guest has the full £110 back', Number(charge.amount_refunded) === 11000, String(charge.amount_refunded));
        check('STRIPE: nothing reversed from an empty balance (the account is never driven negative)', tr.amount_reversed === 0 && (await connectedBalance(account)).available >= 0,
            'reversed ' + tr.amount_reversed);
        check('APP: £99 owed on the order (payout_clawback_owed), order refunded', Number(row.payout_clawback_owed) === 99 && row.status === 'refunded',
            'owed £' + row.payout_clawback_owed + ' ' + row.status);
        check('AUDIT: the shortfall recorded against the refund', audit && Number(audit.shortfall) === 99 && audit.after_payout === true, JSON.stringify(audit).slice(0, 200));
        const alerts = await db.select('error_log', '?select=message,detail,created_at&created_at=gte.' + encodeURIComponent(since) + '&message=like.*could%20not%20be%20pulled%20back*');
        check('the director alert path fired (logMoneyFailure → alertDirectorsNow), naming the order',
            alerts.some((a) => String(a.detail || '').indexOf(order.id) >= 0), alerts.length + ' alert row(s)');
    }

    scenario('29', 'Admin PART refund of a legacy direct order: the old way — our fee back and the provider\'s transfer reversed in proportion');
    {
        const total = 110;
        const serviceDate = dayOffset(-9);
        const pi = await legacyDestinationPI({ total, account, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id } });
        const base = sessionForServiceOrder({ pi: pi.id, total, provider: chef, guest, booking, serviceDate, item: chefPerson, legacy: true });
        await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'person', unit_price: '55', quantity: '2', adults: '2', children: '0' } });
        const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
        await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
        await settledCharge(pi.id, { needTransfer: true });
        const res = await adminRefund(order.id, 55, 0);
        check('the admin refund succeeds on a direct order', res.status === 200 && res.body.ok && res.body.status === 'confirmed', 'HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
        let ch = null, tr = null, fee = null;
        for (let i = 0; i < 12; i++) {
            ch = await chargeOf(pi.id);
            tr = ch && ch.transfer ? await stripe.request('GET', '/transfers/' + ch.transfer).catch(() => null) : null;
            fee = ch && ch.application_fee ? await stripe.request('GET', '/application_fees/' + ch.application_fee).catch(() => null) : null;
            if (ch && Number(ch.amount_refunded) === 5500 && tr && tr.amount_reversed > 0) break;
            await sleep(2000);
        }
        check('STRIPE: £55 back to the guest, half the transfer reversed, half our fee returned',
            ch && Number(ch.amount_refunded) === 5500 && tr && tr.amount_reversed === Math.round(tr.amount / 2) && fee && fee.amount_refunded === 550,
            'refunded=' + (ch && ch.amount_refunded) + ' reversed=' + (tr && tr.amount_reversed) + '/' + (tr && tr.amount) + ' fee_refunded=' + (fee && fee.amount_refunded));
        const [audit] = await refundRows(order.id);
        check('AUDIT: direct flow, the transfer reversal id recorded', audit && audit.funds_flow === 'direct' && !!audit.reversal_id, JSON.stringify(audit).slice(0, 200));
        const after = await orderRow(order.id);
        check('APP: still confirmed, £55 refunded, never paid out by us', after.status === 'confirmed' && Number(after.amount_refunded) === 55 && !after.paid_out_at,
            after.status + ' £' + after.amount_refunded);
    }

    scenario('30', 'Approved but payouts not set up: bookable, the guest pays as normal (sold as us), the share is held — then released once payouts are on');
    {
        // The chef as a provider who was approved but never finished Stripe.
        // It also needs what any live listing needs to be on the marketplace — an
        // assigned MCC (the seed chef has none) — and to be the business the
        // owner's dashboard opens on (the most recently touched).
        const before = (await db.select('service_providers', '?select=stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_mcc&id=eq.' + chef.id))[0];
        await db.update('service_providers', '?id=eq.' + chef.id, { stripe_account_id: null, stripe_payouts_enabled: false, stripe_charges_enabled: false, stripe_mcc: '5812', updated_at: new Date().toISOString() });
        try {
            const started = await postRoute('/api/services/order', guestCookie, { itemId: chefItem.id, bookingId: booking.id, serviceDate: dayOffset(6), quantity: 1 });
            check('BOOKABLE: services/order builds a Checkout for a provider with no Stripe account',
                started.status === 200 && started.body.ok && !!started.body.url, 'HTTP ' + started.status + ' ' + JSON.stringify(started.body).slice(0, 160));
            // The guest-facing page — the same gate the marketplace uses (approved,
            // not taken down) — renders the bookable listing, not "not taking bookings".
            const page = await fetch(SITE + '/experiences/browse/' + chef.id, { headers: { cookie: guestCookie } });
            const html = await page.text();
            const chefRow = (await db.select('service_providers', '?select=status,owner_paused,admin_hidden_at,trade,stripe_mcc&id=eq.' + chef.id))[0];
            check('VISIBLE: the provider’s public page is live and bookable', page.status === 200 && html.indexOf('EXP Chef') >= 0 && !/not taking bookings/i.test(html),
                'HTTP ' + page.status + ' ' + JSON.stringify(chefRow));

            // The guest's money, taken as us — a dinner for two four days ago, £110
            // (its own date: a comes-to-you provider holds a date exclusively).
            const serviceDate = dayOffset(-4);
            const pi = await guestPI({ total: 110, account: null, capture: 'manual', metadata: { kind: 'service_order', provider_id: chef.id } });
            check('STRIPE: the charge is ours — no on_behalf_of, no transfer_data, no application fee',
                !pi.on_behalf_of && !pi.transfer_data && !pi.application_fee_amount, 'on_behalf_of=' + pi.on_behalf_of);
            const base = sessionForServiceOrder({ pi: pi.id, total: 110, provider: chef, guest, booking, serviceDate, item: chefPerson });
            await postWebhook({ ...base, metadata: { ...base.metadata, item_unit: 'person', unit_price: '55', quantity: '2', adults: '2', children: '0' } });
            const order = (await db.select('service_orders', '?select=*&provider_id=eq.' + chef.id + '&service_date=eq.' + serviceDate + '&order=created_at.desc&limit=1'))[0];
            const acc = await postRoute('/api/services/orders/respond', ownerCookie, { orderId: order.id, decision: 'confirm' });
            check('the provider accepts and it is captured', acc.status === 200 && acc.body.ok, 'HTTP ' + acc.status);
            const charge = await settledCharge(pi.id);
            check('STRIPE: £110 captured to us', charge && charge.captured && charge.amount_captured === 11000, charge && String(charge.amount_captured));

            // The payout run holds it: no transfer, not failed, said out loud.
            const held = await runPayouts();
            const stillHeld = await orderRow(order.id);
            check('HELD: the run sends nothing and counts the provider as waiting',
                held.status === 200 && !stillHeld.paid_out_at && (await transfersFor(order.id)).length === 0 && Number(held.body.providersWaitingToOnboard) >= 1,
                JSON.stringify(held.body).slice(0, 160));

            // Their dashboard says money is waiting, and how much (£99 = £110 less our £11).
            const dash = await fetch(SITE + '/services/dashboard', { headers: { cookie: ownerCookie } }).then((r) => r.text()).catch(() => '');
            check('DASHBOARD: "£99 is waiting for you" with the set-up button', /£99(\.00)? is waiting for you/.test(dash) && /Set up payouts/.test(dash),
                (dash.match(/[^<>]{0,40}(is waiting for you|holding)[^<>]{0,20}/) || ['(no notice) shows: ' + ((dash.match(/EXP [A-Za-z]+/) || ['?'])[0])])[0]);

            // Payouts come on: the next run releases it to their account.
            await db.update('service_providers', '?id=eq.' + chef.id, { stripe_account_id: before.stripe_account_id, stripe_payouts_enabled: true, stripe_charges_enabled: true });
            const released = await runPayouts();
            const paid = await orderRow(order.id);
            const tr = paid.payout_transfer_id ? await stripe.request('GET', '/transfers/' + paid.payout_transfer_id) : null;
            check('RELEASED: paid on the next run — £99 to the provider, drawn on the order’s own charge',
                released.status === 200 && !!paid.paid_out_at && Number(paid.payout_amount) === 99 && tr && tr.amount === 9900 && tr.destination === account && tr.source_transaction === charge.id,
                'paid_out_at=' + paid.paid_out_at + ' £' + paid.payout_amount + ' dest=' + (tr && tr.destination));
            const again = await runPayouts();
            check('a further run pays nothing more', again.status === 200 && (await transfersFor(order.id)).length === 1, null);
        } finally {
            await db.update('service_providers', '?id=eq.' + chef.id, before);
        }
    }

    /* ----------------------------------------------------------------- write + sum */
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const requestReconciled = results.find((r) => r.number === '9');
    fs.writeFileSync(RESULTS, JSON.stringify({
        ranAt: new Date().toISOString(), target: SITE, account, passed, failed,
        lostWebhookReconciled: !!(results[0] && results[0].fixVerified),
        lostWebhookRequestReconciled: !!(requestReconciled && requestReconciled.fixVerified),
        scenarios: results,
    }, null, 2) + '\n');

    console.log('\n' + '='.repeat(70));
    console.log('  passed ' + passed + '   failed ' + failed);
    console.log('  lost-webhook slot fix: ' + (results[0] && results[0].fixVerified ? 'VERIFIED (paid order reconciled, seat kept)' : 'NOT verified'));
    console.log('  lost-webhook request fix: ' + (requestReconciled && requestReconciled.fixVerified ? 'VERIFIED (authorised order rebuilt, hold kept)' : 'NOT verified'));
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
