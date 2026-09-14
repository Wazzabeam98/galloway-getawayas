// Slot INTERVAL OVERLAP — proving the per-treatment-duration booking model with
// REAL test-mode bookings, and reading the rows back from the database.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3190 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-overlap-scenarios.mjs
//   (SITE_URL is chosen and safety-checked by scripts/target.cjs.)
//
// When session length belonged to the provider every session was the same length
// and the day tiled into non-overlapping cells, so a start-time stood in for
// "this provider is busy". Massage breaks that: a masseuse sells 30/60/90-minute
// treatments, two of them can occupy the same person at once, and the old guard
// (unique(provider,date,time) + the seat CAS) could not see it. This proves the
// fix, both halves of it:
//
//   1. THE CLAIM CATCHES IT BEFORE STRIPE — a long booking, then a short one that
//      overlaps it, refused (409) with no Checkout spun up and the first booking
//      untouched.
//   2. TWO NON-OVERLAPPING TREATMENTS BOTH SUCCEED — back-to-back, both booked.
//   3. A GROUP SESSION STILL TAKES SEVERAL AT ONCE — the interval guard is inert
//      for a fixed-grid shared table; seats still accumulate on one time.
//   4. TURNAROUND ALONE CAUSES THE REFUSAL — a pair that is legal on duration
//      (back-to-back) is refused once the reset gap is counted; the identical pair
//      with turnaround 0 both succeed. Isolates the reset, and shows it is frozen.
//   5. THE DATABASE IS THE AUTHORITY — a write that skips the claim's courtesy
//      check (the race the claim could let through) is refused by the exclusion
//      constraint itself, 23P01.
//
// Established bookings are paid + confirmed with the SAME forged destination
// charge + self-signed webhook the other slot scenarios use, so the seat that
// blocks is a real, paid, confirmed one. Refused attempts touch no Stripe — that
// is the point.

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
const SITE = await resolveTarget({ runner: 'scripts/slot-overlap-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) { console.error('STRIPE_WEBHOOK_SECRET is not set'); process.exit(1); }

const DOMAIN = 'gallowayslotoverlap.test';
const TAG = 'gg-slot-overlap-seed';

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
    const payload = JSON.stringify({ id: 'evt_slotover_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', data: { object: obj } });
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
async function setTurnaround(provId, mins) { await db.update('service_providers', '?id=eq.' + provId, { slot_turnaround_minutes: mins }); }

/* -------------------------------------------------------------------- main */
async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE);
    console.log('\nseeding…');
    await resetSeed();
    const account = await pickAccount();
    const guest = await createUser('guest', 'Overlap Guest');
    const host = await createUser('host', 'Overlap Host');
    const owner = await createUser('owner', 'Overlap Owner');
    const [listing] = await db.insert('listings', { host_id: host.id, title: 'OVERLAP — cottage', description: 'seed', location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 6, status: 'published', cancellation_policy: 'Moderate' });
    const [booking] = await db.insert('bookings', { listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: dayOffset(1), check_out: dayOffset(30), guests: 2, adults: 2, total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500, commission_rate: 10, paid_at: new Date().toISOString() });

    // A MASSEUSE — the per-treatment shape. Flat items (private, capacity 1), each
    // with its own duration. slot_length_minutes is a fallback only; treatments
    // carry duration_minutes.
    const [masseuse] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Overlap Massage', trade: 'massage', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_turnaround_minutes: 0, slot_capacity: 1, slot_min_people: 1, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [m90] = await db.insert('service_provider_items', { provider_id: masseuse.id, name: 'Deep tissue 90', description: '90 minutes', price: 90, unit: 'flat', active: true, sort_order: 0, duration_minutes: 90 });
    const [m60] = await db.insert('service_provider_items', { provider_id: masseuse.id, name: 'Swedish 60', description: '60 minutes', price: 60, unit: 'flat', active: true, sort_order: 1, duration_minutes: 60 });
    const [m30] = await db.insert('service_provider_items', { provider_id: masseuse.id, name: 'Express 30', description: '30 minutes', price: 30, unit: 'flat', active: true, sort_order: 2, duration_minutes: 30 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: masseuse.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });

    // A TASTING — the fixed-grid group shape, unchanged. One provider length, a
    // per-person shared table, no per-item duration.
    const [tasting] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Overlap Tastings', trade: 'tasting', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_turnaround_minutes: 0, slot_capacity: 8, slot_min_people: 1, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [tSeat] = await db.insert('service_provider_items', { provider_id: tasting.id, name: 'Join a tasting', description: 'A seat', price: 30, unit: 'person', active: true, sort_order: 0 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: tasting.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });

    const guestCookie = await asUser('guest');
    const bookSlot = (provId, itemId, date, time, qty) => post('/api/services/slots/book', guestCookie, { providerId: provId, bookingId: booking.id, itemId, sessionDate: date, sessionTime: time, quantity: qty || 1 });
    async function bookConfirm(provId, itemId, date, time, qty, total) {
        const b = await bookSlot(provId, itemId, date, time, qty);
        if (b.status !== 200 || !b.body.ok) throw new Error('book failed ' + b.status + ' ' + JSON.stringify(b.body));
        const order = await latestOrder(provId, date, time);
        const pi = await payFor(total, account, order.id, provId, booking.id);
        await postWebhook(order.id, pi.id, guest.email);
        return { order: await orderRow(order.id), pi };
    }

    /* ===================== 1. the claim catches an overlap BEFORE Stripe ===== */
    scenario('1', 'A long booking, then a short one that overlaps it — refused (409) before Stripe, first booking untouched');
    {
        const T = dayOffset(5);
        // 90-min grid steps by 90 from 09:00 → 09:00 is a real start; it blocks 09:00–10:30.
        const long = await bookConfirm(masseuse.id, m90.id, T, '09:00', 1, 90);
        check('the 90-min treatment is booked, paid and confirmed', long.order.status === 'confirmed', long.order.status);
        const sL = await sessionRow(masseuse.id, T, '09:00');
        check('its session froze duration 90, turnaround 0, 1 seat', sL && sL.duration_minutes === 90 && sL.turnaround_minutes === 0 && sL.seats_taken === 1, sL && ('dur=' + sL.duration_minutes + ' turn=' + sL.turnaround_minutes + ' seats=' + sL.seats_taken));
        check('the frozen order carries duration 90', long.order.duration_minutes === 90, String(long.order.duration_minutes));

        // 30-min at 10:00 is on the 30-min grid, and 10:00–10:30 overlaps 09:00–10:30.
        const clash = await bookSlot(masseuse.id, m30.id, T, '10:00', 1);
        check('the overlapping 30-min booking is REFUSED with 409', clash.status === 409, 'HTTP ' + clash.status);
        check('the guest sees "that time just filled up"', /just filled up/i.test(clash.body.error || ''), clash.body.error);
        check('no order was created for the refused attempt (no Stripe touched)', (await ordersAt(masseuse.id, T, '10:00')).length === 0, 'orders at 10:00');
        const sL2 = await sessionRow(masseuse.id, T, '09:00');
        check('the first booking is untouched (still 1 seat, dur 90)', sL2 && sL2.seats_taken === 1 && sL2.duration_minutes === 90, sL2 && ('seats=' + sL2.seats_taken));
        note('The claim refuses the overlap on the read BEFORE any Checkout is created — the friendly half of the guard.');
    }

    /* ===================== 2. two non-overlapping treatments both succeed ==== */
    scenario('2', 'Two non-overlapping 60-min treatments, back-to-back, both succeed');
    {
        const T = dayOffset(6);
        const a = await bookConfirm(masseuse.id, m60.id, T, '10:00', 1, 60);   // 10:00–11:00
        const b = await bookConfirm(masseuse.id, m60.id, T, '11:00', 1, 60);   // 11:00–12:00
        check('the 10:00 booking is confirmed', a.order.status === 'confirmed', a.order.status);
        check('the 11:00 booking is confirmed', b.order.status === 'confirmed', b.order.status);
        const s1 = await sessionRow(masseuse.id, T, '10:00');
        const s2 = await sessionRow(masseuse.id, T, '11:00');
        check('both sessions exist, each with 1 seat and duration 60', s1 && s2 && s1.seats_taken === 1 && s2.seats_taken === 1 && s1.duration_minutes === 60 && s2.duration_minutes === 60, JSON.stringify({ s1: s1 && s1.seats_taken, s2: s2 && s2.seats_taken }));
        note('Adjacent intervals [10:00,11:00) and [11:00,12:00) do not overlap — the guard is silent when it should be.');
    }

    /* ===================== 3. a group session still takes several at once ==== */
    scenario('3', 'A shared table still takes several bookings on the same time; the interval guard is inert for it');
    {
        const T = dayOffset(7), time = '13:00';
        const a = await bookConfirm(tasting.id, tSeat.id, T, time, 2, 60);   // 2 seats
        const b = await bookConfirm(tasting.id, tSeat.id, T, time, 1, 30);   // 1 more, same time
        check('both shared bookings on the same time confirmed', a.order.status === 'confirmed' && b.order.status === 'confirmed', a.order.status + '/' + b.order.status);
        const s = await sessionRow(tasting.id, T, time);
        check('the one session holds 3 seats (several bookings, same time)', s && s.seats_taken === 3 && s.private === false, s && ('seats=' + s.seats_taken + ' private=' + s.private));
        // A second, adjacent group time is not a false overlap.
        const c = await bookConfirm(tasting.id, tSeat.id, T, '14:00', 1, 30);
        check('an adjacent group time books fine (no false overlap)', c.order.status === 'confirmed', c.order.status);
        note('Same-start bookings share one session (seat CAS); different-start group times tile and never overlap.');
    }

    /* ===================== 4. turnaround ALONE causes the refusal =========== */
    scenario('4', 'The same pair — a 60 at 09:00 then a 30 at 10:00 — both succeed with no reset, but the 30 is refused once a 30-minute reset is counted');
    {
        // The two start-times (09:00, 10:00) are valid on BOTH the reset-0 and the
        // reset-30 grids, so ONLY the reset differs between the sub-cases — the
        // clean isolation. On duration alone the 60 ends at 10:00 and the 30 begins
        // at 10:00: exactly back-to-back, no overlap. The reset pushes the 60's
        // block to 10:30, so the 30 at 10:00 now lands inside it.

        // Sub-case A: reset 0. Back-to-back, both legal.
        await setTurnaround(masseuse.id, 0);
        const T0 = dayOffset(8);
        const a0 = await bookConfirm(masseuse.id, m60.id, T0, '09:00', 1, 60);   // 09:00–10:00
        const b0 = await bookSlot(masseuse.id, m30.id, T0, '10:00', 1);          // 10:00–10:30
        check('with reset 0, the 60 then the back-to-back 30 both succeed', a0.order.status === 'confirmed' && b0.status === 200 && b0.body.ok, 'HTTP ' + b0.status + ' ' + JSON.stringify(b0.body).slice(0, 80));

        // Sub-case B: reset 30. Identical pair, identical start-times. The 60 now
        // blocks 09:00–10:30, so the 30 at 10:00 overlaps by the reset gap alone.
        await setTurnaround(masseuse.id, 30);
        const T1 = dayOffset(9);
        const a1 = await bookConfirm(masseuse.id, m60.id, T1, '09:00', 1, 60);
        const sA = await sessionRow(masseuse.id, T1, '09:00');
        check('the 60-min session froze the 30-minute reset', sA && sA.turnaround_minutes === 30 && sA.duration_minutes === 60, sA && ('dur=' + sA.duration_minutes + ' turn=' + sA.turnaround_minutes));
        const b1 = await bookSlot(masseuse.id, m30.id, T1, '10:00', 1);
        check('the SAME 30 at 10:00 is now REFUSED (409) — the reset gap alone causes it', b1.status === 409, 'HTTP ' + b1.status + ' ' + JSON.stringify(b1.body).slice(0, 80));
        check('no order created for the refused attempt', (await ordersAt(masseuse.id, T1, '10:00')).length === 0, 'orders at 10:00');

        // And the day-8 booking, frozen at reset 0, is unchanged by raising the reset.
        const sZero = await sessionRow(masseuse.id, T0, '09:00');
        check('the earlier booking, frozen at reset 0, is untouched by the later change', sZero && sZero.turnaround_minutes === 0, sZero && String(sZero.turnaround_minutes));
        await setTurnaround(masseuse.id, 0);
        note('Same bookings, same times; only the reset changed, and the refusal changed with it — proof the reset is in the blocking interval, and frozen per booking.');
    }

    /* ===================== 5. the DATABASE is the authority ================= */
    scenario('5', 'A booked overlap written directly — the race the claim could let through — is refused by the exclusion constraint (23P01)');
    {
        const T = dayOffset(10);
        const a = await bookConfirm(masseuse.id, m60.id, T, '10:00', 1, 60);   // blocks 10:00–11:00
        check('a 60-min booking holds the time', a.order.status === 'confirmed', a.order.status);
        // Simulate a claim that skipped the courtesy check and tried to establish an
        // overlapping booked session directly. The database must refuse it.
        let rejected = false, code = null;
        try {
            await db.insert('slot_sessions', { provider_id: masseuse.id, session_date: T, session_time: '10:30:00', capacity: 1, seats_taken: 1, private: true, duration_minutes: 30, turnaround_minutes: 0 });
        } catch (e) {
            rejected = true; code = (e && (e.code || e.message)) || '';
        }
        check('the overlapping booked row is REJECTED by the database', rejected, 'insert unexpectedly succeeded');
        check('the rejection is the no-overlap exclusion constraint (23P01)', /23P01|slot_sessions_no_overlap|exclusion/i.test(String(code)), String(code).slice(0, 120));
        const at1030 = await db.select('slot_sessions', '?select=id&provider_id=eq.' + masseuse.id + '&session_date=eq.' + T + '&session_time=eq.10:30:00');
        check('no overlapping session row exists after the refusal', at1030.length === 0, at1030.length + ' rows');
        note('The claim is not the guard — the database is. A write that slips past app code is still refused.');
    }

    /* --------------------------------------------------------------- summary */
    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-OVERLAP.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, account, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(64) + '\n  passed ' + passed + '   failed ' + failed + '\n  written to SCENARIO-RESULTS-SLOT-OVERLAP.json\n' + '='.repeat(64));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-overlap scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
