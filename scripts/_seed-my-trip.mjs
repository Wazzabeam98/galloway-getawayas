// A confirmed, PAID, upcoming stay on your OWN test listing, with the arrival
// secrets filled in and two confirmed experience orders against it — so /trips,
// the trip card, the group row, the check-in rail and the experiences panel all
// show the whole thing as a guest sees it.
//
//   node scripts/_seed-my-trip.mjs          # create it
//   node scripts/_seed-my-trip.mjs --reset  # remove everything it made
//
// TEST PROJECT ONLY. seed-lib refuses any database that is not the test project,
// so this physically cannot touch production.
//
// You sign in as liamworrall18@hotmail.com and it is a SELF-BOOKING (guest =
// host = you): the only way to see one of your own cottages the way a guest
// does. No Stripe and no money — the rows are written straight in; check_in is
// two days out so the door code and wifi fall inside the 3-day secrets window.

import { loadEnv, assertTestEnvironment, supabaseClient, dayOffset } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const ME = 'liamworrall18@hotmail.com';
const BOOKING_PI = 'pi_seed_mytrip';   // marker on the booking, so --reset finds it
const ORDER_TAG = 'MYTRIP-SEED';       // marker in service_orders.note

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function main() {
    const user = await findUser(ME);
    if (!user) { console.error('No test account for ' + ME + '.'); process.exit(1); }
    const me = user.id;

    // Your WALKTHROUGH listings, ordered by id so the SAME one is picked every
    // run (created_at could tie and flip the choice, leaving stale data behind).
    const listings = await db.select('listings', '?host_id=eq.' + me + '&title=like.WALKTHROUGH*&select=id,title&order=id.asc');
    if (!listings || !listings.length) { console.error('You host no WALKTHROUGH listings on test.'); process.exit(1); }
    const listing = listings[0];

    // Remove everything this script makes — used by --reset, and by create to be
    // idempotent. Clears arrival data on ALL the WALKTHROUGH listings, not just
    // the chosen one, so a run that once picked a different listing leaves nothing
    // stale. They started with no arrival row / no address / no images, so
    // clearing is a faithful restore.
    async function clean() {
        await db.remove('service_orders', '?guest_id=eq.' + me + '&note=like.' + encodeURIComponent(ORDER_TAG + '%'));
        await db.remove('bookings', '?guest_id=eq.' + me + '&stripe_payment_intent_id=eq.' + BOOKING_PI);
        for (const l of listings) {
            await db.remove('listing_arrival', '?listing_id=eq.' + l.id);
            await db.remove('listing_access_codes', '?listing_id=eq.' + l.id);
            await db.update('listings', '?id=eq.' + l.id, { street_address: null, postcode: null, images: [] });
        }
    }

    if (reset) {
        await clean();
        console.log('Removed the seeded stay, its experience orders and the arrival details on "' + listing.title + '".');
        return;
    }

    await clean();

    // 1 — address + arrival secrets on the listing.
    await db.update('listings', '?id=eq.' + listing.id, {
        street_address: 'Harbour Row, Garlieston',
        postcode: 'DG8 8BQ',
        // A genuine landscape cottage photo (copied from a real production
        // listing into the test bucket), so the card shows an actual photo
        // rather than a placeholder.
        images: ['seed/real-cottage.jpg'],
    });
    await db.insert('listing_arrival', {
        listing_id: listing.id,
        arrival_directions: 'Off the A75 at Creetown, follow the shore road into Garlieston; the cottage is the white one at the end of Harbour Row, blue door facing the water.',
        parking_info: 'Free private parking for two cars on the gravel in front of the cottage.',
        wifi_name: 'HarbourRow-Guest',
        wifi_password: 'saltmarsh1997',
        what3words: '///daisy.harbour.lantern',
    });
    await db.insert('listing_access_codes', { listing_id: listing.id, code: '4729' });

    // 2 — the stay. Starts in two days so daysUntilCheckIn <= 3 and the door
    // code + wifi render (see app/arrival/[bookingId]/page.tsx: codeReady).
    const checkIn = dayOffset(2);
    const checkOut = dayOffset(6);
    const nowIso = new Date().toISOString();
    const [booking] = await db.insert('bookings', {
        listing_id: listing.id,
        guest_id: me,
        host_id: me,
        check_in: checkIn,
        check_out: checkOut,
        guests: 2, adults: 2, children: 0, pets: 0,
        total_price: 480,
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: 480,
        confirmed_at: nowIso,
        paid_at: nowIso,
        stripe_payment_intent_id: BOOKING_PI,
    });

    // 3 — two confirmed experience orders, from two different live providers,
    // dated inside the stay. Same shape as scripts/_demo-orders.mjs.
    const provs = await db.select('service_providers',
        '?audience=eq.guest&status=eq.approved&select=id,business_name,shape&order=business_name.asc');
    const chosen = [];
    for (const p of (provs || [])) {
        const items = await db.select('service_provider_items',
            '?provider_id=eq.' + p.id + '&active=eq.true&order=sort_order.asc&select=id,name,description,price,unit');
        if (items && items.length) chosen.push({ p, item: items[0] });
        if (chosen.length === 2) break;
    }
    let made = 0;
    for (let i = 0; i < chosen.length; i++) {
        const { p, item } = chosen[i];
        const isSlot = p.shape === 'slot';
        await db.insert('service_orders', {
            provider_id: p.id, guest_id: me, listing_id: listing.id, booking_id: booking.id,
            trade: 'guest', status: 'confirmed', shape: p.shape,
            service_date: dayOffset(3 + i), service_time: isSlot ? '18:00:00' : null,
            price: Number(item.price), quantity: 1, commission_rate: 0.10,
            item_name: item.name, item_description: item.description || null,
            item_unit: item.unit || 'flat', unit_price: Number(item.price),
            provider_business_name: p.business_name,
            guest_name: 'Liam', guest_email: ME,
            exclusive_per_date: p.shape === 'comes_to_you',
            confirmed_at: nowIso,
            stripe_payment_intent_id: 'pi_' + ORDER_TAG.toLowerCase() + '_' + i,
            note: ORDER_TAG + ' seeded experience',
        });
        made++;
    }

    console.log('Seeded a confirmed, paid stay on "' + listing.title + '"');
    console.log('  dates : ' + checkIn + ' → ' + checkOut + ' (starts in 2 days, so the door code shows)');
    console.log('  arrival: address + what3words + parking + door code 4729 + wifi');
    console.log('  orders : ' + made + ' confirmed experiences (' + chosen.map((c) => c.p.business_name).join(', ') + ')');
    console.log('  booking id: ' + booking.id);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
