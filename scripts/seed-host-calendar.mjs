// Seeds the test project with ONE host listing laid out to show off the
// reworked host calendar: back-to-back Airbnb stays, a one-night gap, a
// two-night gap, an unsellable orphan run, and one of our own (direct)
// bookings — all against a 3-night minimum. Two direct guests: one with a
// profile photo and one without, so the bar's avatar and its initial
// fallback can both be seen.
//
//   node scripts/seed-host-calendar.mjs           seed (resets first)
//   node scripts/seed-host-calendar.mjs --reset    tear down and stop
//
// SITE=… in the environment sets which site the printed login link points at
// (your local dev server, or a Vercel preview URL). The link signs you in as
// the seeded host and lands on /dashboard/calendar. No URL is hardcoded here —
// scripts/target.cjs is the only file allowed to name one.
//
// Its own reserved domain, @gallowaycal.test — see CLAUDE.md. Nothing else may
// live on it; this seed clears only that domain, so it cannot wipe another
// seed's accounts.

import fs from 'fs';
import path from 'path';
import {
    loadEnv, assertTestEnvironment, supabaseClient, dayOffset, ROOT,
} from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);

const db = supabaseClient(env);
const log = (...a) => console.log(...a);

const DOMAIN = 'gallowaycal.test';
const HOST_EMAIL = 'host@' + DOMAIN;
const GUEST_EMAIL = 'guest@' + DOMAIN;
const GUEST2_EMAIL = 'guest2@' + DOMAIN;
// The photo guest's avatar: one of the site's own Galloway photos (never a
// real person's face), uploaded to the test bucket under seed-assets/.
const AVATAR_KEY = 'seed-assets/calendar/guest-avatar.jpg';
const HOST_PASSWORD = 'seed-host-calendar';
// No default: the target-guard test forbids a localhost/preview URL literal in
// any runner. Pass SITE=… to get a ready-made login link; otherwise the login
// path is printed for you to append to whichever site you are viewing.
const SITE = process.env.SITE || '';

/* ------------------------------------------------------------------ reset */

async function reset() {
    log('resetting @' + DOMAIN + ' data…');

    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + DOMAIN));
    if (!seeded.length) { log('  nothing to remove'); return; }

    const inList = '(' + seeded.map((u) => u.id).join(',') + ')';
    const listings = await db.select('listings', '?select=id&host_id=in.' + inList);
    const listingList = listings.length ? '(' + listings.map((l) => l.id).join(',') + ')' : null;

    const bookingFilter = listingList
        ? '?select=id&or=(guest_id.in.' + inList + ',host_id.in.' + inList + ',listing_id.in.' + listingList + ')'
        : '?select=id&or=(guest_id.in.' + inList + ',host_id.in.' + inList + ')';
    const bookings = await db.select('bookings', bookingFilter);

    if (bookings.length) {
        const bookingList = '(' + bookings.map((b) => b.id).join(',') + ')';
        for (const table of ['booking_resolutions', 'booking_change_requests', 'payouts', 'payments', 'booking_guests', 'messages', 'reviews']) {
            await db.remove(table, '?booking_id=in.' + bookingList);
        }
        await db.remove('bookings', '?id=in.' + bookingList);
    }

    if (listingList) {
        for (const table of ['service_orders', 'listing_ical_feeds', 'calendar_overrides', 'listing_access']) {
            await db.remove(table, '?listing_id=in.' + listingList);
        }
    }

    await db.remove('listings', '?host_id=in.' + inList);
    await db.remove('profiles', '?id=in.' + inList);
    for (const u of seeded) await db.auth('DELETE', '/admin/users/' + u.id);

    log('  removed ' + seeded.length + ' user(s) and ' + bookings.length + ' booking(s)');
}

/* ------------------------------------------------------------------ build */

async function uploadAvatar() {
    const bytes = fs.readFileSync(path.join(ROOT, 'public', 'images', 'hero-3-web.jpg'));
    const bucket = env.NEXT_PUBLIC_S3_BUCKET || 'listings';
    const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + AVATAR_KEY, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'image/jpeg',
            'x-upsert': 'true',
        },
        body: bytes,
    });
    if (!res.ok) {
        log('  avatar upload failed (' + res.status + ') — Rhona will show her initial instead');
        return null;
    }
    return AVATAR_KEY;
}

async function createUser(email, fullName, password, profilePatch = {}) {
    const user = await db.auth('POST', '/admin/users', {
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });
    const existing = await db.select('profiles', '?select=id&id=eq.' + user.id);
    const row = { id: user.id, email, full_name: fullName, ...profilePatch };
    if (!existing.length) await db.insert('profiles', row);
    else await db.update('profiles', '?id=eq.' + user.id, profilePatch);
    return { id: user.id, email };
}

async function seed() {
    await reset();
    log('seeding host-calendar listing…');

    const host = await createUser(HOST_EMAIL, 'Seed Calendar Host', HOST_PASSWORD);
    // preferred_name so the direct booking's bar reads a first name (first
    // names only), not the "Guest" fallback a hidden legal name gives.
    const avatar = await uploadAvatar();
    const guest = await createUser(GUEST_EMAIL, 'Rhona Baird', 'seed-guest-calendar', { preferred_name: 'Rhona', avatar_url: avatar });
    // No photo — the bar shows the initial on a soft green circle.
    const guest2 = await createUser(GUEST2_EMAIL, 'Callum Shaw', 'seed-guest-calendar', { preferred_name: 'Callum' });

    const [listing] = await db.insert('listings', {
        host_id: host.id,
        title: 'SEED — Gap-night Cottage',
        description: 'Seeded to demonstrate the reworked host calendar.',
        location: 'Dumfries & Galloway',
        price_per_night: 120,
        weekend_price: 150,
        max_guests: 4,
        status: 'published',
        cancellation_policy: 'Moderate',
        min_nights: 3,
        max_nights: null,
        advance_notice: 'Same day',
        preparation_time: 'None',
        availability_window: '9 months',
        new_listing_promo: false,
        last_minute_discount: false,
        weekly_discount: false,
        monthly_discount: false,
    });

    // Imported Airbnb stays. The url is what platformFromUrl reads for the
    // colour — it never has to resolve. Offsets are from today, so the layout
    // stays valid whenever the seed is run:
    //   +2 → +5   stay O, leaving today and tomorrow (+0,+1) orphaned before it
    //   +7 → +10  stay A ┐ back-to-back (A checks out the day B checks in)
    //   +10 → +13 stay B ┘
    //   +15 → +18 stay C  (a TWO-night gap, +13 & +14, sits before it)
    //   +19 → +22 stay D  (a ONE-night gap, +18, sits before it)
    const airbnbEvents = [
        { start: dayOffset(2), end: dayOffset(5), summary: 'Reserved' },
        { start: dayOffset(7), end: dayOffset(10), summary: 'Reserved' },
        { start: dayOffset(10), end: dayOffset(13), summary: 'Reserved' },
        { start: dayOffset(15), end: dayOffset(18), summary: 'Reserved' },
        { start: dayOffset(19), end: dayOffset(22), summary: 'Reserved' },
    ];

    await db.insert('listing_ical_feeds', {
        listing_id: listing.id,
        url: 'https://www.airbnb.co.uk/calendar/ical/seed-gap-night.ics',
        label: 'Airbnb',
        last_synced_at: new Date().toISOString(),
        last_status: 'ok',
        events: airbnbEvents,
    });

    // One of our own stays, straight after stay D — so the calendar shows a
    // direct (slate) bar meeting an Airbnb bar on the same turnover day.
    await db.insert('bookings', {
        stripe_payment_intent_id: null,
        listing_id: listing.id,
        guest_id: guest.id,
        host_id: host.id,
        check_in: dayOffset(22),
        check_out: dayOffset(25),
        guests: 2,
        adults: 2,
        total_price: 360,
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: 360,
        amount_refunded: 0,
        commission_rate: 10,
        paid_at: new Date().toISOString(),
    });

    // A second direct stay, for a guest with no photo, so the initial
    // fallback sits on the calendar beside Rhona's photo.
    await db.insert('bookings', {
        stripe_payment_intent_id: null,
        listing_id: listing.id,
        guest_id: guest2.id,
        host_id: host.id,
        check_in: dayOffset(26),
        check_out: dayOffset(29),
        guests: 2,
        adults: 2,
        total_price: 360,
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: 360,
        amount_refunded: 0,
        commission_rate: 10,
        paid_at: new Date().toISOString(),
    });

    // A one-time magic link that signs the host in on whichever SITE this was
    // run against, landing on the calendar. The callback PATH carries the token;
    // prefix it with the site you are viewing.
    const link = await db.auth('POST', '/admin/generate_link', { type: 'magiclink', email: HOST_EMAIL });
    const loginPath = link.hashed_token
        ? '/auth/callback?type=magiclink&next=%2Fdashboard%2Fcalendar&token_hash=' + encodeURIComponent(link.hashed_token)
        : '(could not mint a link: ' + JSON.stringify(link).slice(0, 120) + ')';

    log('');
    log('  listing id   : ' + listing.id);
    log('  host login   : ' + HOST_EMAIL + '  /  ' + HOST_PASSWORD);
    log('  calendar path: /dashboard/calendar');
    log('  login link   : ' + (SITE ? SITE + loginPath : loginPath + '   (prefix with your site, or re-run with SITE=…)'));
    log('');
    log('done.');
}

/* ------------------------------------------------------------------- main */

if (process.argv.includes('--reset')) {
    await reset();
} else {
    await seed();
}
