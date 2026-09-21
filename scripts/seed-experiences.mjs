// THE experience seed — the ONE script that builds the demo guest-experience set
// on the TEST database. It first wipes every seeded experience (providers, their
// orders, sessions, availability, items) and then builds a fresh set from the
// CURRENT code: every field the listing editor writes today, so what it creates
// is provably on current code and the editor renders every tool with content.
//
//   node scripts/seed-experiences.mjs
//
// SAFE WIPE ORDER. service_orders.slot_session_id is ON DELETE SET NULL, so a
// session deleted before its orders would orphan a paid row (the bug we chased
// twice). This deletes each order's children and the orders FIRST, then the
// sessions — nothing paid is ever cut loose. Cottage listings, stay bookings,
// their payments/payouts, and the real account (liamworrall18@hotmail.com) are
// left untouched; only audience='guest' providers and their data are wiped.
//
// TEST ONLY. Refuses to run unless the Supabase URL is the test project.
//
// Images come from listings/seed-assets/* (copied there so they survive a wipe
// and never live in the repo). The sauna uses the real sauna photos.

import { loadEnv, assertTestEnvironment, supabaseClient, dayOffset } from './seed-lib.mjs';

const env = loadEnv('.env.local');
assertTestEnvironment(env);
const db = supabaseClient(env);

const SEED_DOMAIN = 'gallowayexp.test';        // reserved TLD → no mail is sent
const PASSWORD = 'experience-seed-2026';
const LIAM_EMAIL = 'liamworrall18@hotmail.com';
const ACCT = 'acct_seed_experiences';           // a stand-in connected account
const IMG = (k) => k;                            // storage keys, resolved by getImageUrl

const time = (h, m = 0) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00';
const uuid = () => crypto.randomUUID();

/* ------------------------------------------------------------------ wipe */
async function wipeExperiences() {
    const providers = await db.select('service_providers', "?select=id,owner_id&audience=eq.guest");
    console.log('  wiping ' + providers.length + ' seeded guest provider(s)…');
    for (const p of providers) {
        // Orders (and their children) BEFORE sessions, so SET NULL never orphans.
        const orders = await db.select('service_orders', '?select=id&provider_id=eq.' + p.id);
        for (const o of orders) {
            await db.remove('booking_guests', '?order_id=eq.' + o.id).catch(() => {});
            await db.remove('messages', '?order_id=eq.' + o.id).catch(() => {});
            await db.remove('reviews', '?order_id=eq.' + o.id).catch(() => {});
        }
        await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
        // Provider children.
        for (const t of ['reviews', 'service_areas', 'provider_ical_feeds', 'service_provider_extras',
            'service_provider_prices', 'service_provider_registrations', 'service_provider_skills',
            'service_applications', 'service_provider_items', 'slot_sessions', 'slot_availability', 'slot_blocks']) {
            await db.remove(t, '?provider_id=eq.' + p.id).catch(() => {});
        }
        await db.remove('service_providers', '?id=eq.' + p.id).catch(() => {});
    }
    // This seed's own owner accounts (so a re-run is clean). Never Liam, never
    // other domains' accounts.
    const users = await db.auth('GET', '/admin/users?per_page=200');
    for (const u of (users.users || [])) {
        if ((u.email || '').endsWith('@' + SEED_DOMAIN)) await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}

/* --------------------------------------------------------------- helpers */
async function ownerFor(key, fullName) {
    const email = 'seed-' + key + '@' + SEED_DOMAIN;
    const made = await db.auth('POST', '/admin/users', {
        email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName },
    });
    const id = made.id || made.user?.id;
    // A trigger creates the profiles row; set the name/email.
    const existing = await db.select('profiles', '?select=id&id=eq.' + id);
    if (existing.length) await db.update('profiles', '?id=eq.' + id, { email, full_name: fullName });
    else await db.insert('profiles', { id, email, full_name: fullName });
    return { id, email };
}

async function makeProvider(spec) {
    const [p] = await db.insert('service_providers', {
        owner_id: spec.owner.id,
        business_name: spec.business_name,
        provider_name: spec.provider_name,
        // Every guest-experience provider is the one trade 'guest'; what they
        // offer is the CATEGORY (guest_details.category), not a trade. A category
        // name here (sauna/chef…) would misroute the /edit fork to the tradesman
        // editor, since audienceForTrade doesn't know it as a guest trade.
        trade: 'guest',
        audience: 'guest',
        status: 'approved',
        plan: 'commission',
        commission_rate: 0.10,
        shape: spec.shape,
        exclusive_per_date: spec.shape === 'comes_to_you',
        slot_length_minutes: spec.slotLength ?? null,
        slot_turnaround_minutes: spec.turnaround ?? 0,
        slot_capacity: spec.slotCapacity ?? null,
        slot_min_people: spec.slotMin ?? 1,
        lead_time_days: spec.leadTimeDays ?? 0,
        cancellation_window_hours: spec.cancelHours ?? 48,
        contact_email: spec.owner.email,
        fulfilment: spec.fulfilment ?? null,
        collection_street: spec.street ?? null,
        collection_town: spec.town ?? null,
        collection_postcode: spec.postcode ?? null,
        stripe_mcc: spec.mcc ?? null,
        headshot: spec.headshot ?? null,
        dietary_note: spec.dietaryNote ?? null,
        stripe_account_id: ACCT,
        stripe_payouts_enabled: true,
        stripe_charges_enabled: true,
        stripe_details_submitted: true,
        photos: spec.photos ?? [],
        guest_details: {
            category: spec.category,
            professional_title: spec.professional_title,
            years_experience: String(spec.years),
            qualifications: spec.qualifications,
            recognition: spec.recognition ?? null,
            what_to_expect: spec.what_to_expect,
            itinerary: spec.itinerary,
            min_age: spec.minAge ?? null,
            activity_level: spec.activityLevel ?? null,
            what_to_bring: spec.whatToBring ?? null,
            amenities: spec.amenities ?? [],
            accessibility: spec.accessibility ?? null,
            parking: spec.parking ?? null,
            no_refund: spec.noRefund ?? null,
            booking_horizon_days: spec.horizonDays ?? 90,
            max_guests: spec.shape === 'slot' ? undefined : (spec.maxGuests ?? null),
            dietary_options: spec.dietaryOptions ?? [],
        },
    });
    for (const it of spec.items) {
        await db.insert('service_provider_items', {
            provider_id: p.id, name: it.name, description: it.description, price: it.price,
            unit: it.unit, active: true, sort_order: it.sort ?? 0,
            capacity: it.capacity ?? null, min_people: it.min ?? null, image: it.image ?? null,
        });
    }
    if (spec.availability) {
        for (const d of spec.availability.days) {
            await db.insert('slot_availability', {
                provider_id: p.id, day_of_week: d, open_time: spec.availability.open, close_time: spec.availability.close,
            });
        }
    }
    return p;
}

async function makeSession(providerId, date, t, { seats, capacity, priv = false, declared = false, title = null }) {
    const [s] = await db.insert('slot_sessions', {
        provider_id: providerId, session_date: date, session_time: t,
        capacity, seats_taken: seats, private: priv, declared, title,
        duration_minutes: 60, turnaround_minutes: 30,
    });
    return s;
}

async function makeOrder(o) {
    const [row] = await db.insert('service_orders', {
        provider_id: o.provider.id, guest_id: o.guestId,
        listing_id: null, booking_id: null,
        guest_name: o.guestName, guest_email: o.guestEmail, guest_phone: null,
        trade: o.provider.trade, shape: o.provider.shape,
        slot_session_id: o.sessionId ?? null,
        service_date: o.date, service_time: o.time ?? null,
        duration_minutes: o.provider.shape === 'slot' ? 60 : null,
        fulfilment: o.fulfilment ?? null, service_address: null,
        guests: o.attendees ?? null, attendees: o.attendees ?? null,
        quantity: o.quantity ?? 1, adults: o.adults ?? null, children: o.children ?? null,
        unit_price: o.unitPrice, item_unit: o.unit, price: o.price, commission_rate: 0.10,
        status: o.status,
        item_id: o.itemId ?? null, item_name: o.itemName, item_description: o.itemDesc ?? '',
        provider_business_name: o.provider.business_name,
        note: null, allergy: null,
        expires_at: o.status === 'holding' ? new Date(Date.now() + 25 * 60 * 1000).toISOString() : null,
        stripe_payment_intent_id: o.status === 'holding' ? null : 'pi_seed_' + Math.random().toString(16).slice(2, 12),
        amount_refunded: o.status === 'refunded' ? o.price : 0,
        created_at: new Date().toISOString(),
    });
    return row;
}

/* ------------------------------------------------------------------ main */
async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('\nwiping seeded experiences…');
    await wipeExperiences();

    const [liam] = await db.select('profiles', '?select=id,email,full_name&email=eq.' + encodeURIComponent(LIAM_EMAIL));
    if (!liam) { console.error('No profile for ' + LIAM_EMAIL + ' — cannot place orders on the real account.'); process.exit(1); }
    const guestName = liam.full_name || 'Liam Worrall';

    console.log('\nbuilding fresh set…');
    const created = [];

    /* 1. SAUNA (slot) — a shared per-person table AND a private hire. */
    const saunaOwner = await ownerFor('sauna', 'Isla (Loch Sauna)');
    const saunaItems = [
        { name: 'Shared sauna round', description: 'A seat at the wood-fired barrel — up to 6 share the heat, cold-water dips between rounds.', price: 18, unit: 'person', capacity: 6, min: 1, sort: 0, image: IMG('seed-assets/sauna-2.jpg') },
        { name: 'Private hire (whole barrel)', description: 'The whole sauna for your group for the hour — nobody else joins.', price: 90, unit: 'flat', sort: 1, image: IMG('seed-assets/sauna-3.jpg') },
    ];
    const sauna = await makeProvider({
        owner: saunaOwner, business_name: 'Loch Sauna', provider_name: 'Isla', trade: 'sauna', category: 'sauna', mcc: '7299', shape: 'slot',
        slotLength: 60, turnaround: 30, slotCapacity: 6, slotMin: 1, cancelHours: 24, horizonDays: 90,
        fulfilment: 'collection', street: '2 Shore Road', town: 'Kirkcudbright', postcode: 'DG6 4JZ',
        headshot: IMG('seed-assets/sauna-face.jpg'), photos: [1,2,3,4,5,6].map(n => IMG('seed-assets/sauna-' + n + '.jpg')),
        professional_title: 'Wood-fired sauna by the harbour', years: 4,
        qualifications: 'Trained sauna host; outdoor first aid.', recognition: 'Featured in the Galloway food & folk trail.',
        what_to_expect: 'Three rounds of heat with cold-water dips between, ninety minutes by the water.',
        itinerary: [
            { title: 'Arrival', detail: 'Meet at the harbour wall; the barrel is warm and ready.' },
            { title: 'During', detail: 'Three rounds of heat, cold-water dips between if you dare.' },
            { title: 'Finish', detail: 'Wind down with a hot tea on the deck.' },
        ],
        minAge: 16, activityLevel: 'moderate', whatToBring: 'Swimwear, a towel, and a warm layer for after.',
        amenities: ['changing_area', 'towels', 'parking', 'toilets'], accessibility: 'step_free', parking: 'onsite',
        availability: { days: [3,4,5,6,0], open: '15:00', close: '21:00' },
        items: saunaItems,
    });
    const saunaItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + sauna.id + '&order=sort_order');
    created.push({ label: 'Loch Sauna (sauna · slot, shared + private)', ...saunaOwner, providerId: sauna.id });

    /* 2. PER-PERSON CLASS (slot) — a declared yoga class. */
    const yogaOwner = await ownerFor('class', 'Mara (Harbour Yoga)');
    const yoga = await makeProvider({
        owner: yogaOwner, business_name: 'Harbour Yoga', provider_name: 'Mara', trade: 'yoga', category: 'yoga', mcc: '7911', shape: 'slot',
        slotLength: 60, turnaround: 15, slotCapacity: 10, slotMin: 1, cancelHours: 12, horizonDays: 60,
        fulfilment: 'collection', street: 'The Old Sail Loft', town: 'Kirkcudbright', postcode: 'DG6 4JA',
        headshot: IMG('seed-assets/class-face.png'), photos: [IMG('seed-assets/class-1.jpg'), IMG('seed-assets/class-2.jpg')],
        professional_title: 'Sunrise yoga above the harbour', years: 7,
        qualifications: '500-hour registered yoga teacher (Yoga Alliance).', recognition: null,
        what_to_expect: 'A gentle hour of movement and breath as the light comes up over the water.',
        itinerary: [
            { title: 'Settle', detail: 'Mats and blankets provided; find your spot by the window.' },
            { title: 'Flow', detail: 'A slow, all-levels flow — breath first, no experience needed.' },
            { title: 'Rest', detail: 'Close with a long stillness and a cup of tea.' },
        ],
        minAge: 12, activityLevel: 'gentle', whatToBring: 'Comfortable layers; everything else is here.',
        amenities: ['mats_provided', 'toilets', 'step_free'], accessibility: 'step_free', parking: 'street',
        availability: { days: [1,2,3,4,5,6,0], open: '07:00', close: '11:00' },
        items: [{ name: 'Sunrise yoga class', description: 'Per person, all levels, up to 10.', price: 14, unit: 'person', capacity: 10, min: 1, sort: 0, image: IMG('seed-assets/class-1.jpg') }],
    });
    const yogaItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + yoga.id);
    created.push({ label: 'Harbour Yoga (yoga · slot, per-person class)', ...yogaOwner, providerId: yoga.id });

    /* 3. CHEF (comes_to_you). */
    const chefOwner = await ownerFor('chef', 'Rory (Solway Table)');
    const chef = await makeProvider({
        owner: chefOwner, business_name: 'Solway Table', provider_name: 'Rory', trade: 'chef', category: 'chef', mcc: '5811', shape: 'comes_to_you',
        leadTimeDays: 3, cancelHours: 72, horizonDays: 120, maxGuests: 10,
        headshot: IMG('seed-assets/chef-face.png'), photos: [IMG('seed-assets/chef-1.jpg')],
        professional_title: 'Private chef, cooked in your cottage', years: 12,
        qualifications: 'Professional Cookery SVQ; 15 years in Scottish kitchens.', recognition: 'Ex-head chef, a Galloway harbour restaurant.',
        what_to_expect: 'A relaxed dinner cooked in your cottage kitchen, built around what has landed and grown that week.',
        itinerary: [
            { title: 'Before', detail: 'We agree a menu and any dietary needs a few days ahead.' },
            { title: 'On the night', detail: 'I arrive, cook, serve and clear — you just sit down.' },
            { title: 'After', detail: 'Kitchen left as I found it.' },
        ],
        minAge: null, activityLevel: 'gentle', whatToBring: 'Just an appetite — everything else is provided.',
        amenities: [], accessibility: null, parking: null,
        dietaryNote: 'Vegetarian and gluten-free by arrangement; not a nut-free kitchen.', dietaryOptions: ['vegetarian', 'gluten_free'],
        items: [
            { name: 'Three-course Galloway dinner', description: 'A seasonal three courses, cooked in your cottage.', price: 55, unit: 'person', sort: 0, image: IMG('seed-assets/chef-1.jpg') },
            { name: 'Whole private dinner (up to 8)', description: 'The evening booked outright for your group.', price: 380, unit: 'flat', sort: 1 },
        ],
    });
    const chefItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + chef.id + '&order=sort_order');
    created.push({ label: 'Solway Table (chef · comes to you)', ...chefOwner, providerId: chef.id });

    /* 4. BAKER (made_to_order). */
    const bakerOwner = await ownerFor('baker', 'Nora (Galloway Bakehouse)');
    const baker = await makeProvider({
        owner: bakerOwner, business_name: 'Galloway Bakehouse', provider_name: 'Nora', trade: 'baker', category: 'food_order', mcc: '5462', shape: 'made_to_order',
        leadTimeDays: 2, cancelHours: 48, horizonDays: 120, maxGuests: 1,
        fulfilment: 'delivery', town: 'Castle Douglas',
        headshot: IMG('seed-assets/baker-face.png'), photos: [IMG('seed-assets/baker-1.jpg')],
        professional_title: 'Cakes & bakes to order', years: 6,
        qualifications: 'Level 3 Patisserie; registered home bakery.', recognition: null,
        what_to_expect: 'A cake or a box of bakes made to order and dropped to your cottage.',
        itinerary: [
            { title: 'Order', detail: 'Tell me what you would like and when, at least two days ahead.' },
            { title: 'Bake', detail: 'Made fresh the day before or the morning of.' },
            { title: 'Delivery', detail: 'Dropped to your cottage in the window we agree.' },
        ],
        minAge: null, activityLevel: 'gentle', whatToBring: 'Nothing — I bring it to your door.',
        amenities: [], accessibility: null, parking: null,
        dietaryNote: 'Gluten-free and vegan on request; made in a kitchen that handles nuts.', dietaryOptions: ['vegan', 'gluten_free'],
        items: [
            { name: 'Celebration cake (8–10)', description: 'A two-layer cake, your flavour and message.', price: 42, unit: 'flat', sort: 0, image: IMG('seed-assets/baker-1.jpg') },
            { name: 'Box of Galloway bakes', description: 'A dozen assorted traybakes and scones.', price: 24, unit: 'flat', sort: 1 },
        ],
    });
    const bakerItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + baker.id + '&order=sort_order');
    created.push({ label: 'Galloway Bakehouse (baker · made to order)', ...bakerOwner, providerId: baker.id });

    /* --------------------------------------------- orders on Liam, each state */
    const gEmail = liam.email;
    const orderBase = { guestId: liam.id, guestName, guestEmail: gEmail };

    // SAUNA: confirmed-upcoming (shared, per-person), confirmed-past (private), holding (shared).
    const sauShared = saunaItemRows.find(i => i.unit === 'person');
    const sauPrivate = saunaItemRows.find(i => i.unit === 'flat');
    const sUp = await makeSession(sauna.id, dayOffset(6), time(16), { seats: 2, capacity: 6 });
    await makeOrder({ ...orderBase, provider: sauna, sessionId: sUp.id, date: dayOffset(6), time: time(16), quantity: 2, adults: 2, children: 0, unit: 'person', unitPrice: 18, price: 36, itemId: sauShared.id, itemName: sauShared.name, status: 'confirmed', fulfilment: 'collection' });
    const sPast = await makeSession(sauna.id, dayOffset(-9), time(17), { seats: 4, capacity: 6, priv: true });
    await makeOrder({ ...orderBase, provider: sauna, sessionId: sPast.id, date: dayOffset(-9), time: time(17), quantity: 1, attendees: 4, unit: 'flat', unitPrice: 90, price: 90, itemId: sauPrivate.id, itemName: sauPrivate.name, status: 'confirmed', fulfilment: 'collection' });
    const sHold = await makeSession(sauna.id, dayOffset(9), time(18), { seats: 1, capacity: 6 });
    await makeOrder({ ...orderBase, provider: sauna, sessionId: sHold.id, date: dayOffset(9), time: time(18), quantity: 1, adults: 1, children: 0, unit: 'person', unitPrice: 18, price: 18, itemId: sauShared.id, itemName: sauShared.name, status: 'holding', fulfilment: 'collection' });

    // CLASS: a DECLARED class session with a confirmed booking on it.
    const yItem = yogaItemRows[0];
    const yClass = await makeSession(yoga.id, dayOffset(4), time(7, 30), { seats: 3, capacity: 10, declared: true, title: 'Sunrise class' });
    await makeOrder({ ...orderBase, provider: yoga, sessionId: yClass.id, date: dayOffset(4), time: time(7, 30), quantity: 3, adults: 3, children: 0, unit: 'person', unitPrice: 14, price: 42, itemId: yItem.id, itemName: yItem.name, status: 'confirmed', fulfilment: 'collection' });

    // CHEF: authorised (awaiting the chef), and a confirmed upcoming.
    const cItem = chefItemRows.find(i => i.unit === 'person');
    await makeOrder({ ...orderBase, provider: chef, date: dayOffset(12), quantity: 4, attendees: 4, unit: 'person', unitPrice: 55, price: 220, itemId: cItem.id, itemName: cItem.name, status: 'authorised', fulfilment: 'delivery' });
    await makeOrder({ ...orderBase, provider: chef, date: dayOffset(20), quantity: 2, attendees: 2, unit: 'person', unitPrice: 55, price: 110, itemId: cItem.id, itemName: cItem.name, status: 'confirmed', fulfilment: 'delivery' });

    // BAKER: a confirmed order and a refunded one.
    const bItem = bakerItemRows[0];
    await makeOrder({ ...orderBase, provider: baker, date: dayOffset(5), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'confirmed', fulfilment: 'delivery' });
    await makeOrder({ ...orderBase, provider: baker, date: dayOffset(-3), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'refunded', fulfilment: 'delivery' });

    /* ----------------------------------------------------------------- report */
    console.log('\n' + '='.repeat(72));
    console.log('  SEEDED ' + created.length + ' experience providers (password for every owner: ' + PASSWORD + ')');
    console.log('='.repeat(72));
    for (const c of created) {
        console.log('  · ' + c.label);
        console.log('      owner login: ' + c.email + '   /   ' + PASSWORD);
        console.log('      listing editor: /services/dashboard/listing   (provider ' + c.providerId + ')');
    }
    console.log('\n  Orders placed on ' + LIAM_EMAIL + ':');
    console.log('    sauna — confirmed (upcoming, shared), confirmed (past, private hire), holding (unpaid)');
    console.log('    yoga  — confirmed on a DECLARED class session');
    console.log('    chef  — authorised (awaiting the chef), confirmed (upcoming)');
    console.log('    baker — confirmed, refunded');
    console.log('\n  done.');
    process.exit(0);
}

main().catch((err) => { console.error('\nseed failed:', err && (err.stack || err.message)); process.exit(1); });
