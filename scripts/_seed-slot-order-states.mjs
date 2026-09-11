// The order-page states a come-to-me slot needs, so the confirmed-order page can
// be walked for real: the TOWN before payment (a holding order) and the FULL
// address after (a confirmed order), plus a travelling slot that reads "comes to
// your cottage".
//
//   node scripts/_seed-slot-order-states.mjs          # seed, print the order URLs
//   node scripts/_seed-slot-order-states.mjs --reset  # remove everything it made
//
// TEST PROJECT ONLY (seed-lib refuses anything else). This seeds the ORDER ROWS
// directly, in each status — it does NOT push a card through Stripe. The payment
// path that produces 'confirmed' is proven separately by the crosscutting webhook
// scenarios; what this exercises is the order-page DISPLAY, which reads only the
// order status, the provider's fulfilment, and its collection address. The
// collection_* columns are private (revoked from authenticated) but the order
// page reads them via the service role, so seeding them here is faithful.

import { loadEnv, supabaseClient, TEST_PROJECT_REF, dayOffset } from './seed-lib.mjs';

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')');
    process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set'); process.exit(1); }

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const ME = 'liamworrall18@hotmail.com';
const BOOKING_PI = 'pi_seed_slotstates';
const COME_NAME = 'SLOTSTATE come-to-me tasting';
const TRAVEL_NAME = 'SLOTSTATE travelling yoga';
const ORDER_TAG = 'SLOTSTATE';

// Two throwaway owner accounts for the two providers — one guest business per
// account is a DB rule ((owner_id, trade) unique), so a come-to-me and a
// travelling slot can't share an owner. The ORDERS are the viewer's (ME); the
// providers just need to exist and be readable by the order page.
const OWNER_DOMAIN = 'slotstate.test';
const COME_OWNER = 'come@' + OWNER_DOMAIN;
const TRAVEL_OWNER = 'travel@' + OWNER_DOMAIN;

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function ensureOwner(email) {
    const existing = await findUser(email);
    if (existing) return existing.id;
    const u = await db.auth('POST', '/admin/users', { email, password: 'slotstate-2026', email_confirm: true });
    return u.id;
}

async function clean(me) {
    // Orders first (they FK the providers and the booking), then the rest — the
    // ordering the reset bug taught us. Not swallowed on the provider delete.
    await db.remove('service_orders', '?guest_id=eq.' + me + '&note=like.' + encodeURIComponent(ORDER_TAG + '%')).catch(() => {});
    await db.remove('bookings', '?guest_id=eq.' + me + '&stripe_payment_intent_id=eq.' + BOOKING_PI).catch(() => {});
    // Also sweep any SLOTSTATE provider left under the VIEWER's own account — an
    // earlier version seeded the providers as `me` before the (owner_id, trade)
    // rule forced separate owners, and a partial run could orphan one there.
    for (const name of [COME_NAME, TRAVEL_NAME]) {
        const mineProvs = await db.select('service_providers', '?owner_id=eq.' + me + '&business_name=eq.' + encodeURIComponent(name) + '&select=id').catch(() => []);
        for (const p of mineProvs || []) {
            await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_providers', '?id=eq.' + p.id);
        }
    }
    const page = await db.auth('GET', '/admin/users?per_page=200');
    const owners = ((page && page.users) || []).filter((u) => String(u.email || '').endsWith('@' + OWNER_DOMAIN));
    for (const o of owners) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + o.id + '&select=id').catch(() => []);
        for (const p of provs || []) {
            await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_providers', '?id=eq.' + p.id);
        }
        await db.remove('profiles', '?id=eq.' + o.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + o.id).catch(() => {});
    }
}

async function main() {
    const user = await findUser(ME);
    if (!user) { console.error('No test account for ' + ME + '.'); process.exit(1); }
    const me = user.id;

    await clean(me);
    if (reset) { console.log('Removed the slot-order-state fixtures.'); return; }

    const comeOwner = await ensureOwner(COME_OWNER);
    const travelOwner = await ensureOwner(TRAVEL_OWNER);

    const mine = await db.select('listings', '?host_id=eq.' + me + '&select=id&order=id.asc&limit=1');
    const anyListing = (mine && mine.length) ? mine : await db.select('listings', '?select=id&order=id.asc&limit=1');
    if (!anyListing || !anyListing.length) { console.error('No listing on test to hang a booking on.'); process.exit(1); }
    const listingId = anyListing[0].id;

    const checkIn = dayOffset(40);
    const checkOut = dayOffset(44);
    const now = new Date();
    const nowIso = now.toISOString();
    const [booking] = await db.insert('bookings', {
        listing_id: listingId, guest_id: me, host_id: me, check_in: checkIn, check_out: checkOut,
        guests: 4, adults: 4, children: 0, pets: 0, total_price: 400, status: 'confirmed',
        payment_status: 'paid', amount_paid: 400, confirmed_at: nowIso, paid_at: nowIso,
        stripe_payment_intent_id: BOOKING_PI,
    });

    const baseProvider = (over) => ({
        trade: 'guest', audience: 'guest', kind: 'external', shape: 'slot',
        slot_length_minutes: 60, slot_capacity: 8, slot_min_people: 1,
        stripe_mcc: '7997', provider_name: 'State Fixture', status: 'approved',
        stripe_account_id: 'acct_slotstate', stripe_charges_enabled: true, stripe_payouts_enabled: true,
        stripe_details_submitted: true, plan: 'commission', commission_rate: 0.10, updated_at: nowIso,
        ...over,
    });

    // COME-TO-ME: an address, town public via based_line, street + postcode private.
    const [come] = await db.insert('service_providers', [baseProvider({
        owner_id: comeOwner,
        business_name: COME_NAME, custom_label: 'Food to order',
        description: 'A whisky tasting at the distillery — come to us.',
        fulfilment: 'collection',
        collection_street: 'The Distillery, Bladnoch',
        collection_town: 'Bladnoch',
        collection_postcode: 'DG8 9AB',
        based_line: 'Bladnoch',
    })]);
    await db.insert('service_provider_items', [
        { provider_id: come.id, name: 'Whisky flight', description: 'Five drams', price: 35, unit: 'person', sort_order: 0, active: true },
    ]);

    // TRAVELLING: no address; it happens at the guest's cottage. based_line null.
    const [travel] = await db.insert('service_providers', [baseProvider({
        owner_id: travelOwner,
        business_name: TRAVEL_NAME, custom_label: 'Wellness & activities',
        description: 'A yoga session I bring to your cottage.',
        fulfilment: 'delivery', based_line: null,
    })]);
    await db.insert('service_provider_items', [
        { provider_id: travel.id, name: 'Cottage yoga', description: 'One hour', price: 18, unit: 'person', sort_order: 0, active: true },
    ]);

    const orderRow = (prov, status, over) => ({
        provider_id: prov.id, guest_id: me, listing_id: listingId, booking_id: booking.id,
        trade: 'guest', shape: 'slot', status,
        service_date: dayOffset(41), service_time: '11:00:00',
        price: Number(over.unit_price) * 4, quantity: 4, unit_price: Number(over.unit_price), item_unit: 'person',
        commission_rate: 0.10, item_name: over.item_name, item_description: over.item_description || '',
        provider_business_name: prov.business_name, guest_name: 'Liam', guest_email: ME,
        exclusive_per_date: false, note: ORDER_TAG + ' ' + status,
        ...(status === 'confirmed' ? { confirmed_at: nowIso, stripe_payment_intent_id: 'pi_' + ORDER_TAG.toLowerCase() + '_' + Math.random().toString(36).slice(2, 8) } : {}),
        ...(status === 'holding' ? { expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString() } : {}),
        created_at: nowIso,
    });

    const [comeHolding] = await db.insert('service_orders', [orderRow(come, 'holding', { unit_price: 35, item_name: 'Whisky flight', item_description: 'Five drams' })]);
    const [comeConfirmed] = await db.insert('service_orders', [orderRow(come, 'confirmed', { unit_price: 35, item_name: 'Whisky flight', item_description: 'Five drams' })]);
    const [travelConfirmed] = await db.insert('service_orders', [orderRow(travel, 'confirmed', { unit_price: 18, item_name: 'Cottage yoga', item_description: 'One hour' })]);

    console.log('\n  Seeded slot-order states on ' + TEST_PROJECT_REF + ' (sign in as ' + ME + '):');
    console.log('  1. come-to-me, BEFORE payment (holding) — expect the TOWN, "full address once confirmed":');
    console.log('     /experiences/order/' + comeHolding.id);
    console.log('  2. come-to-me, CONFIRMED — expect the FULL address (The Distillery, Bladnoch, Bladnoch, DG8 9AB):');
    console.log('     /experiences/order/' + comeConfirmed.id);
    console.log('  3. travelling, CONFIRMED — expect "comes to your cottage":');
    console.log('     /experiences/order/' + travelConfirmed.id);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
