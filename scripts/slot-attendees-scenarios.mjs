// Slot ATTENDEES — a private session records how many are coming, proven with
// REAL test bookings and read back from the order row.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3192 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-attendees-scenarios.mjs
//
// A private (flat) session is one flat price whatever the head count, but the
// provider needs to know how many are coming. The guest is now asked, and the
// count is stored on the order (never touching price) and shown to the provider.
// The honest cap: the provider's declared capacity where it has one, else the
// cottage's guest count (a traveller declares none). This proves:
//   1. Booked for six → the order carries 6; price is the item price; quantity 1.
//   2. Booked for two → the order carries 2; the SAME price (invariance).
//   3. The provider sees it — /api/services/orders returns the count.
//   4. Cap source: a come-to-me provider whose capacity (4) is below the cottage
//      (6) binds at 4; a travelling provider (no capacity) binds at the cottage 6.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    signIn, sleep, dayOffset, ROOT,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const stripe = stripeClient(env);
const db = supabaseClient(env);
const SITE = await resolveTarget({ runner: 'scripts/slot-attendees-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) { console.error('STRIPE_WEBHOOK_SECRET is not set'); process.exit(1); }

const DOMAIN = 'gallowayslotattend.test';
const TAG = 'gg-slot-attend-seed';
const COTTAGE_GUESTS = 6;

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
async function payFor(total, account, orderId, providerId, bookingId) {
    const { amountPence, feePence } = priceParts(total);
    return stripe.request('POST', '/payment_intents', {
        amount: amountPence, currency: 'gbp', payment_method: 'pm_card_visa', payment_method_types: ['card'],
        confirm: 'true', on_behalf_of: account, application_fee_amount: feePence,
        transfer_data: { destination: account }, description: TAG,
        metadata: { kind: 'slot_order', order_id: orderId, provider_id: providerId, booking_id: bookingId },
    });
}
async function postWebhook(order, pi, guestEmail) {
    const obj = { payment_intent: pi, customer_email: guestEmail, customer_details: { email: guestEmail },
        metadata: { kind: 'slot_order', order_id: order, provider_id: '', booking_id: '' } };
    const payload = JSON.stringify({ id: 'evt_slotattend_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', data: { object: obj } });
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
async function get(routePath, cookie) {
    const res = await fetch(SITE + routePath, { headers: { ...(cookie ? { cookie } : {}) } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function orderRow(id) { const [r] = await db.select('service_orders', '?select=*&id=eq.' + id); return r; }
async function latestOrder(providerId, date, time) {
    const rows = await db.select('service_orders', '?select=*&provider_id=eq.' + providerId + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00&order=created_at.desc&limit=1');
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
async function makeProvider(owner, account, name, trade, fulfilment, capacity) {
    const [prov] = await db.insert('service_providers', { owner_id: owner.id, business_name: name, trade, audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_turnaround_minutes: 0, slot_capacity: capacity, slot_min_people: 1, fulfilment, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [item] = await db.insert('service_provider_items', { provider_id: prov.id, name: 'Private session', description: 'A private session', price: 50, unit: 'flat', active: true, sort_order: 0, duration_minutes: 60 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: prov.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });
    return { prov, item };
}

/* -------------------------------------------------------------------- main */
async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE);
    console.log('\nseeding…');
    await resetSeed();
    const account = await pickAccount();
    const guest = await createUser('guest', 'Attend Guest');
    const host = await createUser('host', 'Attend Host');
    const owner = await createUser('owner', 'Attend Owner');
    const [listing] = await db.insert('listings', { host_id: host.id, title: 'ATTEND — cottage', description: 'seed', location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 8, status: 'published', cancellation_policy: 'Moderate' });
    const [booking] = await db.insert('bookings', { listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: dayOffset(1), check_out: dayOffset(30), guests: COTTAGE_GUESTS, adults: COTTAGE_GUESTS, total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500, commission_rate: 10, paid_at: new Date().toISOString() });

    // Y: a come-to-me studio, capacity 12 (≥ the cottage) — a private session for
    // six is allowed. C: a come-to-me studio with capacity 4 (BELOW the cottage) —
    // capacity binds. T: a travelling teacher, no declared capacity — the cottage
    // binds.
    // Distinct trades to satisfy the (owner_id, trade) uniqueness — the cap logic
    // is category-independent (slot_capacity + the cottage), so this doesn't change
    // what's proven.
    const Y = await makeProvider(owner, account, 'Attend Yoga (studio)', 'yoga', 'collection', 12);
    const C = await makeProvider(owner, account, 'Attend Pottery (small studio)', 'pottery', 'collection', 4);
    const T = await makeProvider(owner, account, 'Attend Painting (travels)', 'painting', 'delivery', null);

    const guestCookie = await asUser('guest');
    const bookSlot = (provId, itemId, date, time, attendees) => post('/api/services/slots/book', guestCookie, { providerId: provId, bookingId: booking.id, itemId, sessionDate: date, sessionTime: time, quantity: 1, attendees });
    async function bookConfirm(p, date, time, attendees) {
        const b = await bookSlot(p.prov.id, p.item.id, date, time, attendees);
        if (b.status !== 200 || !b.body.ok) throw new Error('book failed ' + b.status + ' ' + JSON.stringify(b.body));
        const order = await latestOrder(p.prov.id, date, time);
        const pi = await payFor(50, account, order.id, p.prov.id, booking.id);
        await postWebhook(order.id, pi.id, guest.email);
        return await orderRow(order.id);
    }

    const T0 = dayOffset(5);

    /* ===================== 1. booked for six, price unchanged =============== */
    scenario('1', 'A private session booked for SIX carries the count on the order; the price is unchanged, quantity is 1');
    {
        const six = await bookConfirm(Y, T0, '10:00', 6);
        check('the order carries attendees = 6', Number(six.attendees) === 6, 'attendees=' + six.attendees);
        check('the price is the item price (£50), unchanged by the count', Number(six.price) === 50, 'price=' + six.price);
        check('it is one booking (quantity 1), not six', Number(six.quantity) === 1, 'quantity=' + six.quantity);

        const two = await bookConfirm(Y, T0, '11:00', 2);
        check('a second private session for TWO carries attendees = 2', Number(two.attendees) === 2, 'attendees=' + two.attendees);
        check('and the SAME price (£50) — the head count never touches price', Number(two.price) === 50, 'price=' + two.price);
        note('A private session is one flat price; attendees is recorded beside it, not multiplied into it.');
    }

    /* ===================== 2. the provider sees it ========================== */
    scenario('2', 'The provider sees the head count on their orders');
    {
        const ownerCookie = await asUser('owner');
        const res = await get('/api/services/orders?provider=' + Y.prov.id, ownerCookie);
        const orders = (res.body && (res.body.orders || res.body)) || [];
        const six = Array.isArray(orders) ? orders.find((o) => o.service_time === '10:00:00' || o.service_time === '10:00') : null;
        check('the provider’s orders feed returns the 10:00 booking', !!six, 'found=' + !!six + ' count=' + (Array.isArray(orders) ? orders.length : 'n/a'));
        check('and it shows attendees = 6', six && Number(six.attendees) === 6, six && ('attendees=' + six.attendees));
        note('ProviderSlotDashboard reads this feed and renders "party of 6" beside the booking.');
    }

    /* ===================== 3. the honest cap, per shape ===================== */
    scenario('3', 'The cap is honest per shape: a small studio (capacity 4) binds at 4; a traveller (no capacity) binds at the cottage (6)');
    {
        // C: capacity 4, below the cottage's 6 — the provider's space binds.
        const cOrder = await bookConfirm(C, T0, '10:00', 99);
        check('a come-to-me studio of capacity 4 clamps an over-ask (99) to 4', Number(cOrder.attendees) === 4, 'attendees=' + cOrder.attendees);
        // T: no declared capacity — the cottage's guest count (6) binds.
        const tOrder = await bookConfirm(T, T0, '10:00', 99);
        check('a travelling provider (no capacity) clamps the same over-ask to the cottage’s 6', Number(tOrder.attendees) === COTTAGE_GUESTS, 'attendees=' + tOrder.attendees);
        note('slot_capacity binds where declared; otherwise the cottage guest count does — nothing invented, and never above who is staying.');
    }

    /* --------------------------------------------------------------- summary */
    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-ATTENDEES.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, account, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(64) + '\n  passed ' + passed + '   failed ' + failed + '\n  written to SCENARIO-RESULTS-SLOT-ATTENDEES.json\n' + '='.repeat(64));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-attendees scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
