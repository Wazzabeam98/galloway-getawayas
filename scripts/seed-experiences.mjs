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
const ISLA_STAY_PI = 'pi_seed_isla_stay';       // marks seed-sauna's upcoming holiday-let stay, so a re-run clears it
const ISLA_PAST_STAY_PI = 'pi_seed_isla_past';  // marks seed-sauna's PAST stay (own PI — bookings.stripe_payment_intent_id is unique)
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
    // seed-sauna's holiday-let stay (its experience orders were removed with
    // their providers above; the booking itself is tagged and cleared here so a
    // re-run leaves no orphaned stay behind).
    await db.remove('bookings', '?stripe_payment_intent_id=eq.' + ISLA_STAY_PI).catch(() => {});
    await db.remove('bookings', '?stripe_payment_intent_id=eq.' + ISLA_PAST_STAY_PI).catch(() => {});
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
            // The times a request-shape provider offers (comes_to_you / made_to_order),
            // the guest picks one at booking. Slots have their own session times.
            offered_times: spec.offeredTimes ?? undefined,
        },
    });
    for (const it of spec.items) {
        await db.insert('service_provider_items', {
            provider_id: p.id, name: it.name, description: it.description, price: it.price,
            unit: it.unit, active: true, sort_order: it.sort ?? 0,
            capacity: it.capacity ?? null, min_people: it.min ?? null, image: it.image ?? null,
            included_guests: it.includedGuests ?? null, extra_adult_fee: it.extraAdultFee ?? null,
            extra_child_fee: it.extraChildFee ?? null, max_party: it.maxParty ?? null,
            is_custom: it.isCustom ?? false,
            ingredients: it.ingredients ?? null, allergens: it.allergens ?? null,
        });
    }
    if (spec.availability) {
        for (const d of spec.availability.days) {
            await db.insert('slot_availability', {
                provider_id: p.id, day_of_week: d, open_time: spec.availability.open, close_time: spec.availability.close,
            });
        }
    }
    // A FIXED-VENUE provider carries a real coordinate (its postcode's point), so
    // the listing and order maps render the actual place — not a town centre. It
    // rides on a service_areas row, which is where both maps read the point from.
    // A come-to-you provider gets none: its experience happens at the guest's
    // cottage, mapped on the order from the stay's own coordinate.
    if (spec.mapLat != null && spec.mapLng != null) {
        await db.insert('service_areas', {
            provider_id: p.id, label: spec.town || 'Dumfries & Galloway',
            centre_lat: spec.mapLat, centre_lng: spec.mapLng,
        });
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
        listing_id: o.listingId ?? null, booking_id: o.bookingId ?? null,
        guest_name: o.guestName, guest_email: o.guestEmail, guest_phone: null,
        trade: o.provider.trade, shape: o.provider.shape,
        slot_session_id: o.sessionId ?? null,
        service_date: o.date, service_time: o.time ?? null,
        duration_minutes: o.provider.shape === 'slot' ? 60 : null,
        fulfilment: o.fulfilment ?? null, service_address: o.serviceAddress ?? null,
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
        fulfilment: 'collection', street: '2 Shore Road', town: 'Kirkcudbright', postcode: 'DG6 4JZ', mapLat: 54.8402, mapLng: -4.0466,
        headshot: IMG('seed-assets/sauna-face.jpg'), photos: [1,2,3,4,5,6].map(n => IMG('seed-assets/sauna-' + n + '.jpg')),
        professional_title: 'Wood-fired sauna by the harbour', years: 4,
        // Sauna skips the expertise screen (guestAsksExpertise('sauna') === false)
        // and qualifications are never prompted for it, so leave them unset — the
        // seed should look like a real sauna owner's, which carries neither.
        qualifications: null, recognition: null,
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
        fulfilment: 'collection', street: 'The Old Sail Loft', town: 'Kirkcudbright', postcode: 'DG6 4JA', mapLat: 54.8358, mapLng: -4.0512,
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
        // Booking times come from the weekly OPENING HOURS now (the one place a
        // provider sets the hours they work), not a separate offered-times list —
        // dinner sittings Wed–Sun, 5pm to 9pm.
        availability: { days: [3, 4, 5, 6, 0], open: '17:00', close: '21:00' },
        headshot: IMG('seed-assets/chef-face.png'), photos: [IMG('seed-assets/chef-hero.jpg')],
        professional_title: 'Private chef, cooked in your cottage', years: 12,
        qualifications: 'Professional Cookery SVQ; 15 years in Scottish kitchens.', recognition: 'Ex-head chef, a Galloway harbour restaurant.',
        what_to_expect: 'A relaxed dinner cooked in your cottage kitchen, built around what has landed and grown that week.',
        itinerary: [
            { title: 'Before', detail: 'We agree a menu and any dietary needs a few days ahead.' },
            { title: 'On the night', detail: 'I arrive, cook, serve and clear — you just sit down.' },
            { title: 'After', detail: 'Kitchen left as I found it.' },
        ],
        // A chef dinner has no "activity level" and nothing for the guest to bring,
        // so both are left unset — the listing then shows no "Things to know".
        minAge: null, activityLevel: null, whatToBring: null,
        amenities: [], accessibility: null, parking: null,
        dietaryNote: 'Vegetarian and gluten-free by arrangement; not a nut-free kitchen.', dietaryOptions: ['vegetarian', 'gluten_free'],
        // A proper menu, several options to walk — a mix of per-guest dinners and
        // one whole-evening group price, the way the bakery has a menu.
        items: [
            { name: 'Three-course Galloway dinner', description: 'A seasonal three courses, cooked in your cottage.', price: 55, unit: 'person', sort: 0, image: IMG('seed-assets/chef-hero.jpg'), min: 2 },
            { name: 'Seafood tasting menu', description: 'Five small courses built around the day’s landings.', price: 75, unit: 'person', sort: 1, image: IMG('seed-assets/chef-2.jpg'), min: 2 },
            { name: 'Sunday roast, cooked in', description: 'A proper roast with all the trimmings, carved at your table.', price: 40, unit: 'person', sort: 2, image: IMG('seed-assets/chef-3.jpg'), min: 2 },
            { name: 'Grazing table & canapés', description: 'A spread of Galloway cheeses, charcuterie and warm canapés.', price: 35, unit: 'person', sort: 3, image: IMG('seed-assets/chef-4.jpg'), min: 4 },
            // A flat group price with extra-guests pricing: £220 for up to 4, then
            // +£40 per extra adult and +£15 per extra child, up to a party of 8.
            { name: 'Whole private dinner', description: 'The evening booked outright for your group.', price: 220, unit: 'flat', sort: 4, image: IMG('seed-assets/chef-5.jpg'),
                includedGuests: 4, extraAdultFee: 40, extraChildFee: 15, maxParty: 8 },
        ],
    });
    const chefItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + chef.id + '&order=sort_order');
    created.push({ label: 'Solway Table (chef · comes to you)', ...chefOwner, providerId: chef.id });

    /* 4. BAKER (made_to_order). */
    const bakerOwner = await ownerFor('baker', 'Nora (Galloway Bakehouse)');
    const baker = await makeProvider({
        owner: bakerOwner, business_name: 'Galloway Bakehouse', provider_name: 'Nora', trade: 'baker', category: 'food_order', mcc: '5462', shape: 'made_to_order',
        // Made-to-order is a DATE ONLY — the collection time is arranged by
        // message afterwards, so no offered-times list.
        leadTimeDays: 2, cancelHours: 48, horizonDays: 120, maxGuests: 1,
        fulfilment: 'collection', street: '12 King Street', town: 'Castle Douglas', postcode: 'DG7 1AA', mapLat: 54.9372, mapLng: -3.9210,
        headshot: IMG('seed-assets/baker-face.png'), photos: [IMG('seed-assets/baker-1.jpg')],
        professional_title: 'Cakes & bakes to order', years: 6,
        qualifications: 'Level 3 Patisserie; registered home bakery.', recognition: null,
        what_to_expect: 'Cakes and boxes of bakes made fresh to order, ready to collect from the bakehouse.',
        // The three phases are shown under the shape's real headings (Order / Made
        // to order / Collection for this collection-only baker), so the detail text
        // is written to match collection, not delivery.
        itinerary: [
            { title: 'Order', detail: 'Tell me what you would like and when, at least two days ahead.' },
            { title: 'Bake', detail: 'Made fresh the day before or the morning of.' },
            { title: 'Collection', detail: 'Ready to collect from the bakehouse in the window we agree.' },
        ],
        minAge: null, activityLevel: 'gentle', whatToBring: 'Nothing — just come by to collect.',
        amenities: [], accessibility: null, parking: null,
        dietaryNote: 'Gluten-free and vegan on request; made in a kitchen that handles nuts.', dietaryOptions: ['vegan', 'gluten_free'],
        items: [
            // Custom — made to the guest's design, so it turns the order into a
            // request the baker approves. The other two are off-the-shelf (standard).
            { name: 'Celebration cake (8–10)', description: 'A two-layer cake, your flavour and message.', price: 42, unit: 'flat', sort: 0, image: IMG('seed-assets/baker-1.jpg'), isCustom: true,
                ingredients: 'Wheat flour, butter, free-range eggs, sugar, Galloway raspberries, vanilla, double cream.',
                allergens: 'Contains wheat (gluten), egg, milk. Made in a kitchen that also handles nuts and soya.' },
            { name: 'Box of Galloway bakes', description: 'A dozen assorted traybakes and scones.', price: 24, unit: 'flat', sort: 1, image: IMG('seed-assets/baker-2.jpg'),
                ingredients: 'Wheat flour, butter, oats, sugar, sultanas, free-range eggs, milk.',
                allergens: 'Contains wheat (gluten), oats, egg, milk. May contain nuts.' },
            // A per-item line, so a made-to-order order can carry a real quantity
            // (three boxes) — the "guests means quantity" case for change-count.
            { name: 'Traybake box', description: 'Six traybakes, boxed. Order as many as you like.', price: 8, unit: 'item', sort: 2, image: IMG('seed-assets/baker-3.jpg'),
                ingredients: 'Wheat flour, butter, sugar, cocoa, oats, golden syrup.',
                allergens: 'Contains wheat (gluten), oats, milk. May contain nuts.' },
        ],
    });
    const bakerItemRows = await db.select('service_provider_items', '?select=id,unit,name&provider_id=eq.' + baker.id + '&order=sort_order');
    created.push({ label: 'Galloway Bakehouse (baker · made to order)', ...bakerOwner, providerId: baker.id });

    /* --------------------------------------------- orders on Liam, each state */
    const gEmail = liam.email;
    const orderBase = { guestId: liam.id, guestName, guestEmail: gEmail };
    // A come-to-you order happens at the guest's cottage; find a real stay with a
    // coordinate so the order map has somewhere to point.
    const stayRow = (await db.select('bookings', '?select=id,listing_id,listings!inner(latitude)&guest_id=eq.' + liam.id + '&listings.latitude=not.is.null&order=check_out.desc&limit=1'))[0];
    const cottage = stayRow ? { bookingId: stayRow.id, listingId: stayRow.listing_id } : {};

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
    await makeOrder({ ...orderBase, ...cottage, provider: chef, date: dayOffset(12), time: time(19), quantity: 4, attendees: 4, unit: 'person', unitPrice: 55, price: 220, itemId: cItem.id, itemName: cItem.name, status: 'authorised', fulfilment: 'delivery' });
    await makeOrder({ ...orderBase, ...cottage, provider: chef, date: dayOffset(20), time: time(18), quantity: 2, attendees: 2, unit: 'person', unitPrice: 55, price: 110, itemId: cItem.id, itemName: cItem.name, status: 'confirmed', fulfilment: 'delivery' });

    // BAKER: a confirmed order and a refunded one.
    const bItem = bakerItemRows[0];
    await makeOrder({ ...orderBase, provider: baker, date: dayOffset(5), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'confirmed', fulfilment: 'collection' });
    await makeOrder({ ...orderBase, provider: baker, date: dayOffset(-3), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'refunded', fulfilment: 'collection' });

    /* --------------------------- walkable upcoming set: one per provider, spread
       across today / tomorrow / this week / next week — for the dashboard cards,
       the countdown badges and each order page. */
    const upSauna = await makeSession(sauna.id, dayOffset(0), time(19), { seats: 2, capacity: 6 });
    const oToday = await makeOrder({ ...orderBase, provider: sauna, sessionId: upSauna.id, date: dayOffset(0), time: time(19), quantity: 2, adults: 2, children: 0, unit: 'person', unitPrice: 18, price: 36, itemId: sauShared.id, itemName: sauShared.name, status: 'confirmed', fulfilment: 'collection' });
    const upYoga = await makeSession(yoga.id, dayOffset(1), time(8), { seats: 2, capacity: 10, declared: true, title: 'Sunrise class' });
    const oTomorrow = await makeOrder({ ...orderBase, provider: yoga, sessionId: upYoga.id, date: dayOffset(1), time: time(8), quantity: 2, adults: 2, children: 0, unit: 'person', unitPrice: 14, price: 28, itemId: yItem.id, itemName: yItem.name, status: 'confirmed', fulfilment: 'collection' });
    const oThisWeek = await makeOrder({ ...orderBase, ...cottage, provider: chef, date: dayOffset(3), time: time(19, 30), quantity: 4, attendees: 4, unit: 'person', unitPrice: 55, price: 220, itemId: cItem.id, itemName: cItem.name, status: 'confirmed', fulfilment: 'delivery' });
    const oNextWeek = await makeOrder({ ...orderBase, provider: baker, date: dayOffset(8), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'confirmed', fulfilment: 'collection' });

    /* --------------- seed-sauna (Isla): an UPCOMING HOLIDAY-LET STAY with a
       confirmed experience booking in each category attached to it — one made to
       order, one comes to you (the chef's flat extra-guests dinner, so its
       pricing layout can be checked), one slot — all comfortably inside their
       free-cancellation windows so change-count and change-date can be walked;
       plus one PAST its window, to walk the closed-changes sheet.

       The stay is a real booking on an existing cottage that has coordinates, so
       the come-to-you order's map has somewhere to point, and /trips shows the
       stay with its experiences the way a guest sees it. */
    const islaBase = { guestId: saunaOwner.id, guestName: 'Isla', guestEmail: saunaOwner.email };
    const bBox = bakerItemRows.find((i) => i.unit === 'item') || bItem;
    const chefFlat = chefItemRows.find((i) => i.unit === 'flat') || cItem;

    // The cottage(s) to book: listings with a coordinate (id order → stable pick).
    // The past stay uses a DIFFERENT listing from the upcoming one so the two can
    // never collide with each other or the same cottage's other seeded bookings.
    const islaCottages = await db.select('listings', '?select=id,host_id,title&latitude=not.is.null&order=id.asc&limit=6');
    const islaCottage = islaCottages[0];
    const islaPastCottage = islaCottages[1] || islaCottages[0];
    let islaStay = null;
    if (islaCottage) {
        const nowIso = new Date().toISOString();
        [islaStay] = await db.insert('bookings', {
            listing_id: islaCottage.id, guest_id: saunaOwner.id, host_id: islaCottage.host_id,
            check_in: dayOffset(11), check_out: dayOffset(16),
            guests: 2, adults: 2, children: 0, pets: 0,
            total_price: 520, status: 'confirmed', payment_status: 'paid', amount_paid: 520,
            confirmed_at: nowIso, paid_at: nowIso, stripe_payment_intent_id: ISLA_STAY_PI,
        });
    }
    const islaCottageRef = islaStay ? { bookingId: islaStay.id, listingId: islaCottage.id } : {};

    const islaYogaS = await makeSession(yoga.id, dayOffset(15), time(8), { seats: 1, capacity: 10, declared: true, title: 'Sunrise class' });
    await makeSession(yoga.id, dayOffset(16), time(8), { seats: 0, capacity: 10, declared: true, title: 'Sunrise class' });
    await makeSession(yoga.id, dayOffset(17), time(9), { seats: 0, capacity: 10, declared: true, title: 'Sunrise class' });
    // INSIDE the window — all attached to the stay, dated within it.
    const oIslaSlot = await makeOrder({ ...islaBase, ...islaCottageRef, provider: yoga, sessionId: islaYogaS.id, date: dayOffset(15), time: time(8), quantity: 1, adults: 1, children: 0, unit: 'person', unitPrice: 14, price: 14, itemId: yItem.id, itemName: yItem.name, status: 'confirmed', fulfilment: 'collection' });
    const oIslaMto = await makeOrder({ ...islaBase, ...islaCottageRef, provider: baker, date: dayOffset(12), time: time(13), quantity: 3, unit: 'item', unitPrice: 8, price: 24, itemId: bBox.id, itemName: bBox.name, status: 'confirmed', fulfilment: 'collection' });
    // The chef works Wed–Sun (days 3,4,5,6,0). Snap the dinner to a working day
    // inside the stay [dayOffset(11), dayOffset(15)] so the change-date sheet's
    // own opening hours never strike the booking's own date. Offset 12 is skipped
    // — a chef order on the other cottage already holds that date, and the chef
    // is exclusive per date. A 5-night stay always yields a Wed–Sun day here.
    const CHEF_WORK_DAYS = new Set([3, 4, 5, 6, 0]);
    const dowOfKey = (key) => new Date(key + 'T12:00:00Z').getUTCDay();
    const chefDinnerDate = (() => {
        for (const n of [13, 14, 15, 11]) { const key = dayOffset(n); if (CHEF_WORK_DAYS.has(dowOfKey(key))) return key; }
        return dayOffset(13);
    })();
    // Comes-to-you: the chef's FLAT extra-guests dinner — £220 for up to 4, a
    // party of 6 (2 extra adults) → £220 + 2×£40 = £300.
    const oIslaCty = await makeOrder({ ...islaBase, ...islaCottageRef, provider: chef, date: chefDinnerDate, time: time(19), quantity: 1, attendees: 6, adults: 6, children: 0, unit: 'flat', unitPrice: 220, price: 300, itemId: chefFlat.id, itemName: chefFlat.name, status: 'confirmed', fulfilment: 'delivery' });
    // PAST its window — a made-to-order due tomorrow (24h < the baker's 48h), to
    // walk the "changes are closed" sheet.
    const oIslaClosed = await makeOrder({ ...islaBase, provider: baker, date: dayOffset(1), time: time(10), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'confirmed', fulfilment: 'collection' });

    // A STANDALONE experience — booked with no stay at all (bookingless). A
    // made-to-order collection box, so no address is needed; it carries a picked
    // time. Proves the "bookable by anyone, no holiday-let needed" path and gives
    // /trips an experience with its own card (not under a stay).
    const oIslaNoStay = await makeOrder({ ...islaBase, provider: baker, date: dayOffset(9), time: time(16), quantity: 2, unit: 'item', unitPrice: 8, price: 16, itemId: bBox.id, itemName: bBox.name, status: 'confirmed', fulfilment: 'collection' });

    // A PAST STAY with a PAST EXPERIENCE on it, so the /trips "Past" section has
    // something in it. The stay finished last week; the chef cooked during it.
    let islaPastStay = null;
    if (islaPastCottage) {
        const nowIso = new Date().toISOString();
        [islaPastStay] = await db.insert('bookings', {
            listing_id: islaPastCottage.id, guest_id: saunaOwner.id, host_id: islaPastCottage.host_id,
            check_in: dayOffset(-45), check_out: dayOffset(-41),
            guests: 2, adults: 2, children: 0, pets: 0,
            total_price: 460, status: 'confirmed', payment_status: 'paid', amount_paid: 460,
            confirmed_at: nowIso, paid_at: nowIso, stripe_payment_intent_id: ISLA_PAST_STAY_PI,
        });
    }
    const islaPastRef = islaPastStay ? { bookingId: islaPastStay.id, listingId: islaPastCottage.id } : {};
    const oIslaPast = await makeOrder({ ...islaBase, ...islaPastRef, provider: baker, date: dayOffset(-43), time: time(13), quantity: 1, unit: 'flat', unitPrice: 42, price: 42, itemId: bItem.id, itemName: bItem.name, status: 'confirmed', fulfilment: 'collection' });

    const walkable = [
        ['Today',           'Loch Sauna (sauna)',      oToday],
        ['Tomorrow',        'Harbour Yoga (class)',    oTomorrow],
        ['Later this week', 'Solway Table (chef)',     oThisWeek],
        ['Next week',       'Galloway Bakehouse (baker)', oNextWeek],
    ];

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
    console.log('\n  Walkable upcoming orders (dashboard cards + countdown badges + order pages):');
    for (const [when, biz, o] of walkable) {
        console.log('    ' + when.padEnd(16) + biz.padEnd(28) + '/experiences/order/' + o.id);
    }
    console.log('\n  seed-sauna@' + SEED_DOMAIN + ' — an upcoming holiday-let stay with experiences attached:');
    console.log('    stay: ' + (islaStay ? ('"' + islaCottage.title + '"  ' + dayOffset(11) + ' → ' + dayOffset(16) + '  (booking ' + islaStay.id + ')') : '— no coordinate listing found, orders left standalone'));
    console.log('    slot (yoga)           /experiences/order/' + oIslaSlot.id + '   (inside window)');
    console.log('    made_to_order (baker) /experiences/order/' + oIslaMto.id + '   (inside window)');
    console.log('    comes_to_you (chef)   /experiences/order/' + oIslaCty.id + '   (inside window · flat extra-guests £300)');
    console.log('    closed window (baker) /experiences/order/' + oIslaClosed.id + '   (due tomorrow — changes closed)');
    console.log('    no-stay experience    /experiences/order/' + oIslaNoStay.id + '   (booked standalone, its own /trips card)');
    console.log('    PAST stay             ' + (islaPastStay ? ('booking ' + islaPastStay.id + '  ' + dayOffset(-45) + ' → ' + dayOffset(-41)) : '—'));
    console.log('    PAST experience       /experiences/order/' + oIslaPast.id + '   (on the past stay)');
    console.log('    chef public listing   /experiences/browse/' + chef.id + '   (standalone bookable)');
    console.log('    Your trips page       /trips');
    console.log('\n  done.');
    process.exit(0);
}

main().catch((err) => { console.error('\nseed failed:', err && (err.stack || err.message)); process.exit(1); });
