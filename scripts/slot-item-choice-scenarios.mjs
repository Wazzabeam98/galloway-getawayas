// Slot item choice — proving /slots/book honours the guest's chosen itemId
// rather than the provider's first item, and derives unit, capacity, the mode
// (private/shared) and the minimum from THAT item. Scenario 4 additionally
// guards the capacity invariant: a per-person item on a provider with no
// slot_capacity is refused up front, never sold as a one-seat shared table.
//
//   GUEST_EXPERIENCES_OPEN=true PORT=3190 npm run dev
//   SITE_URL=<that dev server> node scripts/slot-item-choice-scenarios.mjs
//   (SITE_URL is chosen and safety-checked by scripts/target.cjs.)
//
// Piece (2) is routing, not a money path — the item, unit, capacity, mode and
// minimum are all fixed at the booking/claim step, BEFORE any charge — so this
// proves it there, without moving money. It drives the REAL route against a
// guarded dev server. (A real connected account is used only so the route's
// Checkout Session creates; nothing is paid.)
//
// The provider is seeded with TWO slot items, deliberately with the per-person
// one FIRST by sort order, so "the route used items[0]" and "the route used the
// chosen item" give different answers — and the assertions pin the chosen one.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    signIn, dayOffset, ROOT,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const stripe = stripeClient(env);
const db = supabaseClient(env);
const SITE = await resolveTarget({ runner: 'scripts/slot-item-choice-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });

const DOMAIN = 'gallowayslotitem.test';
const TAG = 'gg-slot-item-seed';

const results = [];
let current = null;
function scenario(n, title) { current = { number: n, title, checks: [], status: 'passed' }; results.push(current); console.log('\n── ' + n + '. ' + title); }
function check(desc, cond, detail) { const ok = !!cond; current.checks.push({ desc, ok, detail: detail || null }); if (!ok) current.status = 'failed'; console.log('   ' + (ok ? '✓' : '✗') + ' ' + desc + (detail && !ok ? '  — ' + detail : '')); }
function note(t) { console.log('   · ' + t); }

async function asUser(label) { const { cookie } = await signIn(env, label + '@' + DOMAIN, 'seed-password-' + label); return cookie; }
async function bookSlot(cookie, providerId, bookingId, date, time, itemId, qty) {
    const res = await fetch(SITE + '/api/services/slots/book', { method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId, itemId, bookingId, sessionDate: date, sessionTime: time, quantity: qty }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function latestOrder(providerId, date, time) {
    const r = await db.select('service_orders', '?select=*&provider_id=eq.' + providerId + '&service_date=eq.' + date + '&service_time=eq.' + time + ':00&order=created_at.desc&limit=1');
    return r[0];
}
async function sessionRow(providerId, date, time) {
    const r = await db.select('slot_sessions', '?select=*&provider_id=eq.' + providerId + '&session_date=eq.' + date + '&session_time=eq.' + time + ':00&limit=1');
    return r[0];
}

async function resetSeed() {
    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + DOMAIN));
    if (!seeded.length) return;
    const ids = '(' + seeded.map((u) => u.id).join(',') + ')';
    const provs = await db.select('service_providers', '?select=id&owner_id=in.' + ids);
    for (const p of provs) { await db.remove('service_orders', '?provider_id=eq.' + p.id); for (const t of ['slot_sessions', 'slot_availability', 'slot_blocks', 'service_provider_items']) await db.remove(t, '?provider_id=eq.' + p.id); }
    await db.remove('service_providers', '?owner_id=in.' + ids);
    const bookings = await db.select('bookings', '?select=id&guest_id=in.' + ids);
    for (const b of bookings) { await db.remove('service_orders', '?booking_id=eq.' + b.id); }
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
    for (const id of ids) { const a = await stripe.request('GET', '/accounts/' + id).catch(() => null); const c = (a && a.capabilities) || {}; if (a && a.payouts_enabled && c.transfers === 'active' && c.card_payments === 'active') { console.log('  reusing account ' + id); return id; } }
    throw new Error('no reusable connected account — run scripts/seed-payments.mjs first');
}

async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE + '\n\nseeding…');
    await resetSeed();
    const account = await pickAccount();
    const guest = await createUser('guest', 'Item Guest');
    const host = await createUser('host', 'Item Host');
    const owner = await createUser('owner', 'Item Owner');
    const [listing] = await db.insert('listings', { host_id: host.id, title: 'ITEM — cottage', description: 'seed', location: 'Dumfries & Galloway', price_per_night: 100, max_guests: 6, status: 'published', cancellation_policy: 'Moderate' });
    const [booking] = await db.insert('bookings', { listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: dayOffset(1), check_out: dayOffset(20), guests: 4, adults: 4, total_price: 500, status: 'confirmed', payment_status: 'paid', amount_paid: 500, commission_rate: 10, paid_at: new Date().toISOString() });
    // A slot provider that offers BOTH products, with a minimum of 2 on the shared one.
    const [prov] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Item Tastings', trade: 'tasting', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', exclusive_per_date: false, slot_length_minutes: 60, slot_capacity: 8, slot_min_people: 2, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    // Per-person FIRST by sort order, private second — so items[0] is NOT the private one.
    const [shared] = await db.insert('service_provider_items', { provider_id: prov.id, name: 'Join a tasting', description: 'A seat at the table', price: 30, unit: 'person', active: true, sort_order: 0 });
    const [priv] = await db.insert('service_provider_items', { provider_id: prov.id, name: 'Private tasting (up to 6)', description: 'The whole table', price: 120, unit: 'flat', active: true, sort_order: 1 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: prov.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });
    // A second provider's item, to prove a foreign id can't be booked.
    const [prov2] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'Other', trade: 'other', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', slot_capacity: 4, stripe_account_id: account, stripe_payouts_enabled: true });
    const [foreign] = await db.insert('service_provider_items', { provider_id: prov2.id, name: 'Elsewhere', price: 50, unit: 'flat', active: true, sort_order: 0 });
    // A MISCONFIGURED slot: live to guests, but slot_capacity is null. A
    // per-person item on it has no seats — the state that used to sell a shared
    // table as a one-seat private hire. It also carries a flat item, to prove the
    // guard bites per-person only and a private hire on the same provider is fine.
    const [provNoCap] = await db.insert('service_providers', { owner_id: owner.id, business_name: 'No Capacity', trade: 'nocap', audience: 'guest', status: 'approved', plan: 'commission', commission_rate: 0.10, shape: 'slot', slot_length_minutes: 60, slot_capacity: null, cancellation_window_hours: 12, contact_email: 'owner@' + DOMAIN, stripe_account_id: account, stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_details_submitted: true });
    const [noCapPerson] = await db.insert('service_provider_items', { provider_id: provNoCap.id, name: 'Seat, no seats set', description: 'per person, but the host set no capacity', price: 40, unit: 'person', active: true, sort_order: 0 });
    const [noCapFlat] = await db.insert('service_provider_items', { provider_id: provNoCap.id, name: 'Whole table', description: 'a private hire needs no capacity', price: 150, unit: 'flat', active: true, sort_order: 1 });
    for (let d = 0; d < 7; d++) await db.insert('slot_availability', { provider_id: provNoCap.id, day_of_week: d, open_time: '09:00', close_time: '17:00' });

    const cookie = await asUser('guest');
    console.log('  items: shared(person,£30,sort0)=' + shared.id.slice(0, 8) + '  private(flat,£120,sort1)=' + priv.id.slice(0, 8));

    /* ===== 1. the chosen item is honoured — the PRIVATE one, though items[0] is shared */
    scenario('1', 'Booking the private item (not items[0]) makes a private hire — the route used the chosen id');
    {
        const T = dayOffset(5), time = '10:00';
        const r = await bookSlot(cookie, prov.id, booking.id, T, time, priv.id, 1);
        check('book accepted', r.status === 200 && r.body.ok, 'HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
        const o = await latestOrder(prov.id, T, time);
        check('the order is for the PRIVATE item, not items[0] (shared)', o && o.item_id === priv.id, o && ('item_id=' + (o.item_id || '').slice(0, 8)));
        check('unit/price came from that item (flat, £120)', o && o.item_unit === 'flat' && Number(o.price) === 120, o && (o.item_unit + ' £' + o.price));
        const s = await sessionRow(prov.id, T, time);
        check('the time is a private hire — private=true, capacity 1', s && s.private === true && s.capacity === 1, s && ('private=' + s.private + ' cap=' + s.capacity));
        note('If the route still used items[0], this would be the shared item and a shared session — it is not.');
    }

    /* ===== 2. the minimum comes from the chosen item's unit */
    scenario('2', 'The shared item enforces its minimum; the private item ignores it');
    {
        const U = dayOffset(6), time = '11:00';
        const under = await bookSlot(cookie, prov.id, booking.id, U, time, shared.id, 1);
        check('one seat on the shared item is refused (minimum 2)', under.status === 400 && /minimum of 2/i.test(under.body.error || ''), 'HTTP ' + under.status + ' ' + (under.body.error || ''));
        const ok = await bookSlot(cookie, prov.id, booking.id, U, time, shared.id, 2);
        check('two seats is accepted', ok.status === 200 && ok.body.ok, 'HTTP ' + ok.status + ' ' + JSON.stringify(ok.body).slice(0, 100));
        const o = await latestOrder(prov.id, U, time);
        check('the order is the shared item, 2 seats, £60', o && o.item_id === shared.id && o.quantity === 2 && Number(o.price) === 60, o && (o.item_unit + ' q' + o.quantity + ' £' + o.price));
        const s = await sessionRow(prov.id, U, time);
        check('the time is a shared table — private=false, capacity 8, 2 seats', s && s.private === false && s.capacity === 8 && s.seats_taken === 2, s && ('private=' + s.private + ' cap=' + s.capacity + ' seats=' + s.seats_taken));
        // The private item, on a fresh time, ignores the minimum (quantity is 1).
        const W = dayOffset(7), t2 = '12:00';
        const pv = await bookSlot(cookie, prov.id, booking.id, W, t2, priv.id, 1);
        check('the private item books with no minimum applied', pv.status === 200 && pv.body.ok, 'HTTP ' + pv.status);
    }

    /* ===== 3. validation — a bogus or foreign item id cannot be booked */
    scenario('3', 'An unknown or another provider’s item id is refused');
    {
        const V = dayOffset(8), time = '13:00';
        const bogus = await bookSlot(cookie, prov.id, booking.id, V, time, crypto.randomUUID(), 1);
        check('an unknown item id is refused (400)', bogus.status === 400, 'HTTP ' + bogus.status + ' ' + (bogus.body.error || ''));
        const foreignRes = await bookSlot(cookie, prov.id, booking.id, V, time, foreign.id, 1);
        check('another provider’s item id is refused (400)', foreignRes.status === 400, 'HTTP ' + foreignRes.status + ' ' + (foreignRes.body.error || ''));
        const s = await sessionRow(prov.id, V, time);
        check('no seat was claimed for the refused bookings', !s || s.seats_taken === 0, s && String(s.seats_taken));
    }

    /* ===== 4. the capacity invariant — a per-person item with no capacity is refused */
    scenario('4', 'A per-person item with no slot_capacity is refused before the seat claim and before Stripe; a flat item on the same provider still books');
    {
        const X = dayOffset(9), time = '14:00';
        const bad = await bookSlot(cookie, provNoCap.id, booking.id, X, time, noCapPerson.id, 1);
        check('the per-person item is refused (400)', bad.status === 400, 'HTTP ' + bad.status + ' ' + (bad.body.error || ''));
        check('the guest is told the host has not set how many people it is for', /how many people|isn.t bookable/i.test(bad.body.error || ''), bad.body.error || '');
        const s = await sessionRow(provNoCap.id, X, time);
        check('no seat was claimed (no session row, or zero seats)', !s || s.seats_taken === 0, s && String(s.seats_taken));
        const o = await latestOrder(provNoCap.id, X, time);
        check('no holding order was created — refused before Stripe', !o, o && ('order ' + o.status));
        // The guard is per-person only: a private hire needs no capacity.
        const flat = await bookSlot(cookie, provNoCap.id, booking.id, X, time, noCapFlat.id, 1);
        check('the flat item on the same capacity-less provider still books (a private hire is one booking)', flat.status === 200 && flat.body.ok, 'HTTP ' + flat.status + ' ' + JSON.stringify(flat.body).slice(0, 100));
        note('The bad state used to sell a shared table as a one-seat private hire at a per-person price; it is now refused up front.');
    }

    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-SLOT-ITEM.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(60) + '\n  passed ' + passed + '   failed ' + failed + '\n' + '='.repeat(60));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nslot-item scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
