// DEMO ONLY — fake published reviews on one listing so the ratings design shows:
// a star average and the six-category breakdown (cleanliness, accuracy, check-in,
// communication, location, value). TEST ONLY (seed-lib refuses a non-test key).
//
//   node scripts/_seed-reviews.mjs                 # seed the WALKTHROUGH listing
//   LISTING=<id> node scripts/_seed-reviews.mjs    # seed a specific listing
//   node scripts/_seed-reviews.mjs --reset         # remove them and reset the aggregates
//   LISTING=<id> node scripts/_seed-reviews.mjs --reset
//
// Everything it makes is tagged: reviewer accounts under @reviewseed.test and
// bookings whose stripe_payment_intent_id starts pi_seed_review. Reviews cascade
// away when those bookings are deleted, so --reset is clean.

import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const DOMAIN = 'reviewseed.test';
const PASSWORD = 'review-demo-2026';
const PI = 'pi_seed_review';

const REVIEWERS = [
    { slug: 'fiona', name: 'Fiona Grant', overall: 5, cats: { cleanliness: 5, accuracy: 5, checkin: 5, communication: 5, location: 5, value: 4 }, comment: 'Spotless, exactly as pictured, and the welcome note made our first night. We’ll be back.' },
    { slug: 'tom', name: 'Tom Reid', overall: 4, cats: { cleanliness: 4, accuracy: 4, checkin: 5, communication: 4, location: 4, value: 4 }, comment: 'Comfortable and well equipped. Check-in was a breeze and the host answered fast.' },
    { slug: 'aisha', name: 'Aisha Khan', overall: 5, cats: { cleanliness: 5, accuracy: 5, checkin: 5, communication: 5, location: 4, value: 5 }, comment: 'One of the best places we’ve stayed on the Solway. Wood burner, sea air, total quiet.' },
    { slug: 'ben', name: 'Ben Docherty', overall: 4, cats: { cleanliness: 4, accuracy: 5, checkin: 4, communication: 5, location: 5, value: 4 }, comment: 'Lovely spot right by the water. A short walk to the harbour. Would happily return.' },
    { slug: 'rhona', name: 'Rhona Muir', overall: 5, cats: { cleanliness: 5, accuracy: 4, checkin: 5, communication: 5, location: 5, value: 5 }, comment: 'Beautifully kept and the directions were spot on. Felt like home within minutes.' },
];

async function findUser(email) {
    for (let page = 1; page <= 10; page++) {
        const r = await db.auth('GET', '/admin/users?page=' + page + '&per_page=200');
        const u = (r.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
        if (u) return u;
        if (!r.users || r.users.length < 200) break;
    }
    return null;
}

async function targetListing() {
    if (process.env.LISTING) return (await db.select('listings', '?id=eq.' + process.env.LISTING + '&select=id,host_id,title'))[0];
    return (await db.select('listings', '?title=like.WALKTHROUGH*&select=id,host_id,title&order=id.asc'))[0];
}

function mean(nums) { return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100; }

async function cleanup(listing) {
    for (const rv of REVIEWERS) {
        const u = await findUser(rv.slug + '@' + DOMAIN);
        if (!u) continue;
        // Reviews cascade on booking delete (reviews_booking_id_fkey ON DELETE CASCADE).
        await db.remove('bookings', '?guest_id=eq.' + u.id + '&stripe_payment_intent_id=like.' + PI + '%').catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
    // Reset the listing's aggregates so it reads as "New" again.
    if (listing) {
        await db.update('listings', '?id=eq.' + listing.id, {
            rating_avg: null, rating_count: 0,
            rating_cleanliness: null, rating_accuracy: null, rating_checkin: null,
            rating_communication: null, rating_location: null, rating_value: null,
        });
    }
}

async function main() {
    const listing = await targetListing();
    if (!listing) { console.error('No target listing found.'); process.exit(1); }

    if (reset) {
        await cleanup(listing);
        console.log('Removed seeded reviews and reset aggregates on "' + listing.title + '".');
        return;
    }

    await cleanup(listing);

    const [tmplB] = await db.select('bookings', '?select=*&limit=1');
    const nowIso = new Date().toISOString();

    for (let i = 0; i < REVIEWERS.length; i++) {
        const rv = REVIEWERS[i];
        const email = rv.slug + '@' + DOMAIN;
        let u = await findUser(email);
        if (!u) u = await db.auth('POST', '/admin/users', { email, password: PASSWORD, email_confirm: true, user_metadata: { name: rv.name } });
        await db.rest('POST', '/profiles?on_conflict=id', [{ id: u.id, email, full_name: rv.name, show_full_name: true }], 'resolution=merge-duplicates');

        // A past, confirmed, paid one-night stay for this reviewer. Checkout stays
        // within the last 14 days (a DB trigger closes the review window after
        // that), and the stays don't overlap (an exclusion constraint forbids
        // overlapping confirmed bookings on one listing).
        const checkOut = new Date(); checkOut.setDate(checkOut.getDate() - (2 + i * 2)); // 2,4,6,8,10 days ago
        const checkIn = new Date(checkOut); checkIn.setDate(checkIn.getDate() - 1);
        const iso = (d) => d.toISOString().slice(0, 10);
        const [bk] = await db.insert('bookings', [{
            ...tmplB, id: undefined, created_at: undefined, updated_at: undefined,
            guest_id: u.id, host_id: listing.host_id, listing_id: listing.id,
            check_in: iso(checkIn), check_out: iso(checkOut), guests: 2, adults: 2, children: 0, pets: 0,
            status: 'confirmed', payment_status: 'paid', amount_paid: 0, amount_refunded: 0, balance_amount: 0,
            stripe_payment_intent_id: PI + '_' + rv.slug,
        }]);

        const created = new Date(checkOut); created.setDate(created.getDate() + 1);
        await db.insert('reviews', [{
            booking_id: bk.id, listing_id: listing.id, reviewer_id: u.id, reviewee_id: listing.host_id,
            review_type: 'guest_to_host', rating: rv.overall, comment: rv.comment,
            cleanliness_rating: rv.cats.cleanliness, accuracy_rating: rv.cats.accuracy, checkin_rating: rv.cats.checkin,
            communication_rating: rv.cats.communication, location_rating: rv.cats.location, value_rating: rv.cats.value,
            is_published: true, published_at: nowIso, created_at: created.toISOString(),
        }]);
        console.log('  ✓ ' + rv.name + ' — ' + rv.overall + '★');
    }

    // Listing aggregates the ReviewsSummary reads.
    await db.update('listings', '?id=eq.' + listing.id, {
        rating_avg: mean(REVIEWERS.map((r) => r.overall)),
        rating_count: REVIEWERS.length,
        rating_cleanliness: mean(REVIEWERS.map((r) => r.cats.cleanliness)),
        rating_accuracy: mean(REVIEWERS.map((r) => r.cats.accuracy)),
        rating_checkin: mean(REVIEWERS.map((r) => r.cats.checkin)),
        rating_communication: mean(REVIEWERS.map((r) => r.cats.communication)),
        rating_location: mean(REVIEWERS.map((r) => r.cats.location)),
        rating_value: mean(REVIEWERS.map((r) => r.cats.value)),
    });

    console.log('\nSeeded ' + REVIEWERS.length + ' reviews on "' + listing.title + '" (' + listing.id + ').');
    console.log('Remove with:  LISTING=' + listing.id + ' node scripts/_seed-reviews.mjs --reset');
}

main().catch((e) => { console.error(e); process.exit(1); });
