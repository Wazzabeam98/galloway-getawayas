// A live baker on TEST, so the guest-trade dashboard can be seen as a real
// person — approved, payouts-enabled, with a real photo gallery and a guest
// order already accepted, so "Coming up" has something in it.
//
//   node scripts/seed-baker-demo.mjs           # seed
//   node scripts/seed-baker-demo.mjs --reset   # remove it
//
// It reuses the onboarded-account trick from seed-payments (a custom account
// with Stripe's magic test values that verifies instantly), the baker's own
// MCC (5462, bakeries), and generates a few solid-colour PNGs for the gallery
// so it is not empty.

import zlib from 'node:zlib';
import { loadEnv, assertTestEnvironment, stripeClient, supabaseClient, sleep, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const stripe = stripeClient(env);
const db = supabaseClient(env);

const BAKER_EMAIL = 'effie@gallowaybaker.test';
const GUEST_EMAIL = 'gwen@gallowaybaker.test';
const HOST_EMAIL = 'hamish@gallowaybaker.test';
const PASSWORD = 'baker-demo-2026';
const DOMAIN = 'gallowaybaker.test';
const TITLE = 'BAKER DEMO — Harbour Cottage';
const BUCKET = 'listings';
const reset = process.argv.includes('--reset');

/* --- a valid solid-colour PNG, so the gallery has real images ------------ */
function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return (~c) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
}
function makePng(w, h, [r, g, b]) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    const rowLen = w * 3 + 1; const raw = Buffer.alloc(rowLen * h);
    for (let y = 0; y < h; y++) { raw[y * rowLen] = 0; for (let x = 0; x < w; x++) { const o = y * rowLen + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
async function uploadPng(path, bytes) {
    const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'image/png', 'x-upsert': 'true' },
        body: bytes,
    });
    if (!r.ok) throw new Error('upload ' + path + ': ' + (await r.text()).slice(0, 160));
    return path;
}

async function usersByDomain() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    return (users || []).filter((u) => String(u.email || '').endsWith('@' + DOMAIN));
}
async function clear() {
    const users = await usersByDomain();
    for (const u of users) {
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id,stripe_account_id');
        for (const p of provs) {
            await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_areas', '?provider_id=eq.' + p.id).catch(() => {});
            if (p.stripe_account_id) await stripe.request('DELETE', '/accounts/' + p.stripe_account_id).catch(() => {});
        }
        const ls = await db.select('listings', '?host_id=eq.' + u.id + '&select=id');
        for (const l of ls) { await db.remove('service_orders', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {}); }
        await db.remove('service_orders', '?guest_id=eq.' + u.id).catch(() => {});
        await db.remove('bookings', '?guest_id=eq.' + u.id).catch(() => {});
        await db.remove('service_providers', '?owner_id=eq.' + u.id).catch(() => {});
        await db.remove('listings', '?host_id=eq.' + u.id).catch(() => {});
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id);
    }
    console.log('  removed ' + users.length + ' @' + DOMAIN + ' user(s)');
}

async function makeUser(email, isHost) {
    const u = await db.auth('POST', '/admin/users', { email, password: PASSWORD, email_confirm: true });
    await db.rest('POST', '/profiles?on_conflict=id',
        [{ id: u.id, email, full_name: email === BAKER_EMAIL ? 'Effie Sinclair' : email === GUEST_EMAIL ? 'Gwen Guest' : 'Hamish Host', is_host: !!isHost }],
        'return=minimal,resolution=merge-duplicates').catch(() => {});
    return u.id;
}

async function onboardedAccount() {
    const account = await stripe.request('POST', '/accounts', {
        type: 'custom', country: 'GB', email: BAKER_EMAIL, business_type: 'individual',
        capabilities: { transfers: { requested: 'true' }, card_payments: { requested: 'true' } },
        business_profile: { mcc: '5462', url: 'https://gallowaygetaways.co.uk', product_description: 'Cakes and baking for holiday guests.' },
        individual: { first_name: 'Effie', last_name: 'Sinclair', email: BAKER_EMAIL, phone: '+442071234567', id_number: '000000000', dob: { day: 1, month: 1, year: 1901 }, address: { line1: 'address_full_match', city: 'Kirkcudbright', postal_code: 'DG6 4JG', country: 'GB' } },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
        external_account: { object: 'bank_account', country: 'GB', currency: 'gbp', account_number: '00012345', routing_number: '108800' },
        metadata: { gg_baker_demo: 'effie' },
    });
    console.log('  created ' + account.id + ' (MCC 5462), waiting for payouts…');
    for (let i = 0; i < 40; i++) { const f = await stripe.request('GET', '/accounts/' + account.id); if (f.payouts_enabled) { console.log('  payouts enabled after ~' + i * 5 + 's'); return f; } await sleep(5000); }
    throw new Error('account never became payouts_enabled');
}

async function seed() {
    const now = new Date();
    const baker = await makeUser(BAKER_EMAIL, false);
    const guest = await makeUser(GUEST_EMAIL, false);
    const host = await makeUser(HOST_EMAIL, true);

    const account = await onboardedAccount();

    // Gallery + headshot — real PNGs so the listing is not empty.
    const photos = [];
    photos.push(await uploadPng('providers/' + baker + '-cake1.png', makePng(48, 36, [232, 195, 158])));  // sponge
    photos.push(await uploadPng('providers/' + baker + '-cake2.png', makePng(48, 36, [91, 58, 41])));      // chocolate
    photos.push(await uploadPng('providers/' + baker + '-cake3.png', makePng(48, 36, [160, 44, 77])));     // berry
    const headshot = await uploadPng('providers/headshot-' + baker + '.png', makePng(40, 40, [201, 138, 90]));

    const [prov] = await db.insert('service_providers', [{
        owner_id: baker,
        business_name: 'Effie’s Bakes',
        trade: 'cake',
        audience: 'guest',
        kind: 'external',
        description:
            'Celebration cakes and traybakes made to order and dropped at your cottage. '
            + 'Victoria sponges, chocolate fudge, lemon drizzle; birthday cakes with a day or two’s notice.',
        provider_name: 'Effie Sinclair',
        based_line: 'Kirkcudbright · baking since 2015',
        photos,
        headshot,
        contact_email: BAKER_EMAIL,
        contact_phone: '01557 555 0188',
        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'commission',
        commission_rate: 0.10,
        stripe_account_id: account.id,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
        stripe_updated_at: now.toISOString(),
        updated_at: now.toISOString(),
    }]);

    await db.insert('service_areas', [{ provider_id: prov.id, label: 'Kirkcudbright and 20 miles', centre_lat: 54.8362, centre_lng: -4.0530, radius_miles: 20 }]);

    // A menu — the whole point of the demo. Eight items, so the card has to
    // read as "Effie Sinclair, cakes from £18" rather than a wall of prices.
    const menu = [
        { name: 'Cupcakes, box of 6', description: 'Vanilla or chocolate, buttercream tops', price: 18 },
        { name: 'Lemon drizzle traybake', description: 'Serves 12, cut into squares', price: 22 },
        { name: 'Victoria sponge', description: 'Jam and cream, serves 8', price: 28 },
        { name: 'Chocolate fudge cake', description: 'Serves 10, rich and dense', price: 35 },
        { name: 'Celebration cake', description: 'Serves 8, choice of sponge, a message piped on', price: 45 },
        { name: 'Two-tier birthday cake', description: 'Serves 20, two days’ notice', price: 75 },
        { name: 'Cheese "cake" (savoury)', description: 'A tower of wheels for a party', price: 60 },
        { name: 'Gluten-free sponge', description: 'Serves 8, made in a clean kitchen', price: 30 },
    ];
    const [items] = [await db.insert('service_provider_items',
        menu.map((m, i) => ({ provider_id: prov.id, name: m.name, description: m.description, price: m.price, sort_order: i, active: true })))];
    const chocolate = items.find((it) => it.name.includes('Chocolate'));

    // A cottage the baker covers, and a future booking for the guest.
    const [tmplL] = await db.select('listings', '?select=*&limit=1');
    delete tmplL.id; delete tmplL.created_at; delete tmplL.approx_latitude; delete tmplL.approx_longitude;
    const [listing] = await db.insert('listings', [{ ...tmplL, host_id: host, title: TITLE, location: 'Harbour Cottage, Kirkcudbright', latitude: 54.8362, longitude: -4.0530, status: 'published', images: [], ical_token: crypto.randomUUID() }]);

    const [tmplB] = await db.select('bookings', '?select=*&limit=1');
    delete tmplB.id; delete tmplB.created_at;
    const [booking] = await db.insert('bookings', [{ ...tmplB, guest_id: guest, host_id: host, listing_id: listing.id, check_in: '2026-09-20', check_out: '2026-09-24', guests: 2, adults: 2, children: 0, pets: 0, status: 'confirmed', payment_status: 'paid', amount_paid: 0, amount_refunded: 0, stripe_payment_intent_id: null, balance_amount: 0 }]);

    // An ACCEPTED order (captured), so "Coming up" has a booking in it.
    const pi = await stripe.request('POST', '/payment_intents', { amount: 3500, currency: 'gbp', capture_method: 'manual', confirm: 'true', payment_method: 'pm_card_visa', payment_method_types: ['card'], on_behalf_of: account.id, application_fee_amount: 350, transfer_data: { destination: account.id } });
    await stripe.request('POST', '/payment_intents/' + pi.id + '/capture');
    await db.insert('service_orders', [{
        provider_id: prov.id, guest_id: guest, listing_id: listing.id, booking_id: booking.id,
        trade: 'cake', service_date: '2026-09-21', guests: 2, price: 35, commission_rate: 0.10, status: 'confirmed',
        item_id: chocolate ? chocolate.id : null, item_name: 'Chocolate fudge cake', item_description: 'Serves 10, rich and dense',
        guest_name: 'Gwen', guest_phone: '07700 900321', guest_email: GUEST_EMAIL,
        note: '"Happy Birthday Mum" piped on top, for the Sunday.',
        provider_business_name: 'Effie’s Bakes', stripe_payment_intent_id: pi.id, confirmed_at: now.toISOString(),
    }]);

    console.log('');
    console.log('  BAKER  ' + BAKER_EMAIL + ' / ' + PASSWORD);
    console.log('         → /services/dashboard  (payouts live, one order in "Coming up")');
    console.log('         → "Edit your listing"  → profile, price, and the photo gallery');
    console.log('  GUEST  ' + GUEST_EMAIL + ' / ' + PASSWORD);
    console.log('         → /trips  (needs GUEST_EXPERIENCES_OPEN on to see the card + gallery)');
    console.log('  one accepted order: chocolate cake, £45, 21 Sep');
}

console.log(reset ? 'clearing baker demo…' : 'seeding a live baker on ' + TEST_PROJECT_REF + '…');
await clear();
if (!reset) await seed();
console.log('done.');
