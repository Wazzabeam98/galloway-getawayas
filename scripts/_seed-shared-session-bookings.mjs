// A SHARED session with SEVERAL SEPARATE bookings from DIFFERENT people — so the
// provider's reservation panel shows a real guest LIST, not one guest holding N
// places.
//
//   node scripts/_seed-shared-session-bookings.mjs          # add the demo bookings
//   node scripts/_seed-shared-session-bookings.mjs --reset  # remove only what this made
//
// ADDITIVE ON PURPOSE. Unlike seed-marketplace, this does NOT wipe the world: it
// leaves the marketplace (and the sauna) as they are and just adds one shared
// session to the sauna with a handful of distinct-guest bookings, so the data is
// there to walk. It is idempotent — re-running replaces its own session+orders,
// nothing else. TEST PROJECT ONLY (refuses otherwise).
//
// It seeds the ORDER ROWS directly (no Stripe) — what we're exercising is the
// provider calendar's DISPLAY of several bookings on one session, which reads the
// order rows and the slot_sessions row, not the payment path.

import { loadEnv, supabaseClient, TEST_PROJECT_REF, dayOffset } from './seed-lib.mjs';

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')');
    process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set'); process.exit(1); }

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const SAUNA_OWNER = 'sauna@gallowaymarket.test';   // the provider the owner walks as
const DOMAIN = 'gallowaymarket.test';
const PASSWORD = 'market-demo-2026';
const SESSION_TIME = '14:00:00';
const SESSION_DATE = dayOffset(6);                 // a week out, comfortably in the future
const CAPACITY = 6;

// Four real-feeling people, each their own booking on the one shared session.
// A pair (Catriona, 2 seats) and three singles = 5 of 6 seats — a genuine list.
const GUESTS = [
    { key: 'alice',    name: 'Alice Fenwick',   qty: 1, note: '', daysAgo: 9 },
    { key: 'ben',      name: 'Ben Ruthven',     qty: 1, note: 'First time — any tips welcome!', daysAgo: 6 },
    { key: 'catriona', name: 'Catriona Blake',  qty: 2, note: 'Booking for me and my partner.', daysAgo: 4 },
    { key: 'diego',    name: 'Diego Marsh',     qty: 1, note: '', daysAgo: 1 },
];

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function ensureGuest(g) {
    const email = 'guest-' + g.key + '@' + DOMAIN;
    let user = await findUser(email);
    if (!user) {
        user = await db.auth('POST', '/admin/users', {
            email, password: PASSWORD, email_confirm: true, user_metadata: { name: g.name },
        });
    }
    const id = user.id;
    await db.rest('POST', '/profiles', { id, email, full_name: g.name, is_host: false }, 'resolution=merge-duplicates');
    return { id, email };
}

async function providerFromOwner(ownerEmail) {
    const owner = await findUser(ownerEmail);
    if (!owner) return null;
    const rows = await db.select('service_providers', '?owner_id=eq.' + owner.id + '&select=id,trade,business_name,shape');
    return (rows && rows[0]) || null;
}

async function removeSeeded(providerId) {
    // Only the orders and the session at OUR fixed demo date+time — nothing else.
    const q = '?provider_id=eq.' + providerId + '&service_date=eq.' + SESSION_DATE + '&service_time=eq.' + SESSION_TIME;
    await db.remove('service_orders', q).catch(() => {});
    await db.remove('slot_sessions', '?provider_id=eq.' + providerId + '&session_date=eq.' + SESSION_DATE + '&session_time=eq.' + SESSION_TIME).catch(() => {});
}

async function run() {
    const provider = await providerFromOwner(SAUNA_OWNER);
    if (!provider) {
        console.error('The sauna provider was not found. Run `node scripts/seed-marketplace.mjs` first, then this.');
        process.exit(1);
    }

    // Always clear our own prior demo first, so a re-run replaces rather than piles up.
    await removeSeeded(provider.id);

    if (reset) {
        console.log('Removed the shared-session demo bookings from the sauna. Nothing else touched.');
        return;
    }

    const seatsTaken = GUESTS.reduce((n, g) => n + g.qty, 0);

    // The shared session itself: NOT private, real capacity, so the day view and
    // the panel both read it as a group session with several seats.
    const [session] = await db.insert('slot_sessions', [{
        provider_id: provider.id,
        session_date: SESSION_DATE,
        session_time: SESSION_TIME,
        capacity: CAPACITY,
        seats_taken: seatsTaken,
        private: false,
        // A booked session must carry the length it runs (DB constraint
        // slot_sessions_booked_has_duration). The sauna runs 60-minute sessions.
        duration_minutes: 60,
        turnaround_minutes: 0,
    }]);

    // One confirmed order per person — distinct guest_id each, so the panel lists
    // them as separate bookings. Priced per person; a couple takes two seats.
    for (const g of GUESTS) {
        const guest = await ensureGuest(g);
        const createdAt = new Date(Date.now() - g.daysAgo * 86400000).toISOString();
        await db.insert('service_orders', [{
            provider_id: provider.id,
            guest_id: guest.id,
            trade: provider.trade,
            shape: 'slot',
            slot_session_id: session.id,
            service_date: SESSION_DATE,
            service_time: SESSION_TIME,
            item_name: 'Shared sauna session',
            item_unit: 'person',
            unit_price: 15,
            quantity: g.qty,
            price: 15 * g.qty,
            commission_rate: 0.10,
            guests: g.qty,
            status: 'confirmed',
            guest_name: g.name,
            guest_email: guest.email,
            provider_business_name: provider.business_name,
            note: g.note || null,
            confirmed_at: createdAt,
            created_at: createdAt,
        }]);
    }

    console.log('Added a shared sauna session on ' + SESSION_DATE + ' ' + SESSION_TIME.slice(0, 5)
        + ' with ' + GUESTS.length + ' separate bookings (' + seatsTaken + ' of ' + CAPACITY + ' seats).');
    console.log('Walk it as ' + SAUNA_OWNER + ' → /services/dashboard → open ' + SESSION_DATE + '.');
}

run().catch((e) => { console.error(e); process.exit(1); });
