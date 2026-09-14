// Slot MIXED MENU — one provider offering BOTH a group session and one-at-a-time
// bookings (a yoga teacher with a class and 1:1s), proven with REAL test bookings.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3191 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-mixed-scenarios.mjs
//
// The point of this runner is that the MONEY LAYER needs no change for a mixed
// menu: the interval-overlap claim is shape-agnostic and treats a provider as one
// resource on a timeline. A booked group class blocks the provider's whole
// interval; a 1:1 that overlaps it is refused; several guests still share the one
// class. Here we seed a provider with a per-person class (untimed — it uses the
// provider's session length) AND flat 1:1 items (timed — each its own length),
// book against the real /slots/book route, and read the rows back.
//
// The provider's session length is 75 (deliberately NOT 60) so an untimed booking
// pinning 75 proves it used the provider length, not the 60 fallback default.

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
const SITE = await resolveTarget({ runner: 'scripts/slot-mixed-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) { console.error('STRIPE_WEBHOOK_SECRET is not set'); process.exit(1); }

const DOMAIN = 'gallowayslotmixed.test';
const TAG = 'gg-slot-mixed-seed';
const PROVIDER_LENGTH = 75;   // NOT 60, so an untimed booking pinning 75 proves it.

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
    const payload = JSON.stringify({ id: 'evt_slotmixed_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', data: { object: obj } });
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
async function ordersAt(providerId, date, time) {
    return db.select('service_orders', '?select=id,status&provider_id=eq.' + providerId + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00');
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

/* -------------------------------------------------------------------- main */
async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE);
    console.log('\nseeding…');
    await resetSeed();
    const account = await pickAccount();
    const guest = await createUser('guest', 'Mixed Guest');
    const host = await createUser('host', 'Mixed Host');
    const owner = await createUser('owner', 'Mixed Owner');
    const [listing] = await db.insert('listings', { host_id: host.id, title: 'MIXED — cottage', description: 'seed', location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 6, status: 'published', cancellation_policy: 'Moderate' });
    const [booking] = await db.insert('bookings', { listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: dayOffset(1), check_out: dayOffset(30), guests: 2, adults: 2, total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500, commission_rate: 10, paid_at: new Date().toISOString() });

    // A YOGA TEACHER offering BOTH shapes on one provider: a shared class (per
    // person, UNTIMED — it uses the provider's 75-minute session length and the
    // provider capacity) and 1:1s (flat, TIMED — each carries its own duration).
    const [yoga] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Mixed Yoga', trade: 'yoga', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: PROVIDER_LENGTH, slot_turnaround_minutes: 0, slot_capacity: 12, slot_min_people: 1, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [klass] = await db.insert('service_provider_items', { provider_id: yoga.id, name: 'Morning class', description: 'A shared class', price: 15, unit: 'person', active: true, sort_order: 0, duration_minutes: null });
    const [oneToOne30] = await db.insert('service_provider_items', { provider_id: yoga.id, name: '1:1 · 30 min', description: 'Private, 30 minutes', price: 30, unit: 'flat', active: true, sort_order: 1, duration_minutes: 30 });
    const [oneToOne60] = await db.insert('service_provider_items', { provider_id: yoga.id, name: '1:1 · 60 min', description: 'Private, 60 minutes', price: 60, unit: 'flat', active: true, sort_order: 2, duration_minutes: 60 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: yoga.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });

    const guestCookie = await asUser('guest');
    const bookSlot = (itemId, date, time, qty) => post('/api/services/slots/book', guestCookie, { providerId: yoga.id, bookingId: booking.id, itemId, sessionDate: date, sessionTime: time, quantity: qty || 1 });
    async function bookConfirm(itemId, date, time, qty, total) {
        const b = await bookSlot(itemId, date, time, qty);
        if (b.status !== 200 || !b.body.ok) throw new Error('book failed ' + b.status + ' ' + JSON.stringify(b.body));
        const order = await latestOrder(yoga.id, date, time);
        const pi = await payFor(total, account, order.id, yoga.id, booking.id);
        await postWebhook(order.id, pi.id, guest.email);
        return { order: await orderRow(order.id), pi };
    }

    const T = dayOffset(5);   // one day, both shapes on it

    /* ===================== 1. a group class, several guests ================= */
    scenario('1', 'A shared class takes several guests on one time; the untimed class uses the provider length (75), not the 60 default');
    {
        const a = await bookConfirm(klass.id, T, '09:00', 3, 45);   // 3 seats @ £15
        const b = await bookConfirm(klass.id, T, '09:00', 2, 30);   // 2 more
        check('both class bookings on the same time confirmed', a.order.status === 'confirmed' && b.order.status === 'confirmed', a.order.status + '/' + b.order.status);
        const s = await sessionRow(yoga.id, T, '09:00');
        check('the one class session holds 5 seats out of a capacity of 12, shared', s && s.seats_taken === 5 && s.capacity === 12 && s.private === false, s && ('seats=' + s.seats_taken + '/' + s.capacity + ' private=' + s.private));
        check('the UNTIMED class session froze duration 75 — the provider length, not the 60 fallback', s && s.duration_minutes === PROVIDER_LENGTH, s && ('duration=' + s.duration_minutes));
        check('the class order also froze the provider length (75)', a.order.duration_minutes === PROVIDER_LENGTH, String(a.order.duration_minutes));
        note('An untimed item resolves item.duration_minutes ?? provider.slot_length_minutes = 75, pinned on the session and order.');
    }

    /* ===================== 2. a 1:1 overlapping the class is refused ======== */
    scenario('2', 'A 1:1 that overlaps the running class is refused before Stripe; the class is untouched');
    {
        // The class blocks 09:00–10:15 (75 min). A 30-min 1:1 at 09:30 is 09:30–10:00,
        // inside it — a different start, so this is the interval guard, not a mode-clash.
        const clash = await bookSlot(oneToOne30.id, T, '09:30', 1);
        check('the overlapping 1:1 is REFUSED with 409', clash.status === 409, 'HTTP ' + clash.status + ' ' + JSON.stringify(clash.body).slice(0, 80));
        check('the guest sees "that time just filled up"', /just filled up/i.test(clash.body.error || ''), clash.body.error);
        check('no order was created for the refused 1:1', (await ordersAt(yoga.id, T, '09:30')).length === 0, 'orders at 09:30');
        const s = await sessionRow(yoga.id, T, '09:00');
        check('the class is untouched (still 5 seats)', s && s.seats_taken === 5, s && String(s.seats_taken));
        note('One instructor: a 1:1 cannot run inside a class. Same provider, one timeline — the guard already knows.');
    }

    /* ===================== 3. a non-overlapping 1:1 succeeds ================ */
    scenario('3', 'A 1:1 at a free time succeeds, with ITS OWN length — both shapes live on one provider, one day');
    {
        // The class ends 10:15; a 60-min 1:1 at 11:00 (11:00–12:00) is clear.
        const one = await bookConfirm(oneToOne60.id, T, '11:00', 1, 60);
        check('the 1:1 is booked, paid and confirmed', one.order.status === 'confirmed', one.order.status);
        const s = await sessionRow(yoga.id, T, '11:00');
        check('the TIMED 1:1 session froze its own duration 60, capacity 1, private', s && s.duration_minutes === 60 && s.capacity === 1 && s.private === true, s && ('duration=' + s.duration_minutes + ' cap=' + s.capacity + ' private=' + s.private));
        check('the 1:1 order froze its own length (60), not the provider 75', one.order.duration_minutes === 60, String(one.order.duration_minutes));
        // Both shapes coexist on the same provider + day.
        const klassSess = await sessionRow(yoga.id, T, '09:00');
        check('the class (75, shared, 5 seats) and the 1:1 (60, private) both exist on the same day', klassSess && klassSess.duration_minutes === 75 && s && s.duration_minutes === 60, JSON.stringify({ class: klassSess && klassSess.duration_minutes, oneToOne: s && s.duration_minutes }));
        note('A group class and a 1:1, same provider, same day: the mixed menu the money layer already supported.');
    }

    /* --------------------------------------------------------------- summary */
    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-MIXED.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, account, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(64) + '\n  passed ' + passed + '   failed ' + failed + '\n  written to SCENARIO-RESULTS-SLOT-MIXED.json\n' + '='.repeat(64));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-mixed scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
