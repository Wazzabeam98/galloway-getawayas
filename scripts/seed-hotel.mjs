// One published HOTEL on the TEST project, with three room types, so the hotel
// vertical (phase one) can be walked end to end: the public browse grid, the
// hotel page, and a booking of one room type through Stripe test checkout.
//
// WHY ITS OWN SEEDER / DOMAIN. The host account lives on @gallowayhotel.test —
// the hotels seed's OWN reserved domain, kept distinct from every other seed's
// (@gallowayexp.test, @gallowaytrade.test, …), because some seeds reset by
// deleting every user on their domain. Do not reuse another seed's domain here.
//
// It reuses photos already in the listings bucket (from existing cottages) so
// the hotel page looks real without uploading anything. The hotel is inserted
// straight as 'published' (the seed is the service role), so it is bookable
// immediately — walking the sign-up wizard + admin approval is a separate thing
// you do signed in as the host / an admin.
//
// USAGE
//   node scripts/seed-hotel.mjs
//   node scripts/seed-hotel.mjs --reset

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const SEED_DOMAIN = 'gallowayhotel.test';
const HOST_EMAIL = 'seed-hotel@' + SEED_DOMAIN;

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')');
    process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
}

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

async function hostId() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    const found = (users || []).find((u) => String(u.email || '').toLowerCase() === HOST_EMAIL);
    return found ? found.id : null;
}

async function clear() {
    const id = await hostId();
    if (!id) { console.log('  nothing to remove'); return; }
    const hotels = await db.select('hotels', '?owner_id=eq.' + id + '&select=id');
    for (const h of hotels) {
        const rooms = await db.select('hotel_room_types', '?hotel_id=eq.' + h.id + '&select=id');
        for (const r of rooms) {
            // A room type with bookings is ON DELETE RESTRICT via bookings.room_type_id,
            // so clear any test bookings on it first (only this seed's hotel).
            await db.remove('bookings', '?room_type_id=eq.' + r.id);
        }
        await db.remove('hotels', '?id=eq.' + h.id); // room types cascade
    }
    await db.auth('DELETE', '/admin/users/' + id);
    console.log('  removed ' + HOST_EMAIL + ' and its hotel');
}

async function someListingPhotos(n) {
    // Reuse real photos already in the listings bucket so the page looks right.
    const listings = await db.select('listings', '?select=images&images=not.is.null&order=created_at.desc&limit=6');
    const all = [];
    for (const l of listings) for (const p of (l.images || [])) if (p && !all.includes(p)) all.push(p);
    return all.slice(0, n);
}

async function seed() {
    const made = await db.auth('POST', '/admin/users', {
        email: HOST_EMAIL,
        password: 'hotel-' + Math.random().toString(36).slice(2, 10),
        email_confirm: true,
        user_metadata: { full_name: 'Harbour Hotel (host)' },
    });
    const owner = made.id || made.user?.id;
    const existing = await db.select('profiles', '?select=id&id=eq.' + owner);
    if (existing.length) await db.update('profiles', '?id=eq.' + owner, { email: HOST_EMAIL, full_name: 'Harbour Hotel', first_name: 'Harbour', last_name: 'Hotel' });
    else await db.insert('profiles', { id: owner, email: HOST_EMAIL, full_name: 'Harbour Hotel', first_name: 'Harbour', last_name: 'Hotel' });

    const photos = await someListingPhotos(5);

    const [hotel] = await db.insert('hotels', [{
        owner_id: owner,
        status: 'published',
        name: 'The Harbour Hotel',
        description:
            'A small harbourside hotel in the heart of Kirkcudbright, a few steps from the galleries and the water. '
            + 'Twelve rooms, a bar and a restaurant using Galloway produce, and parking behind.',
        star_rating: 3,
        property_type: 'hotel',
        location: 'Kirkcudbright, Dumfries and Galloway',
        street_address: '1 Harbour Street',
        postcode: 'DG6 4JG',
        latitude: 54.8357,
        longitude: -4.0503,
        check_in_time: '15:00',
        check_out_time: '11:00',
        facilities: ['Wifi', 'Restaurant', 'Bar', 'Breakfast available', 'Room service', 'Pets allowed',
            '24-hour front desk', 'Luggage storage', 'Lift', 'Daily housekeeping', 'Family rooms', 'Non-smoking rooms'],
        parking_type: 'private',
        parking_price: null,
        restaurant_hours: 'Breakfast 7–10am, Dinner 6–9pm',
        house_rules: 'No smoking indoors. Well-behaved dogs welcome in the bar and some rooms.',
        cancellation_policy: 'Flexible',
        vat_registered: true,
        vat_number: 'GB123456789',
        images: photos,
    }]);

    const rooms = [
        {
            hotel_id: hotel.id, name: 'Classic Double', description: 'A cosy double with a town view.',
            inventory_count: 6, max_adults: 2, max_children: 0, max_occupancy: 2, size_sqm: 16,
            bed_config: [{ type: 'double', count: 1 }],
            bathroom_type: 'private', bathroom_features: ['Shower', 'Toilet', 'Free toiletries', 'Hairdryer'],
            views: ['City view'], smoking: 'non_smoking', accessibility: [],
            amenities: ['Flat-screen TV', 'Free WiFi', 'Tea/coffee maker', 'Hairdryer'],
            breakfast_included: true, price_per_night: 95, min_nights: 1, sort_order: 0,
        },
        {
            hotel_id: hotel.id, name: 'Harbour View Double', description: 'A larger double looking over the harbour.',
            inventory_count: 4, max_adults: 2, max_children: 1, max_occupancy: 3, size_sqm: 22,
            bed_config: [{ type: 'king', count: 1 }],
            bathroom_type: 'private', bathroom_features: ['Bath', 'Shower', 'Toilet', 'Free toiletries', 'Bathrobe'],
            views: ['Sea view'], smoking: 'non_smoking', accessibility: [],
            amenities: ['Flat-screen TV', 'Free WiFi', 'Tea/coffee maker', 'Minibar', 'Safe'],
            breakfast_included: true, price_per_night: 135, min_nights: 1, sort_order: 1,
        },
        {
            hotel_id: hotel.id, name: 'Family Room', description: 'A family room sleeping up to four.',
            inventory_count: 2, max_adults: 2, max_children: 2, max_occupancy: 4, size_sqm: 28,
            bed_config: [{ type: 'king', count: 1 }, { type: 'bunk', count: 1 }],
            bathroom_type: 'private', bathroom_features: ['Shower', 'Toilet', 'Free toiletries'],
            views: ['Garden view'], smoking: 'non_smoking', accessibility: ['Ground floor'],
            amenities: ['Flat-screen TV', 'Free WiFi', 'Tea/coffee maker'],
            breakfast_included: false, price_per_night: 165, min_nights: 2, sort_order: 2,
        },
    ];
    const images = (await someListingPhotos(6));
    rooms.forEach((r, i) => { r.images = images.slice(i, i + 1); });
    await db.insert('hotel_room_types', rooms);

    return hotel;
}

(async () => {
    console.log(reset ? 'Resetting hotel seed…' : 'Seeding a hotel…');
    await clear();
    if (reset) { console.log('done (reset only).'); return; }
    const hotel = await seed();
    console.log('\n  Seeded: The Harbour Hotel');
    console.log('  Public page: /hotels/' + hotel.id);
    console.log('  Browse:      /hotels/browse');
    console.log('\n  Host login (magic link), run:');
    console.log('    node scripts/_signin-url.mjs ' + HOST_EMAIL + ' /hotels/' + hotel.id);
    console.log('\n  Done.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
