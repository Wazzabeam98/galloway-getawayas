// DECLARED SESSIONS — the guest side, proven with real Stripe test money.
//
// A declared session is a slot_sessions row the provider created up front, with
// its OWN capacity, length and mode. Piece 3 lets a guest book into it. The two
// things that could go wrong are exactly what this proves, against a running
// server and real test-mode charges (not code inspection):
//
//   * ADOPT, NOT OVERWRITE + the ROW WINS. The declared row's capacity is the
//     seat pool, NOT seatConfig's — so a session declared for 2 on a provider
//     whose default is 4 fills at 2. If seatConfig won, the race below would
//     overfill to 3.
//   * THE LAST-PLACE RACE on a DECLARED row. Two guests taking the last seat at
//     once must not both succeed — the adopt path is new code, and that's where
//     a mistake would let both through.
//
// Plus: booking a NON-TEMPLATE time (the declared row is its own authority), the
// DB exclusion backstop (23P01), and release keeping the row declared.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3190 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-declared-scenarios.mjs
//
// TEST PROJECT ONLY (assertTestEnvironment). Needs Stripe test keys +
// STRIPE_WEBHOOK_SECRET and a connected account from scripts/seed-payments.mjs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    signIn, dayOffset, ROOT,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const stripe = stripeClient(env);
const db = supabaseClient(env);
const SITE = await resolveTarget({ runner: 'scripts/slot-declared-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) { console.error('STRIPE_WEBHOOK_SECRET is not set'); process.exit(1); }

const DOMAIN = 'gallowaydeclared.test';
const TAG = 'gg-slot-declared-seed';

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
async function payFor(total, account, orderId, providerId) {
    const { amountPence, feePence } = priceParts(total);
    return stripe.request('POST', '/payment_intents', {
        amount: amountPence, currency: 'gbp', payment_method: 'pm_card_visa', payment_method_types: ['card'],
        confirm: 'true', on_behalf_of: account, application_fee_amount: feePence,
        transfer_data: { destination: account }, description: TAG,
        metadata: { kind: 'slot_order', order_id: orderId, provider_id: providerId, booking_id: '' },
    });
}
async function postWebhook(order, pi, guestEmail) {
    const obj = { payment_intent: pi, customer_email: guestEmail, customer_details: { email: guestEmail },
        metadata: { kind: 'slot_order', order_id: order, provider_id: '', booking_id: '' } };
    const payload = JSON.stringify({ id: 'evt_declared_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', data: { object: obj } });
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
async function ordersAt(providerId, date, time) {
    return db.select('service_orders', '?select=id,status,guest_id&provider_id=eq.' + providerId + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00');
}
async function declaredRowAt(providerId, date, time) {
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
    const owner = await createUser('owner', 'Declared Owner');
    const A = await createUser('guesta', 'Guest A');
    const B = await createUser('guestb', 'Guest B');
    const C = await createUser('guestc', 'Guest C');

    // A SAUNA. Provider DEFAULT capacity 4 — but the declared session below is for
    // 2. If the row didn't win, the race would overfill to 3. No weekly hours: the
    // declared session sits at a time no template would generate, proving the row
    // is its own authority.
    const [sauna] = await db.insert('service_providers', {
        owner_id: owner.id, business_name: 'Declared Sauna', trade: 'sauna', audience: 'guest', status: 'approved',
        plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false,
        slot_length_minutes: 60, slot_turnaround_minutes: 0, slot_capacity: 4, slot_min_people: 1,
        cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN,
        stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true,
    });
    const [seat] = await db.insert('service_provider_items', { provider_id: sauna.id, name: 'Sauna social — a place', description: 'One place at the social', price: 15, unit: 'person', active: true, sort_order: 0 });

    // THE DECLARED SESSION: capacity 2 (≠ the provider default 4), a non-template
    // 18:00, 60 minutes, shared.
    const DATE = dayOffset(5);
    const [declared] = await db.insert('slot_sessions', {
        provider_id: sauna.id, session_date: DATE, session_time: '18:00:00',
        declared: true, capacity: 2, seats_taken: 0, private: false,
        duration_minutes: 60, turnaround_minutes: 0, title: 'Sunday sauna social',
    });

    const cookA = await asUser('guesta');
    const cookB = await asUser('guestb');
    const cookC = await asUser('guestc');
    const bookSeat = (cookie, qty) => post('/api/services/slots/book', cookie, { providerId: sauna.id, itemId: seat.id, sessionDate: DATE, sessionTime: '18:00', quantity: qty || 1 });

    /* ============ 1. bookable at a NON-TEMPLATE time; adopt + the row wins ==== */
    scenario('1', 'A declared 6pm (no weekly hours) is bookable, and the row’s capacity/length are adopted — not seatConfig’s');
    let aOrderId = null;
    {
        const b = await bookSeat(cookA, 1);
        check('the declared 6pm books (200) though no weekly template generates it', b.status === 200 && b.body.ok, 'HTTP ' + b.status + ' ' + JSON.stringify(b.body).slice(0, 120));
        if (b.status === 200) {
            const [ord] = await ordersAt(sauna.id, DATE, '18:00');
            aOrderId = ord && ord.id;
            const pi = await payFor(15, account, aOrderId, sauna.id);
            await postWebhook(aOrderId, pi.id, A.email);
            const o = await orderRow(aOrderId);
            check('the booking is paid and confirmed', o && o.status === 'confirmed', o && o.status);
        }
        const row = await declaredRowAt(sauna.id, DATE, '18:00');
        check('the session capacity is the DECLARED 2, not the provider default 4 (the row wins)', row && Number(row.capacity) === 2, row && ('capacity=' + row.capacity));
        check('the length is the declared 60, and it is still declared', row && Number(row.duration_minutes) === 60 && row.declared === true, row && ('dur=' + row.duration_minutes + ' declared=' + row.declared));
        check('one seat is taken', row && Number(row.seats_taken) === 1, row && ('seats=' + row.seats_taken));
        note('If seatConfig had won, capacity would read 4 and the last-place race below would overfill.');
    }

    /* ================= 2. THE LAST-PLACE RACE on the declared row ============= */
    scenario('2', 'Two guests take the LAST place of the declared session at once — exactly one succeeds');
    {
        // Capacity 2, one seat taken. B and C both go for the 2nd (last) place at
        // the same instant.
        const [rb, rc] = await Promise.all([bookSeat(cookB, 1), bookSeat(cookC, 1)]);
        const oks = [rb, rc].filter((r) => r.status === 200 && r.body.ok).length;
        const clashes = [rb, rc].filter((r) => r.status === 409).length;
        check('exactly ONE of the two racers succeeds (200)', oks === 1, 'B=' + rb.status + ' C=' + rc.status);
        check('the other is refused with 409 "just filled up"', clashes === 1 && /just filled up|filled up/i.test((rb.body.error || '') + (rc.body.error || '')), 'B=' + JSON.stringify(rb.body).slice(0, 80) + ' C=' + JSON.stringify(rc.body).slice(0, 80));
        const row = await declaredRowAt(sauna.id, DATE, '18:00');
        check('the session is now FULL at the declared 2 — not overfilled to 3', row && Number(row.seats_taken) === 2, row && ('seats=' + row.seats_taken));
        const orders = await ordersAt(sauna.id, DATE, '18:00');
        check('exactly two orders exist at the session (A + one racer), never three', orders.length === 2, orders.length + ' orders');
        note('The seats-only CAS serialises the take; the loser re-reads a full row and 409s. The DECLARED capacity bounds it.');
    }

    /* ================= 3. the database is the backstop (23P01) =============== */
    scenario('3', 'A direct overlapping booked row is refused by the exclusion constraint');
    {
        let rejected = false, code = '';
        try {
            // 18:30 for 30 min overlaps the declared [18:00,19:00).
            await db.insert('slot_sessions', { provider_id: sauna.id, session_date: DATE, session_time: '18:30:00', capacity: 1, seats_taken: 1, private: true, duration_minutes: 30, turnaround_minutes: 0 });
        } catch (e) { rejected = true; code = (e && (e.code || e.message)) || ''; }
        check('an overlapping booked row is REJECTED by the database', rejected, 'insert unexpectedly succeeded');
        check('the rejection is the no-overlap exclusion (23P01)', /23P01|slot_sessions_no_overlap|exclusion/i.test(String(code)), String(code).slice(0, 120));
    }

    /* ================= 4. release keeps the row declared ===================== */
    scenario('4', 'Cancelling a booking gives the seat back and leaves the session declared');
    {
        const before = await declaredRowAt(sauna.id, DATE, '18:00');
        const cancel = await post('/api/services/orders/cancel', cookA, { orderId: aOrderId, mode: 'refund' });
        check('guest A can cancel their own booking (a full refund)', cancel.status === 200 && cancel.body.ok, 'HTTP ' + cancel.status + ' ' + JSON.stringify(cancel.body).slice(0, 120));
        const after = await declaredRowAt(sauna.id, DATE, '18:00');
        check('a seat is given back (seats_taken decremented)', after && Number(after.seats_taken) === Number(before.seats_taken) - 1, after && ('before=' + before.seats_taken + ' after=' + after.seats_taken));
        check('the session STAYS declared and keeps reserving its time', after && after.declared === true, after && ('declared=' + after.declared));
    }

    /* --------------------------------------------------------------- summary */
    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-DECLARED.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, account, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(64) + '\n  passed ' + passed + '   failed ' + failed + '\n  written to SCENARIO-RESULTS-SLOT-DECLARED.json\n' + '='.repeat(64));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-declared scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
