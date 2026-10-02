// Proof: a HIDDEN review must not count towards a listing's stored rating.
// TEST only, re-runnable. Rows are read back from the database, not a screen.
//
// THE BUG THIS PINS. `refresh_listing_ratings` (the function the reviews trigger
// runs on every insert/update/delete) averaged and counted every review with
// `is_published = true` and said nothing about `hidden_at`. An admin takedown
// sets `hidden_at` (see app/api/admin/reviews/hide) and leaves `is_published`
// alone, so a hidden review kept counting: the stored `rating_avg` and
// `rating_count` — the numbers the cards and the listing page show — still
// included a review no visitor could see. `reviews.length`, read under RLS,
// excluded it, which is how the three sources came to disagree.
//
// WHAT THIS PROVES, against the real trigger:
//   - two published reviews (5 and 3) give rating_count = 2, rating_avg = 4.00;
//   - hiding the 3 must drop it to rating_count = 1, rating_avg = 5.00;
//   - un-hiding it must restore rating_count = 2, rating_avg = 4.00.
// The hide step is the one that FAILS before the migration
// (20260925xxxxxx_ratings_exclude_hidden_reviews.sql) and passes after it, with
// no route change: the AFTER-UPDATE trigger already re-runs on hide and unhide,
// so fixing the function's WHERE is the whole fix.
//
// Run: node scripts/prove-hidden-reviews-excluded.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);

const tag = 'hidden-rev-' + Date.now();
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

const client = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL });
const q = (sql, params) => client.query(sql, params);

// The review window trigger needs a stay that finished within the last 14 days.
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

async function ratings(listingId) {
    const r = await q('select rating_avg, rating_count from public.listings where id = $1', [listingId]);
    return { avg: r.rows[0].rating_avg === null ? null : Number(r.rows[0].rating_avg), count: r.rows[0].rating_count };
}

async function main() {
    await client.connect();

    // Two existing seeded profiles stand in for a host and a guest, so nothing
    // has to be minted in auth.users. They are only referenced, never changed.
    const people = await q('select id from public.profiles limit 2');
    if (people.rows.length < 2) throw new Error('need two profiles seeded on test — run `npm run scenarios` first');
    const hostId = people.rows[0].id;
    const guestId = people.rows[1].id;

    // A listing, and two finished bookings to anchor the two reviews. The title
    // carries the tag so cleanup (and any earlier crashed run) can find it.
    const listing = await q(
        `insert into public.listings (host_id, title, location, price_per_night, status)
         values ($1, $2, 'Kirkcudbright, Dumfries and Galloway', 120, 'published') returning id`,
        [hostId, `PROOF ${tag}`],
    );
    const listingId = listing.rows[0].id;

    async function booking(fromN, toN) {
        const r = await q(
            `insert into public.bookings (listing_id, guest_id, host_id, check_in, check_out, total_price, status)
             values ($1, $2, $3, $4, $5, 240, 'completed') returning id`,
            [listingId, guestId, hostId, daysAgo(fromN), daysAgo(toN)],
        );
        return r.rows[0].id;
    }
    const b1 = await booking(8, 6);
    const b2 = await booking(4, 2);

    async function review(bookingId, rating) {
        const cat = Math.round(rating); // the category columns are integer(1..5)
        const r = await q(
            `insert into public.reviews
               (booking_id, listing_id, reviewer_id, reviewee_id, review_type, rating, comment,
                cleanliness_rating, accuracy_rating, checkin_rating, communication_rating, location_rating, value_rating,
                is_published, published_at)
             values ($1,$2,$3,$4,'guest_to_host',$5,$6,$7,$7,$7,$7,$7,$7,true, now()) returning id`,
            [bookingId, listingId, guestId, hostId, rating, `proof ${tag}`, cat],
        );
        return r.rows[0].id;
    }
    const r1 = await review(b1, 5);
    const r2 = await review(b2, 3);

    // --- baseline: both published ---
    let s = await ratings(listingId);
    check(s.count === 2 && s.avg === 4, `baseline — two published reviews give count 2, avg 4.00 (got count ${s.count}, avg ${s.avg})`);

    // --- hide the 3-star: this is the assertion that fails before the migration ---
    await q('update public.reviews set hidden_at = now() where id = $1', [r2]);
    s = await ratings(listingId);
    check(s.count === 1 && s.avg === 5, `after HIDING the 3-star — count must drop to 1 and avg rise to 5.00 (got count ${s.count}, avg ${s.avg})`);

    // --- un-hide: the count and average must come back ---
    await q('update public.reviews set hidden_at = null where id = $1', [r2]);
    s = await ratings(listingId);
    check(s.count === 2 && s.avg === 4, `after UN-HIDING — count restored to 2, avg back to 4.00 (got count ${s.count}, avg ${s.avg})`);

    // --- cleanup: children before parents, and sweep anything a crashed
    //     earlier run left behind (all proof listings share the title prefix) ---
    const proofListings = `select id from public.listings where title like 'PROOF hidden-rev-%'`;
    await q(`delete from public.reviews where listing_id in (${proofListings})`);
    await q(`delete from public.bookings where listing_id in (${proofListings})`);
    await q(`delete from public.listings where title like 'PROOF hidden-rev-%'`);

    await client.end();

    console.log('');
    if (failed) {
        console.log(`${failed} check(s) failed — a hidden review is still counting in the stored rating.`);
        process.exit(1);
    }
    console.log('All checks passed — hidden reviews are excluded from rating_avg and rating_count.');
}

main().catch(async (e) => {
    try { await client.end(); } catch {}
    console.error(e);
    process.exit(1);
});
