// A marketplace you can browse — eight fake businesses across all three shapes,
// each payouts-ready on test Stripe, with a menu or a schedule, priced in varied
// units, and a gradient image on every item. One guest ("Morag") with one
// cottage booking near Kirkcudbright browses the lot.
//
// TEST ONLY (seed-lib refuses a non-test key). Idempotent: it removes anything
// it made under @gallowaymarket.test first, then rebuilds. Run:
//   node scripts/seed-marketplace.mjs
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { loadEnv, assertTestEnvironment, stripeClient, supabaseClient, sleep } from './seed-lib.mjs';

const env = loadEnv('.env.local');
assertTestEnvironment(env);
const stripe = stripeClient(env);
const db = supabaseClient(env);

const DOMAIN = 'gallowaymarket.test';
const PASSWORD = 'market-demo-2026';
// Kirkcudbright — every provider covers it, the cottage sits in it.
const LAT = 54.8362, LNG = -4.0530;

// --- tiny PNG maker: a vertical two-colour gradient, better than a flat block
function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}
// Node < 20 has no zlib.crc32; a tiny fallback.
function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return ~c >>> 0;
}
function gradientPng(w, h, top, bottom) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        const t = y / (h - 1 || 1);
        const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
        const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
        const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
        const rowStart = y * (w * 3 + 1);
        raw[rowStart] = 0;
        for (let x = 0; x < w; x++) { const o = rowStart + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
async function uploadPng(path, bytes) {
    const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/listings/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'image/png', 'x-upsert': 'true' },
        body: bytes,
    });
    if (!r.ok) throw new Error('upload ' + path + ': ' + (await r.text()).slice(0, 160));
    return path;
}

// dow: 0=Sun..6=Sat
const AV = (days, open, close) => days.map((d) => ({ day_of_week: d, open_time: open, close_time: close }));

const BUSINESSES = [
    {
        slug: 'bakehouse', name: 'Galloway Bakehouse', person: 'Rosa Muir', based: 'Kirkcudbright · baking since 2012',
        shape: 'made_to_order', mcc: '5462', desc: 'Celebration cakes, traybakes and morning buns, made to order and dropped at your cottage. A day or two’s notice for anything with candles on it.',
        cancelHours: 72, leadDays: 2, palette: [[236, 214, 183], [201, 124, 74]],
        items: [
            { name: 'Victoria sponge', desc: 'Jam and cream, serves 8', price: 26, unit: 'flat' },
            { name: 'Chocolate fudge cake', desc: 'Rich and dense, serves 10', price: 34, unit: 'flat' },
            { name: 'Box of 6 morning buns', desc: 'Cinnamon or cardamom', price: 15, unit: 'item' },
            { name: 'Celebration cake', desc: 'Two days’ notice, a message piped on', price: 48, unit: 'flat' },
        ],
    },
    {
        slug: 'hamper', name: 'The Cottage Hamper Co.', person: 'Iain Bell', based: 'Delivered across the Stewartry',
        shape: 'made_to_order', mcc: '5411', desc: 'A fridge filled or a hamper made up before you arrive — local cheese, baking, eggs and the makings of a first breakfast.',
        cancelHours: 48, leadDays: 1, palette: [[222, 226, 198], [122, 141, 92]],
        items: [
            { name: 'Welcome hamper', desc: 'Cheese, oatcakes, chutney, shortbread', price: 42, unit: 'flat' },
            { name: 'Breakfast box', desc: 'Eggs, bacon, bread, preserves', price: 24, unit: 'flat' },
            { name: 'Local cheese board', desc: 'Four Galloway cheeses, serves 4', price: 30, unit: 'flat' },
        ],
    },
    {
        slug: 'chef', name: 'Solway Table', person: 'Cara Nairn', based: 'A private chef across Dumfries & Galloway',
        shape: 'comes_to_you', mcc: '5811', desc: 'Dinner cooked in your cottage kitchen, plated and cleared. Bring the table, I bring the rest.', exclusive: true,
        cancelHours: 168, palette: [[214, 199, 176], [90, 66, 48]],
        items: [
            { name: 'Three-course dinner', desc: 'A set menu, changed weekly', price: 55, unit: 'person' },
            { name: 'Solway seafood feast', desc: 'Langoustine, mussels, hand-dived scallops', price: 72, unit: 'person' },
        ],
    },
    {
        slug: 'lens', name: 'Lens & Light', person: 'Euan Frew', based: 'Beach and cottage shoots, Solway coast',
        shape: 'comes_to_you', mcc: '7333', desc: 'A relaxed photo session on the beach or at your cottage — an hour of it, edited and sent within the week.', exclusive: true,
        cancelHours: 72, palette: [[206, 216, 224], [70, 96, 120]],
        items: [
            { name: 'Family session', desc: 'An hour, 40+ edited photos', price: 150, unit: 'flat' },
            { name: 'Extended session', desc: 'Two hours, two locations', price: 240, unit: 'flat' },
        ],
    },
    {
        slug: 'sauna', name: 'Fintry Wood-Fired Sauna', person: 'Greta Sloan', based: 'Harbourside, Kirkcudbright',
        shape: 'slot', mcc: '7997', desc: 'A wood-fired barrel sauna by the harbour. Book the whole thing for your group — an hour of heat and a cold-water dip if you dare.',
        cancelHours: 24, palette: [[224, 186, 150], [150, 78, 44]],
        slot: { lengthMin: 60, capacity: 1, availability: AV([0, 1, 2, 3, 4, 5, 6], '10:00', '18:00') },
        items: [{ name: 'Private sauna hour', desc: 'The whole barrel, up to six of you', price: 40, unit: 'flat' }],
    },
    {
        slug: 'swim', name: 'Solway Wild Swimming', person: 'Neil Carrick', based: 'Guided swims, Dhoon and Brighouse Bay',
        shape: 'slot', mcc: '7392', desc: 'A guided wild swim with a qualified coach — wetsuits and safety kit provided, all abilities welcome. Ninety minutes in the water and out.',
        cancelHours: 12, palette: [[190, 214, 220], [42, 104, 128]],
        slot: { lengthMin: 90, capacity: 6, availability: AV([2, 4, 6], '09:00', '12:00') },
        items: [{ name: 'Guided swim', desc: 'Wetsuit and safety kit included', price: 25, unit: 'person' }],
    },
    {
        slug: 'whisky', name: 'Galloway Whisky Tastings', person: 'Fergus Dunn', based: 'Evening tastings in Kirkcudbright',
        shape: 'slot', mcc: '7997', desc: 'A guided flight of five Lowland and island drams with a keeper who knows them. Ninety minutes, snacks to soak it up, and somewhere to walk home from.',
        cancelHours: 24, palette: [[230, 206, 160], [154, 96, 34]],
        slot: { lengthMin: 90, capacity: 8, availability: AV([4, 5], '17:00', '20:00') },
        items: [{ name: 'Tasting flight', desc: 'Five drams, guided, with snacks', price: 30, unit: 'person' }],
    },
    {
        slug: 'yoga', name: 'Harbour Yoga', person: 'Mairi Todd', based: 'Morning classes by the water',
        shape: 'slot', mcc: '7911', desc: 'A gentle morning class in a light-filled room over the harbour — mats provided, all levels, coffee after if you linger.',
        cancelHours: 12, palette: [[214, 210, 226], [96, 84, 140]],
        slot: { lengthMin: 60, capacity: 10, availability: AV([1, 2, 3, 4, 5], '08:00', '09:00') },
        items: [{ name: 'Morning class', desc: '60 minutes, mats provided', price: 14, unit: 'person' }],
    },
];

async function findUser(email) {
    // The admin list is paged; find by email.
    for (let page = 1; page <= 10; page++) {
        const r = await db.auth('GET', '/admin/users?page=' + page + '&per_page=200');
        const u = (r.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
        if (u) return u;
        if (!r.users || r.users.length < 200) break;
    }
    return null;
}

async function ensureUser(email, name) {
    const existing = await findUser(email);
    if (existing) return existing;
    const made = await db.auth('POST', '/admin/users', { email, password: PASSWORD, email_confirm: true, user_metadata: { name } });
    return made;
}

async function cleanup() {
    console.log('cleaning previous marketplace seed…');
    for (const b of BUSINESSES) {
        const email = b.slug + '@' + DOMAIN;
        const u = await findUser(email);
        if (!u) continue;
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id,stripe_account_id');
        for (const p of provs || []) {
            await db.remove('slot_availability', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('slot_blocks', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('slot_sessions', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_areas', '?provider_id=eq.' + p.id).catch(() => {});
            if (p.stripe_account_id) await stripe.request('DELETE', '/accounts/' + p.stripe_account_id).catch(() => {});
        }
        await db.remove('service_providers', '?owner_id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
    // The browsing guest + cottage + booking.
    const g = await findUser('morag@' + DOMAIN);
    if (g) {
        const ls = await db.select('listings', '?host_id=eq.' + g.id + '&select=id');
        for (const l of ls || []) { await db.remove('service_orders', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {}); await db.remove('listing_arrival', '?listing_id=eq.' + l.id).catch(() => {}); }
        await db.remove('bookings', '?guest_id=eq.' + g.id).catch(() => {});
        await db.remove('listings', '?host_id=eq.' + g.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + g.id).catch(() => {});
    }
}

async function makeAccount(email, person) {
    const [first, ...rest] = person.split(' ');
    const account = await stripe.request('POST', '/accounts', {
        type: 'custom', country: 'GB', email, business_type: 'individual',
        capabilities: { transfers: { requested: 'true' }, card_payments: { requested: 'true' } },
        business_profile: { mcc: '5734', url: 'https://gallowaygetaways.co.uk', product_description: 'Guest experience' },
        individual: { first_name: first, last_name: rest.join(' ') || 'Provider', email, phone: '+442071234567', id_number: '000000000', dob: { day: 1, month: 1, year: 1901 }, address: { line1: 'address_full_match', city: 'Kirkcudbright', postal_code: 'DG6 4JG', country: 'GB' } },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
        external_account: { object: 'bank_account', country: 'GB', currency: 'gbp', account_number: '00012345', sort_code: '108800' },
    });
    return account.id;
}

async function run() {
    await cleanup();

    // The browsing guest, a cottage, and a week-long booking so slots have days.
    console.log('creating the browsing guest and cottage…');
    const guest = await ensureUser('morag@' + DOMAIN, 'Morag Kerr');
    await db.rest('POST', '/profiles?on_conflict=id', [{ id: guest.id, email: 'morag@' + DOMAIN, full_name: 'Morag Kerr', is_host: false }], 'resolution=merge-duplicates');
    const [tmplL] = await db.select('listings', '?select=*&limit=1');
    const heroCottage = await uploadPng('providers/mkt-cottage.png', gradientPng(64, 40, [206, 216, 224], [70, 96, 120]));
    const [listing] = await db.insert('listings', [{
        ...tmplL, id: undefined, created_at: undefined, updated_at: undefined,
        // Generated columns can't be written — the DB derives them.
        approx_latitude: undefined, approx_longitude: undefined,
        host_id: guest.id, title: 'MARKETPLACE DEMO — Harbour Cottage',
        // A street address + postcode + town (not the whole address stuffed into
        // `location`), so the card reads a real address and, with the pin below,
        // Get directions routes to the door rather than the town centre.
        street_address: 'Castlebank', postcode: 'DG6 4JG', location: 'Kirkcudbright',
        latitude: LAT, longitude: LNG, status: 'published', images: [heroCottage], ical_token: crypto.randomUUID(),
    }]);
    // Arrival essentials for Morag's cottage, so the what3words chip shows on her
    // trips/home card and survives a reset (cleanup clears this row too).
    await db.insert('listing_arrival', [{
        listing_id: listing.id,
        what3words: '///harbour.candle.brave',
        parking_info: 'Two spaces on the cobbles in front of the cottage.',
        arrival_directions: 'Last house on the left before the harbour wall — the blue door.',
    }]);
    const [tmplB] = await db.select('bookings', '?select=*&limit=1');
    const [booking] = await db.insert('bookings', [{
        ...tmplB, id: undefined, created_at: undefined, updated_at: undefined, guest_id: guest.id, host_id: guest.id, listing_id: listing.id,
        check_in: '2026-09-19', check_out: '2026-09-26', guests: 4, adults: 4, children: 0, pets: 0,
        status: 'confirmed', payment_status: 'paid', amount_paid: 0, amount_refunded: 0, stripe_payment_intent_id: null, balance_amount: 0,
    }]);

    // Create every Stripe account first, then poll them together.
    console.log('creating ' + BUSINESSES.length + ' Stripe accounts…');
    const acc = {};
    for (const b of BUSINESSES) acc[b.slug] = await makeAccount(b.slug + '@' + DOMAIN, b.person);
    console.log('waiting for payouts to enable…');
    for (let i = 0; i < 40; i++) {
        const states = await Promise.all(BUSINESSES.map((b) => stripe.request('GET', '/accounts/' + acc[b.slug])));
        const pending = states.filter((s) => !s.payouts_enabled).length;
        if (pending === 0) { console.log('  all payouts enabled after ~' + i * 5 + 's'); break; }
        await sleep(5000);
    }

    for (const b of BUSINESSES) {
        const email = b.slug + '@' + DOMAIN;
        const owner = await ensureUser(email, b.person);
        await db.rest('POST', '/profiles?on_conflict=id', [{ id: owner.id, email, full_name: b.person, is_host: false }], 'resolution=merge-duplicates');

        const headshot = await uploadPng('providers/mkt-' + b.slug + '-face.png', gradientPng(24, 24, b.palette[0], b.palette[1]));
        const now = new Date().toISOString();
        const [prov] = await db.insert('service_providers', [{
            owner_id: owner.id, audience: 'guest', trade: 'guest', status: 'approved',
            business_name: b.name, provider_name: b.person, based_line: b.based, description: b.desc,
            headshot, photos: [],
            shape: b.shape, stripe_mcc: b.mcc, stripe_product_description: (b.name + ' — for holiday guests.'),
            plan: 'commission', commission_rate: 0.10,
            cancellation_window_hours: b.cancelHours, lead_time_days: b.leadDays || 0,
            exclusive_per_date: !!b.exclusive,
            slot_length_minutes: b.slot ? b.slot.lengthMin : null,
            slot_capacity: b.slot ? b.slot.capacity : null,
            stripe_account_id: acc[b.slug], stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true, stripe_updated_at: now,
            category_assigned_at: now,
            submitted_at: now,
        }]);

        await db.insert('service_areas', [{ provider_id: prov.id, label: 'Kirkcudbright and 25 miles', centre_lat: LAT, centre_lng: LNG, radius_miles: 25 }]);

        const items = [];
        for (let i = 0; i < b.items.length; i++) {
            const it = b.items[i];
            const shade = i / Math.max(1, b.items.length - 1);
            const top = b.palette[0].map((c, k) => Math.round(c + (b.palette[1][k] - c) * shade * 0.5));
            const img = await uploadPng('providers/mkt-' + b.slug + '-' + i + '.png', gradientPng(48, 36, top, b.palette[1]));
            items.push({ provider_id: prov.id, name: it.name, description: it.desc, price: it.price, unit: it.unit, image: img, sort_order: i, active: true });
        }
        await db.insert('service_provider_items', items);

        if (b.slot) {
            await db.insert('slot_availability', b.slot.availability.map((a) => ({ provider_id: prov.id, day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })));
        }
        console.log('  ✓ ' + b.name + ' (' + b.shape + ')');
    }

    console.log('\n============================================================');
    console.log('Marketplace seeded. Browse it as Morag on your dev server (port 3000):');
    console.log('  path:  /experiences/' + booking.id);
    console.log('  login: morag@' + DOMAIN + '  /  ' + PASSWORD);
    console.log('  (provider logins: <slug>@' + DOMAIN + ' / ' + PASSWORD + ' — e.g. sauna@' + DOMAIN + ')');
    console.log('  booking ' + booking.id + ' · cottage ' + listing.id);
    console.log('============================================================');
}

run().catch((e) => { console.error(e); process.exit(1); });
