// DEMO ONLY — a single showcase listing with data in every field the
// Airbnb-style listing upgrades added, so the preview shows them all:
//   - sleeping_arrangements (Where you'll sleep)
//   - a full Meet-your-host card: bio, years hosting, verified, rating + reviews,
//     a co-host, and a response rate / typical reply time computed from real
//     booking message history
//   - smoke + carbon-monoxide alarms and a damage deposit (Safety & property)
//   - a neighbourhood description (Where you'll be)
//
// TEST PROJECT ONLY (seed-lib refuses a non-test service key).
//
//   node scripts/_seed-airbnb-upgrades.mjs          # create / refresh
//   node scripts/_seed-airbnb-upgrades.mjs --reset  # remove everything it made
//
// Everything is tagged: the listing title starts "SHOWCASE —", accounts live
// under @ggshowcase.test, and seeded bookings carry pi_seed_showcase. Reset
// removes the lot.

import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const DOMAIN = 'ggshowcase.test';
const PW = 'Showcase2026!';
const PI = 'pi_seed_showcase';
const TITLE = 'SHOWCASE — 4 bedroom Townhouse, Kirkcudbright';

const HOST = { email: 'host@' + DOMAIN, preferred: 'Jamie', full: 'Jamie Stewart' };
const COHOST = { email: 'cohost@' + DOMAIN, preferred: 'Liam', full: 'Liam Stewart' };

// Five past guests → five published reviews (so the place crosses the 3-review
// line and shows a real score), plus a message thread for two of them that the
// host answered, so the response rate and typical reply time are computed from
// real history rather than set by hand.
const GUESTS = [
    { slug: 'sophie', name: 'Sophie Blake', overall: 5, cats: { cleanliness: 5, accuracy: 5, checkin: 5, communication: 5, location: 5, value: 4 }, comment: 'Exactly as described and right in the middle of town. The welcome bottle was a lovely touch.' },
    { slug: 'robin', name: 'Robin Carr', overall: 5, cats: { cleanliness: 5, accuracy: 4, checkin: 5, communication: 5, location: 5, value: 5 }, comment: 'Jamie and Liam replied in minutes when our plans changed. Perfectly placed for the harbour.' },
    { slug: 'sinead', name: 'Sinead Walsh', overall: 5, cats: { cleanliness: 5, accuracy: 5, checkin: 5, communication: 5, location: 4, value: 5 }, comment: 'Lovely house, comfy beds, Tesco across the road. Would happily stay again.' },
    { slug: 'linda', name: 'Linda Frost', overall: 4, cats: { cleanliness: 4, accuracy: 4, checkin: 5, communication: 5, location: 5, value: 4 }, comment: 'Great base for exploring. Kitchen is on the small side but well equipped.' },
    { slug: 'tamsin', name: 'Tamsin Reed', overall: 5, cats: { cleanliness: 5, accuracy: 5, checkin: 5, communication: 5, location: 5, value: 5 }, comment: 'Central, spotless and the brothers could not have been more helpful. Recommended.' },
];

// Who sent the first message (the guest, hours before check-in) and how long
// the host took to reply, in minutes — the raw material the response stats are
// worked out from. Two answered threads → 100% response rate, median reply
// ~35 min → "within an hour".
const THREADS = [
    { slug: 'sophie', guest: 'Hi! Is there parking right at the house, or should we use the square?', replyAfterMin: 20, reply: 'Hi Sophie — there is a permit space right outside, I will leave the permit on the hall table.' },
    { slug: 'robin', guest: 'Our ferry is delayed — any chance of a slightly later check-in?', replyAfterMin: 50, reply: 'No problem at all Robin, the lockbox is there whenever you arrive. Safe travels.' },
];

const SLEEPING = [
    { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'King bed', count: 1 }] },
    { label: 'Bedroom 2', kind: 'bedroom', beds: [{ type: 'King bed', count: 1 }] },
    { label: 'Bedroom 3', kind: 'bedroom', beds: [{ type: 'Single bed', count: 2 }] },
    { label: 'Bedroom 4', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }] },
    { label: 'Living room', kind: 'common', beds: [{ type: 'Sofa bed', count: 1 }] },
];

const NEIGHBOURHOOD =
    'St Cuthbert Street runs through the heart of Kirkcudbright, Scotland’s artists’ town on the River Dee. ' +
    'You are two minutes’ walk from the harbour and the galleries, with the Tesco across the road for anything you forget. ' +
    'The castle, the museums and a row of good cafes and takeaways are all within five minutes on foot — you can leave the car outside for the week.';

const AMENITIES = [
    'Wifi', 'Free parking on premises', 'Pets allowed', 'Indoor fireplace', 'Kitchen',
    'Washing machine', 'Dishwasher', 'TV', 'Heating', 'Essentials', 'Dedicated workspace',
    'Cot', 'Smoke alarm', 'Carbon monoxide alarm',
];

const HOST_BIO =
    'Hi, I’m Jamie. My brother Liam and I grew up in Kirkcudbright and we look after a few places in the town. ' +
    'We live five minutes away, so if anything is not right we can be round quickly. Happy to point you at the best ' +
    'beaches, walks and places to eat — just ask.';

async function findUser(email) {
    for (let page = 1; page <= 10; page++) {
        const r = await db.auth('GET', '/admin/users?page=' + page + '&per_page=200');
        const u = (r.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
        if (u) return u;
        if (!r.users || r.users.length < 200) break;
    }
    return null;
}
async function ensureUser(email) {
    const ex = await findUser(email);
    if (ex) { await db.auth('PUT', '/admin/users/' + ex.id, { password: PW, email_confirm: true }); return ex.id; }
    const made = await db.auth('POST', '/admin/users', { email, password: PW, email_confirm: true });
    return made.id;
}

async function findListing() {
    const rows = await db.select('listings', '?select=id,host_id&title=eq.' + encodeURIComponent(TITLE));
    return rows[0] || null;
}

async function cleanup() {
    const listing = await findListing();
    if (listing) {
        // Reviews + messages cascade on booking delete; delete bookings, then the listing.
        await db.remove('bookings', '?listing_id=eq.' + listing.id).catch(() => {});
        await db.remove('listing_access', '?listing_id=eq.' + listing.id).catch(() => {});
        await db.remove('listings', '?id=eq.' + listing.id).catch(() => {});
    }
    for (const g of GUESTS) {
        const u = await findUser(g.slug + '@' + DOMAIN);
        if (u) await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
    for (const h of [HOST, COHOST]) {
        const u = await findUser(h.email);
        if (u) await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
    }
}

const iso = (d) => d.toISOString().slice(0, 10);
function mean(nums) { return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100; }

async function main() {
    if (reset) {
        await cleanup();
        console.log('Removed the showcase listing and its accounts.');
        return;
    }

    await cleanup();

    // --- host + co-host ---------------------------------------------------
    const hostId = await ensureUser(HOST.email);
    const cohostId = await ensureUser(COHOST.email);

    // created_at years back so "Meet your host" reads "5 years hosting";
    // stripe_payouts_enabled → the Verified host badge; host_bio → the bio.
    const since = new Date(); since.setFullYear(since.getFullYear() - 5);
    await db.rest('POST', '/profiles?on_conflict=id', [{
        id: hostId, email: HOST.email, full_name: HOST.full, preferred_name: HOST.preferred,
        show_full_name: false, host_bio: HOST_BIO, created_at: since.toISOString(),
        stripe_payouts_enabled: true,
    }], 'resolution=merge-duplicates');
    await db.rest('POST', '/profiles?on_conflict=id', [{
        id: cohostId, email: COHOST.email, full_name: COHOST.full, preferred_name: COHOST.preferred,
        show_full_name: false,
    }], 'resolution=merge-duplicates');

    // --- the listing ------------------------------------------------------
    // Reuse the images of an existing listing that has some, so the gallery
    // isn't empty; fall back to none if the test project has no image anywhere.
    const withImages = await db.select('listings', '?select=images&images=not.is.null&order=created_at.desc&limit=20');
    const images = (withImages.find((l) => Array.isArray(l.images) && l.images.length >= 3) || {}).images || [];

    // Kirkcudbright town centre, approx (the public pin is derived from these).
    const LAT = 54.8380, LON = -4.0486;

    const [listing] = await db.insert('listings', [{
        host_id: hostId,
        title: TITLE,
        description:
            'A spacious four-bedroom townhouse in the very centre of Kirkcudbright, a short walk from the harbour, ' +
            'the galleries and the river. Comfortable rooms, a real fire for the colder months, and everything you ' +
            'need for a week away — with the car left outside the door.',
        location: 'Kirkcudbright, Dumfries and Galloway',
        latitude: LAT, longitude: LON, // approx_latitude/longitude are generated from these
        price_per_night: 160, max_guests: 7, bedrooms: 4, beds: 6, bathrooms: 1,
        property_type: 'Townhouses', privacy_type: 'Entire place',
        amenities: AMENITIES, images,
        damage_deposit: 150,
        sleeping_arrangements: SLEEPING,
        neighbourhood: NEIGHBOURHOOD,
        check_in_method: 'Lockbox', check_in_time: '15:00', check_out_time: '11:00',
        cancellation_policy: 'Moderate',
        instant_book: false,
        status: 'published',
    }]);
    console.log('  ✓ listing ' + listing.id);

    // --- co-host access ---------------------------------------------------
    await db.insert('listing_access', [{
        listing_id: listing.id, user_id: cohostId, email: COHOST.email, role: 'co_host',
        status: 'active', can_messages: true, can_bookings: true, can_calendar: true, can_listing: true,
        accepted_at: new Date().toISOString(),
    }]);
    console.log('  ✓ co-host ' + COHOST.preferred);

    // --- guests, bookings, reviews, messages ------------------------------
    const [tmplB] = await db.select('bookings', '?select=*&limit=1');
    const nowIso = new Date().toISOString();

    for (let i = 0; i < GUESTS.length; i++) {
        const g = GUESTS[i];
        const email = g.slug + '@' + DOMAIN;
        const uid = await ensureUser(email);
        await db.rest('POST', '/profiles?on_conflict=id', [{
            id: uid, email, full_name: g.name, show_full_name: true,
        }], 'resolution=merge-duplicates');

        // Non-overlapping past one-night stays (an exclusion constraint forbids
        // overlapping confirmed bookings), checkout within the last ~2 weeks.
        // One-night stays, 2 days apart, so no two confirmed stays touch (the
        // listing has an exclusion constraint on overlaps) and every checkout
        // stays inside the 14-day review window (a trigger closes it after that).
        const checkOut = new Date(); checkOut.setDate(checkOut.getDate() - (2 + i * 2));
        const checkIn = new Date(checkOut); checkIn.setDate(checkIn.getDate() - 1);
        const [bk] = await db.insert('bookings', [{
            ...tmplB, id: undefined, created_at: undefined, updated_at: undefined,
            guest_id: uid, host_id: hostId, listing_id: listing.id,
            check_in: iso(checkIn), check_out: iso(checkOut), guests: 2, adults: 2, children: 0, pets: 0,
            status: 'confirmed', payment_status: 'paid', amount_paid: 0, amount_refunded: 0, balance_amount: 0,
            stripe_payment_intent_id: PI + '_' + g.slug,
        }]);

        const created = new Date(checkOut); created.setDate(created.getDate() + 1);
        await db.insert('reviews', [{
            booking_id: bk.id, listing_id: listing.id, reviewer_id: uid, reviewee_id: hostId,
            review_type: 'guest_to_host', rating: g.overall, comment: g.comment,
            cleanliness_rating: g.cats.cleanliness, accuracy_rating: g.cats.accuracy, checkin_rating: g.cats.checkin,
            communication_rating: g.cats.communication, location_rating: g.cats.location, value_rating: g.cats.value,
            is_published: true, published_at: nowIso, created_at: created.toISOString(),
        }]);

        // A message thread the host answered, for the response stats.
        const thread = THREADS.find((t) => t.slug === g.slug);
        if (thread) {
            const askedAt = new Date(checkIn); askedAt.setDate(askedAt.getDate() - 1); askedAt.setHours(10, 0, 0, 0);
            const repliedAt = new Date(askedAt.getTime() + thread.replyAfterMin * 60000);
            await db.insert('messages', [{
                booking_id: bk.id, sender_id: uid, recipient_id: hostId, body: thread.guest,
                created_at: askedAt.toISOString(),
            }]);
            await db.insert('messages', [{
                booking_id: bk.id, sender_id: hostId, recipient_id: uid, body: thread.reply,
                created_at: repliedAt.toISOString(),
            }]);
        }
        console.log('  ✓ ' + g.name + ' — ' + g.overall + '★' + (thread ? ' (+ answered message)' : ''));
    }

    // Listing rating aggregates (the trigger maintains these on review writes,
    // but set them explicitly too so the showcase is right even if the trigger
    // shape ever changes).
    await db.update('listings', '?id=eq.' + listing.id, {
        rating_avg: mean(GUESTS.map((g) => g.overall)), rating_count: GUESTS.length,
        rating_cleanliness: mean(GUESTS.map((g) => g.cats.cleanliness)),
        rating_accuracy: mean(GUESTS.map((g) => g.cats.accuracy)),
        rating_checkin: mean(GUESTS.map((g) => g.cats.checkin)),
        rating_communication: mean(GUESTS.map((g) => g.cats.communication)),
        rating_location: mean(GUESTS.map((g) => g.cats.location)),
        rating_value: mean(GUESTS.map((g) => g.cats.value)),
    });

    console.log('\nDone.');
    console.log('  Listing:   ' + LOCAL_URL + '/homes/' + listing.id);
    console.log('  Host sign-in URL (editor):');
    console.log('    node scripts/_signin-url.mjs ' + HOST.email + ' /edit-listing/' + listing.id);
}

main().catch((e) => { console.error(e); process.exit(1); });
