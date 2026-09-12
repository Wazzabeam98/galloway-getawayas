// Slot session MODE — proving the private/shared refusal rule and its
// money-adjacent edges with REAL test-mode money.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3190 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-mode-scenarios.mjs
//   (SITE_URL is chosen and safety-checked by scripts/target.cjs.)
//
// Piece (3) of the two-product slot work: slot_sessions.private + the claim-time
// refusal (lib/serviceSlots.slotClaimKind, enforced in slots/book/route.ts). The
// unit tests cover the pure rule; this drives the REAL routes against a guarded
// dev server, with REAL test-mode Stripe destination charges behind them, and
// reads the money back from Stripe — because the cancel/refund path is where
// this touches money and the brief was prove, don't reason.
//
// It proves, with money moving:
//   1. THE GUARD — a private hire on a shared table that has a PAID seat is
//      refused (409), the seat and its charge untouched. (The live bug, closed.)
//   2. A cancelled PRIVATE booking reopens the time as EITHER — refund lands,
//      seat frees, and the same time then takes a shared booking.
//   3. A cancelled SEAT leaves a shared table shared while another paid guest is
//      still in it — only the cancelled seat frees, the other's charge is intact,
//      and a private hire is still refused.
//
// Checkout can't be completed over the API, so — as the cottage scenarios do —
// the guest's payment is a PaymentIntent created directly with the IDENTICAL
// destination-charge fields the slot route's Checkout sets, and the confirming
// webhook is self-signed exactly as Stripe signs it. The money movement is
// faithful; only the hosted page is skipped.

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
const SITE = await resolveTarget({ runner: 'scripts/slot-mode-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) { console.error('STRIPE_WEBHOOK_SECRET is not set'); process.exit(1); }

const DOMAIN = 'gallowayslotmode.test';
const TAG = 'gg-slot-mode-seed';

/* ---------------------------------------------------------------- harness */
const results = [];
let current = null;
function scenario(n, title) { current = { number: n, title, checks: [], status: 'passed' }; results.push(current); console.log('\n── ' + n + '. ' + title); }
function check(desc, cond, detail) { const ok = !!cond; current.checks.push({ desc, ok, detail: detail || null }); if (!ok) current.status = 'failed'; console.log('   ' + (ok ? '✓' : '✗') + ' ' + desc + (detail && !ok ? '  — ' + detail : '')); }
function note(t) { console.log('   · ' + t); }

/* ---------------------------------------------------------------- stripe */
function priceParts(total) {
    const amountPence = Math.round(total * 100);
    const commission = Math.round(total * 0.10 * 100) / 100;
    const net = Math.round((total - commission) * 100) / 100;
    return { amountPence, feePence: amountPence - Math.round(net * 100) };
}
// The guest's payment: a real immediate-capture destination charge, exactly the
// fields the slot route's Checkout would create.
async function payFor(total, account, orderId, providerId, bookingId) {
    const { amountPence, feePence } = priceParts(total);
    const pi = await stripe.request('POST', '/payment_intents', {
        amount: amountPence, currency: 'gbp', payment_method: 'pm_card_visa', payment_method_types: ['card'],
        confirm: 'true', on_behalf_of: account, application_fee_amount: feePence,
        transfer_data: { destination: account }, description: TAG,
        metadata: { kind: 'slot_order', order_id: orderId, provider_id: providerId, booking_id: bookingId },
    });
    return pi;
}
async function chargeOf(piId) {
    const pi = await stripe.request('GET', '/payment_intents/' + piId + '?expand[]=latest_charge');
    const lc = pi.latest_charge; const id = typeof lc === 'string' ? lc : (lc && lc.id);
    return id ? stripe.request('GET', '/charges/' + id) : null;
}
async function settledCharge(piId, tries = 10) {
    let ch = null;
    for (let i = 0; i < tries; i++) { ch = await chargeOf(piId); if (ch && ch.transfer) return ch; await sleep(2000); }
    return ch;
}
async function postWebhook(order, pi, guestEmail) {
    const obj = { payment_intent: pi, customer_email: guestEmail, customer_details: { email: guestEmail },
        metadata: { kind: 'slot_order', order_id: order, provider_id: '', booking_id: '' } };
    const payload = JSON.stringify({ id: 'evt_slotmode_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', data: { object: obj } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(t + '.' + payload).digest('hex');
    const res = await fetch(SITE + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + t + ',v1=' + sig }, body: payload });
    return { status: res.status };
}

/* ------------------------------------------------------------------ http */
async function asUser(label) { const { cookie } = await signIn(env, label + '@' + DOMAIN, 'seed-password-' + label); return cookie; }
async function post(routePath, cookie, body) {
    const res = await fetch(SITE + routePath, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function orderRow(id) { const [r] = await db.select('service_orders', '?select=*&id=eq.' + id); return r; }
async function latestOrder(providerId, date, time) {
    const rows = await db.select('service_orders', '?select=*&provider_id=eq.' + providerId + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00&order=created_at.desc&limit=1');
    return rows[0];
}
async function sessionRow(providerId, date, time) {
    const rows = await db.select('slot_sessions', '?select=*&provider_id=eq.' + providerId + '&session_date=eq.' + date + '&session_time=eq.' + time + ':00&limit=1');
    return rows[0];
}

/* ---------------------------------------------------------------- seeding */
async function resetSeed() {
    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + DOMAIN));
    if (!seeded.length) return;
    const ids = '(' + seeded.map((u) => u.id).join(',') + ')';
    const provs = await db.select('service_providers', '?select=id&owner_id=in.' + ids);
    for (const p of provs) {
        await db.remove('service_orders', '?provider_id=eq.' + p.id);
        for (const t of ['slot_sessions', 'slot_availability', 'slot_blocks', 'service_provider_items']) await db.remove(t, '?provider_id=eq.' + p.id);
    }
    await db.remove('service_providers', '?owner_id=in.' + ids);
    const bookings = await db.select('bookings', '?select=id&guest_id=in.' + ids);
    for (const b of bookings) { await db.remove('service_orders', '?booking_id=eq.' + b.id); for (const t of ['payouts', 'payments', 'messages']) await db.remove(t, '?booking_id=eq.' + b.id); }
    await db.remove('bookings', '?guest_id=in.' + ids);
    await db.remove('listings', '?host_id=in.' + ids);
    await db.remove('profiles', '?id=in.' + ids);
    for (const u of seeded) await db.auth('DELETE', '/admin/users/' + u.id);
    console.log('  reset ' + seeded.length + ' previous seed user(s)');
}
async function createUser(label, name) {
    const email = label + '@' + DOMAIN;
    const u = await db.auth('POST', '/admin/users', { email, password: 'seed-password-' + label, email_confirm: true, user_metadata: { full_name: name, [TAG]: true } });
    const existing = await db.select('profiles', '?select=id&id=eq.' + u.id);
    if (existing.length) await db.update('profiles', '?id=eq.' + u.id, { email, full_name: name }); else await db.insert('profiles', { id: u.id, email, full_name: name });
    return { id: u.id, email, label };
}
async function pickAccount() {
    const m = path.join(ROOT, 'scripts', '.seed-manifest.json');
    const ids = fs.existsSync(m) ? Object.values(JSON.parse(fs.readFileSync(m, 'utf8')).accounts || {}) : [];
    for (const id of ids) {
        const a = await stripe.request('GET', '/accounts/' + id).catch(() => null);
        const c = (a && a.capabilities) || {};
        if (a && a.payouts_enabled && c.transfers === 'active' && c.card_payments === 'active') { console.log('  reusing account ' + id); return id; }
    }
    throw new Error('no reusable connected account — run scripts/seed-payments.mjs first');
}
// The provider has one slot item; flip its unit/price to stand in for the host
// offering a private (flat) or shared (person) product. Post point-2 the guest
// picks between two items; here we move the single item, which exercises the
// same mode logic (and the exact switch-after-booking path that makes the bug
// reachable today).
let ITEM_ID = null;
async function setProduct(kind) {
    const patch = kind === 'private' ? { unit: 'flat', price: 120, name: 'Private tasting (up to 6)' } : { unit: 'person', price: 30, name: 'Join a tasting' };
    await db.update('service_provider_items', '?id=eq.' + ITEM_ID, patch);
}

/* -------------------------------------------------------------------- main */
async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE);
    console.log('\nseeding…');
    await resetSeed();
    const account = await pickAccount();
    const guest = await createUser('guest', 'Slot Guest');
    const host = await createUser('host', 'Slot Host');
    const owner = await createUser('owner', 'Slot Owner');
    const [listing] = await db.insert('listings', { host_id: host.id, title: 'SLOT — cottage', description: 'seed', location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 6, status: 'published', cancellation_policy: 'Moderate' });
    const [booking] = await db.insert('bookings', { listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: dayOffset(1), check_out: dayOffset(20), guests: 4, adults: 4, total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500, commission_rate: 10, paid_at: new Date().toISOString() });
    const [prov] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Slot Tastings', trade: 'tasting', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_capacity: 8, slot_min_people: 1, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [item] = await db.insert('service_provider_items', { provider_id: prov.id, name: 'Join a tasting', description: 'A seat at the table', price: 30, unit: 'person', active: true, sort_order: 0 });
    ITEM_ID = item.id;
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: prov.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });

    const guestCookie = await asUser('guest');
    const bookSlot = (date, time, qty) => post('/api/services/slots/book', guestCookie, { providerId: prov.id, bookingId: booking.id, sessionDate: date, sessionTime: time, quantity: qty });
    // Book + pay + confirm a slot, returning { order, pi }.
    async function bookConfirm(date, time, qty, total) {
        const b = await bookSlot(date, time, qty);
        if (b.status !== 200 || !b.body.ok) throw new Error('book failed ' + b.status + ' ' + JSON.stringify(b.body));
        const order = await latestOrder(prov.id, date, time);
        const pi = await payFor(total, account, order.id, prov.id, booking.id);
        await postWebhook(order.id, pi.id, guest.email);
        return { order: await orderRow(order.id), pi };
    }

    /* ========================================= 1. THE GUARD (with a paid seat) */
    scenario('1', 'A private hire on a shared table with a PAID seat is refused; the seat and its charge untouched');
    {
        const T = dayOffset(5), time = '10:00';
        await setProduct('shared');
        const { order, pi } = await bookConfirm(T, time, 1, 30);
        check('a shared seat is booked, paid and confirmed', order.status === 'confirmed' && order.stripe_payment_intent_id === pi.id, order.status);
        const s0 = await sessionRow(prov.id, T, time);
        check('the session is a shared table (private=false), 1 seat taken', s0 && s0.private === false && s0.seats_taken === 1, s0 && ('private=' + s0.private + ' seats=' + s0.seats_taken));

        // The host now also offers a private hire; a guest tries to book the same time privately.
        await setProduct('private');
        const clash = await bookSlot(T, time, 1);
        check('the private hire is REFUSED with 409', clash.status === 409, 'HTTP ' + clash.status);
        check('the message says the time is a shared table', /shared table/i.test(clash.body.error || ''), clash.body.error);

        const s1 = await sessionRow(prov.id, T, time);
        check('the shared seat is untouched (still 1, still shared)', s1 && s1.seats_taken === 1 && s1.private === false, s1 && ('private=' + s1.private + ' seats=' + s1.seats_taken));
        const ch = await settledCharge(pi.id);
        check('STRIPE: the paid seat’s charge is intact — captured, £0 refunded', ch && ch.captured === true && Number(ch.amount_refunded) === 0, ch && ('captured=' + ch.captured + ' refunded=' + ch.amount_refunded));
        note('The bug closed: a private booking on an occupied shared table refuses instead of silently taking one seat, and frees nothing that was paid for.');
    }

    /* ================================== 2. cancelled PRIVATE reopens as either */
    scenario('2', 'A cancelled private booking refunds, frees the room, and the time reopens as a shared table');
    {
        const T = dayOffset(6), time = '11:00';
        await setProduct('private');
        const { order, pi } = await bookConfirm(T, time, 1, 120);
        const s0 = await sessionRow(prov.id, T, time);
        check('the time is a private hire (private=true), full at 1/1', s0 && s0.private === true && s0.seats_taken === 1 && s0.capacity === 1, s0 && ('private=' + s0.private + ' seats=' + s0.seats_taken + '/' + s0.capacity));

        const cancel = await post('/api/services/orders/cancel', guestCookie, { orderId: order.id });
        check('cancel returns a refund', cancel.status === 200 && cancel.body.status === 'refunded', 'HTTP ' + cancel.status + ' ' + JSON.stringify(cancel.body).slice(0, 100));
        const ch = await settledCharge(pi.id);
        // poll for the refund to settle
        let refunded = 0; for (let i = 0; i < 8; i++) { const c = await chargeOf(pi.id); refunded = Number(c && c.amount_refunded) || 0; if (refunded === 12000) break; await sleep(2000); }
        check('STRIPE: the private booking was refunded in full (£120)', refunded === 12000, 'refunded=' + refunded);
        const s1 = await sessionRow(prov.id, T, time);
        check('the room is freed (seats back to 0)', s1 && s1.seats_taken === 0, s1 && String(s1.seats_taken));

        // The host offers a shared table; a guest books the same time as a seat.
        await setProduct('shared');
        const rebook = await bookSlot(T, time, 1);
        check('the same time now takes a SHARED booking (reopened as either)', rebook.status === 200 && rebook.body.ok, 'HTTP ' + rebook.status + ' ' + JSON.stringify(rebook.body).slice(0, 100));
        const s2 = await sessionRow(prov.id, T, time);
        check('the session re-established as a shared table (private=false, capacity 8)', s2 && s2.private === false && s2.capacity === 8 && s2.seats_taken === 1, s2 && ('private=' + s2.private + ' cap=' + s2.capacity + ' seats=' + s2.seats_taken));
        note('Reopen-as-either needs no change to the cancel/refund path — the next booking re-establishes the mode on the 0→>0 claim.');
    }

    /* ============== 3. cancelled SEAT leaves shared shared; nothing frees a paid seat */
    scenario('3', 'A cancelled seat frees only itself; the other paid guest stays, the table stays shared, private still refused');
    {
        const T = dayOffset(7), time = '14:00';
        await setProduct('shared');
        const A = await bookConfirm(T, time, 2, 60);   // guest takes 2 seats
        const B = await bookConfirm(T, time, 1, 30);   // and 1 more
        const s0 = await sessionRow(prov.id, T, time);
        check('the shared table has 3 seats taken', s0 && s0.private === false && s0.seats_taken === 3, s0 && ('private=' + s0.private + ' seats=' + s0.seats_taken));

        const cancel = await post('/api/services/orders/cancel', guestCookie, { orderId: A.order.id });
        check('cancelling the 2-seat order refunds', cancel.status === 200 && cancel.body.status === 'refunded', 'HTTP ' + cancel.status);
        let aRef = 0; for (let i = 0; i < 8; i++) { const c = await chargeOf(A.pi.id); aRef = Number(c && c.amount_refunded) || 0; if (aRef === 6000) break; await sleep(2000); }
        check('STRIPE: only the cancelled order was refunded (£60)', aRef === 6000, 'refunded=' + aRef);

        const s1 = await sessionRow(prov.id, T, time);
        check('only the 2 seats freed — 1 remains (nothing freed a paid seat)', s1 && s1.seats_taken === 1, s1 && String(s1.seats_taken));
        check('the table is still shared (private=false)', s1 && s1.private === false, s1 && String(s1.private));
        const bCh = await chargeOf(B.pi.id);
        check('STRIPE: the remaining guest’s charge is intact — captured, £0 refunded', bCh && bCh.captured === true && Number(bCh.amount_refunded) === 0, bCh && ('captured=' + bCh.captured + ' refunded=' + bCh.amount_refunded));
        const bOrder = await orderRow(B.order.id);
        check('the remaining guest’s order is still confirmed', bOrder.status === 'confirmed', bOrder.status);

        await setProduct('private');
        const clash = await bookSlot(T, time, 1);
        check('a private hire is still refused while a guest is seated', clash.status === 409, 'HTTP ' + clash.status);
    }

    /* --------------------------------------------------------------- summary */
    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-MODE.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, account, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(64) + '\n  passed ' + passed + '   failed ' + failed + '\n  written to SCENARIO-RESULTS-SLOT-MODE.json\n' + '='.repeat(64));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-mode scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
