// Seed realistic reviews for the demo cottages AND the demo experiences, so the
// cards and listings show real ratings rather than everything reading "New".
//
// TEST ONLY. Idempotent — clears its own reviewers' bookings/orders (reviews
// cascade) and rebuilds. Requires the guest_to_provider schema (merged in from
// feat/experience-reviews).
//
//   node scripts/demo-reviews.mjs
//
// The spread is deliberate: some places with several reviews, some with one or
// two, a couple with none — so the empty ("New") case still shows.
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv('.env.local');
assertTestEnvironment(env);
const db = supabaseClient(env);
const DOMAIN = 'gg-demo-review.test';
const PW = 'demo-review-2026';

const REVIEWERS = [
    ['Ailsa', 'Fraser'], ['Callum', 'Reid'], ['Morag', 'Bell'], ['Struan', 'Kerr'],
    ['Eilidh', 'Hunter'], ['Rory', 'Mackay'], ['Fiona', 'Grant'], ['Hamish', 'Ross'],
    ['Isla', 'Wallace'], ['Niamh', 'Docherty'], ['Gregor', 'Sinclair'], ['Catriona', 'Muir'],
];

// How many reviews each demo cottage / experience gets — a spread, two zeros each.
const COTTAGE_SPREAD = { anchorage: 7, deeview: 4, shore: 5, steading: 3, bracken: 2, kirkbrae: 1, herons: 0, harbour: 0 };
const EXP_SPREAD = [6, 4, 5, 2, 3, 1, 0, 0];

const COTTAGE_COMMENTS = [
    'A really special week — the cottage was spotless and the welcome basket was a lovely touch.',
    'Beautifully kept, exactly as described, and the host answered every question within minutes.',
    'Cosy, warm and in a perfect spot for walks. We didn’t want to leave.',
    'Lovely place, comfortable beds and a well-equipped kitchen. Would happily come back.',
    'Great base for exploring the coast. Parking was easy and check-in couldn’t have been simpler.',
    'The wood burner made the evenings. Immaculate throughout and dog-friendly too.',
    'Quiet, characterful and spotlessly clean. The directions got us to the door with no fuss.',
    'A gem. Everything worked, everything was clean, and the views were even better in person.',
    'Comfortable and well cared for. A couple of the kitchen bits were tired but nothing major.',
    'Good value and a lovely host. The hot tub was the highlight of the trip.',
];
const EXP_COMMENTS = [
    'Absolutely brilliant — professional, friendly and a real highlight of our stay.',
    'Exceeded every expectation. Would recommend to anyone visiting the area.',
    'So good. Easy to book, turned up on time, and clearly knew their craft.',
    'A lovely couple of hours and worth every penny. Thank you!',
    'Great fun and beautifully done. We’ve already told friends about it.',
    'Relaxed, welcoming and genuinely memorable. Five stars.',
    'Really enjoyable. A tiny bit rushed at the end but we’d still book again.',
    'Perfect for a special occasion — thoughtful from start to finish.',
];

const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
const pick = (arr, i) => arr[i % arr.length];
// Mostly 4–5, the occasional 3 — never invented perfection everywhere.
const ratingFor = (i) => (i % 7 === 3 ? 3 : i % 3 === 0 ? 4 : 5);

async function findUser(email) {
    for (let page = 1; page <= 10; page++) {
        const r = await db.auth('GET', '/admin/users?page=' + page + '&per_page=200');
        const u = (r.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
        if (u) return u;
        if (!r.users || r.users.length < 200) break;
    }
    return null;
}
async function ensureReviewer(idx) {
    const [first, last] = REVIEWERS[idx];
    const email = 'r' + idx + '@' + DOMAIN;
    let u = await findUser(email);
    if (!u) u = await db.auth('POST', '/admin/users', { email, password: PW, email_confirm: true });
    await db.rest('POST', '/profiles?on_conflict=id', [{ id: u.id, email, full_name: first + ' ' + last, is_host: false }], 'resolution=merge-duplicates');
    return { id: u.id, first };
}

async function run() {
    // Reviewers
    const reviewers = [];
    for (let i = 0; i < REVIEWERS.length; i++) reviewers.push(await ensureReviewer(i));

    // Clean prior demo reviews: deleting these reviewers' bookings + orders
    // cascades their reviews, and the rating triggers recompute to "New".
    for (const rv of reviewers) {
        await db.remove('service_orders', `?guest_id=eq.${rv.id}`).catch(() => {});
        await db.remove('bookings', `?guest_id=eq.${rv.id}`).catch(() => {});
    }

    // Templates + demo rows
    const [tmplB] = await db.select('bookings', '?select=*&limit=1');
    const cottages = await db.select('listings', '?select=id,title,host_id,images&status=eq.published');
    const demoCots = (cottages || []).filter((l) => (l.images || []).some((k) => String(k).startsWith('demo/cottage-')))
        .map((l) => ({ ...l, slug: (l.images.find((k) => String(k).startsWith('demo/cottage-')) || '').replace('demo/cottage-', '').replace('.jpg', '') }));

    const providers = await db.select('service_providers', "?select=id,business_name,owner_id&audience=in.(guest,both)&status=eq.approved&stripe_payouts_enabled=eq.true&order=business_name.asc");

    let ci = 0; // rolling index for variety
    console.log('— Cottage reviews (guest_to_host) —');
    for (const cot of demoCots) {
        const n = COTTAGE_SPREAD[cot.slug] ?? 0;
        for (let k = 0; k < n; k++, ci++) {
            const rv = pick(reviewers, ci);
            // A recent past stay: checkout within the last 14 days (the review
            // window the trigger enforces). One night each, spaced two days
            // apart, so several on one cottage never overlap (the DB forbids
            // overlapping confirmed stays) and all still land inside 14 days.
            const co = -(2 + k * 2);
            const [booking] = await db.insert('bookings', [{
                ...tmplB, id: undefined, created_at: undefined, updated_at: undefined,
                guest_id: rv.id, host_id: cot.host_id, listing_id: cot.id,
                check_in: dayOffset(co - 1), check_out: dayOffset(co),
                guests: 2, adults: 2, children: 0, pets: 0,
                status: 'confirmed', payment_status: 'paid', amount_paid: 0, amount_refunded: 0,
                total_price: 0, balance_amount: 0, stripe_payment_intent_id: null,
            }]);
            const cat = () => Math.max(3, Math.min(5, ratingFor(ci) + (Math.random() < 0.3 ? -1 : 0)));
            const [rev] = await db.insert('reviews', [{
                booking_id: booking.id, listing_id: cot.id, reviewer_id: rv.id, reviewee_id: cot.host_id,
                review_type: 'guest_to_host', rating: ratingFor(ci), comment: pick(COTTAGE_COMMENTS, ci),
                cleanliness_rating: cat(), accuracy_rating: cat(), checkin_rating: cat(),
                communication_rating: cat(), location_rating: cat(), value_rating: cat(),
            }]);
            // Publish it (service role): the double-blind hold and the 14-day
            // cron don't apply to a demo, and only published reviews count.
            await db.update('reviews', `?id=eq.${rev.id}`, { is_published: true, published_at: new Date().toISOString() });
        }
        console.log(`  ${cot.title}: ${n}`);
    }

    console.log('— Experience reviews (guest_to_provider) —');
    for (let p = 0; p < (providers || []).length; p++) {
        const prov = providers[p];
        const n = EXP_SPREAD[p] ?? 0;
        for (let k = 0; k < n; k++, ci++) {
            const rv = pick(reviewers, ci + 5);
            const [order] = await db.insert('service_orders', [{
                provider_id: prov.id, guest_id: rv.id, trade: 'guest',
                service_date: dayOffset(-(3 + (k % 20))), price: 40, quantity: 1, status: 'confirmed',
                provider_business_name: prov.business_name, item_name: 'Experience',
            }]);
            // The trigger fills provider_id / reviewee_id and publishes on submit.
            await db.insert('reviews', [{
                order_id: order.id, reviewer_id: rv.id, review_type: 'guest_to_provider',
                rating: ratingFor(ci), comment: pick(EXP_COMMENTS, ci),
            }]);
        }
        console.log(`  ${prov.business_name}: ${n}`);
    }

    console.log('\nDone. Read back:');
    const rb = await db.select('listings', '?select=title,rating_avg,rating_count&status=eq.published&order=rating_count.desc&limit=8');
    (rb || []).forEach((l) => console.log(`  ${l.title}: ${l.rating_avg ?? '—'} (${l.rating_count})`));
}

run().catch((e) => { console.error(e); process.exit(1); });
