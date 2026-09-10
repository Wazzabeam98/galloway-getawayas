// A per-person slot with a MINIMUM of 4, plus an upcoming stay for the signed-in
// guest — the fixture for proving the booking route rejects a below-minimum
// quantity from a CRAFTED request, not just the wizard's picker.
//
//   node scripts/seed-slot-min-proof.mjs          # create it, print the ids
//   node scripts/seed-slot-min-proof.mjs --reset  # remove everything it made
//
// TEST PROJECT ONLY (seed-lib refuses anything else). No Stripe: the provider
// carries a placeholder stripe_account_id so isLiveToGuests passes and the route
// reaches the minimum check, which sits BEFORE the seat claim and the Stripe
// call — so a sub-minimum request is rejected without any card ever involved.
//
// This script only WRITES to the test database (seed-lib refuses any other), so
// it does not talk to the site and needs no target guard. The crafted request
// itself is run separately, signed in, from the browser page context — see the
// instructions this prints on success.

import { loadEnv, assertTestEnvironment, supabaseClient, dayOffset } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const ME = 'liamworrall18@hotmail.com';
const BOOKING_PI = 'pi_seed_slotmin';          // marker on the booking, for --reset
const BUSINESS = 'SLOTMIN-PROOF wild swim';    // marker on the provider, for --reset
const MIN_PEOPLE = 4;
const CAPACITY = 6;

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function clean(me) {
    await db.remove('bookings', '?guest_id=eq.' + me + '&stripe_payment_intent_id=eq.' + BOOKING_PI).catch(() => {});
    const provs = await db.select('service_providers', '?owner_id=eq.' + me + '&business_name=eq.' + encodeURIComponent(BUSINESS) + '&select=id').catch(() => []);
    for (const p of provs || []) {
        await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
        await db.remove('slot_availability', '?provider_id=eq.' + p.id).catch(() => {});
        await db.remove('slot_blocks', '?provider_id=eq.' + p.id).catch(() => {});
        await db.remove('slot_sessions', '?provider_id=eq.' + p.id).catch(() => {});
        await db.remove('service_providers', '?id=eq.' + p.id).catch(() => {});
    }
}

async function main() {
    const user = await findUser(ME);
    if (!user) { console.error('No test account for ' + ME + '.'); process.exit(1); }
    const me = user.id;

    await clean(me);
    if (reset) { console.log('Removed the slot-min proof fixture.'); return; }

    // A listing to hang the booking on (bookings.listing_id is a FK). Any of the
    // guest's own, or the first on the project — the booking's dates are what the
    // route reads, not the listing.
    const mine = await db.select('listings', '?host_id=eq.' + me + '&select=id&order=id.asc&limit=1');
    const anyListing = (mine && mine.length) ? mine : await db.select('listings', '?select=id&order=id.asc&limit=1');
    if (!anyListing || !anyListing.length) { console.error('No listing on test to hang a booking on.'); process.exit(1); }
    const listingId = anyListing[0].id;

    // An upcoming stay for the guest. The session must fall inside [check_in,
    // check_out). Dated a month out so it can't collide with another confirmed
    // booking on the borrowed listing (the no-overlap exclusion constraint).
    const checkIn = dayOffset(30);
    const checkOut = dayOffset(34);
    const nowIso = new Date().toISOString();
    const [booking] = await db.insert('bookings', {
        listing_id: listingId, guest_id: me, host_id: me,
        check_in: checkIn, check_out: checkOut,
        guests: 4, adults: 4, children: 0, pets: 0,
        total_price: 400, status: 'confirmed', payment_status: 'paid', amount_paid: 400,
        confirmed_at: nowIso, paid_at: nowIso, stripe_payment_intent_id: BOOKING_PI,
    });

    // The per-person slot with a minimum of 4. Placeholder Stripe fields so
    // isLiveToGuests passes; the route never calls Stripe before the min check.
    const [prov] = await db.insert('service_providers', [{
        owner_id: me,
        business_name: BUSINESS,
        trade: 'guest', audience: 'guest', kind: 'external',
        shape: 'slot',
        slot_length_minutes: 60,
        slot_capacity: CAPACITY,
        slot_min_people: MIN_PEOPLE,
        custom_label: 'Wellness & activities',
        stripe_mcc: '7997',
        provider_name: 'Proof Fixture',
        based_line: 'Kirkcudbright',
        description: 'A guided wild swim — per person, minimum of four. Seed fixture for the minimum invariant.',
        status: 'approved',
        stripe_account_id: 'acct_seedproof',
        stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true,
        plan: 'commission', commission_rate: 0.10,
        updated_at: nowIso,
    }]);

    // The one session offering, priced PER PERSON (so the quantity multiplies and
    // the minimum applies), above zero (so the route's priced-item read finds it).
    await db.insert('service_provider_items', [
        { provider_id: prov.id, name: 'Guided wild swim', description: 'Ninety minutes in the water, all abilities.', price: 20, unit: 'person', sort_order: 0, active: true },
    ]);

    // Open every day 09:00–18:00, so any date in the stay generates 10:00 as a
    // real, bookable session.
    await db.insert('slot_availability',
        [0, 1, 2, 3, 4, 5, 6].map((d) => ({ provider_id: prov.id, day_of_week: d, open_time: '09:00', close_time: '18:00' })));

    const sessionDate = dayOffset(31);   // inside [check_in, check_out)
    const sessionTime = '10:00';

    console.log('\n  Seeded the slot-min proof fixture on the TEST project.');
    console.log('  provider  : ' + prov.id + '  (per person, capacity ' + CAPACITY + ', MINIMUM ' + MIN_PEOPLE + ')');
    console.log('  booking   : ' + booking.id + '  (stay ' + checkIn + ' → ' + checkOut + ')');
    console.log('  session   : ' + sessionDate + ' ' + sessionTime + '  (a real, future session in the stay)');
    console.log('\n  Crafted request (run signed in as ' + ME + ', from the browser page context):');
    console.log('    POST the slot-booking route with this JSON body —');
    console.log('      providerId  : ' + prov.id);
    console.log('      bookingId   : ' + booking.id);
    console.log('      sessionDate : ' + sessionDate);
    console.log('      sessionTime : ' + sessionTime);
    console.log('      quantity    : 2');
    console.log('  quantity 2 is under the minimum of ' + MIN_PEOPLE + ' → expect HTTP 400.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
