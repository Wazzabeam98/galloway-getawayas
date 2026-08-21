// A finished stay or two on your own account, so the passport has something
// in it.
//
//   node scripts/seed-my-passport.mjs           # create
//   node scripts/seed-my-passport.mjs --reset   # remove it all again
//
// Test project only — it borrows the same guard as the payment seeder.
//
// This is deliberately separate from seed-payments.mjs. That one owns
// everything on @gallowayseed.test and its reset deletes the lot; the account
// here is a real address you sign in with, so it must not be caught up in
// that. Nothing this script makes is on the payment seeder's domain, and
// nothing the payment seeder makes is touched here.
//
// No Stripe, no money. Bookings are written straight in as already paid and
// already over, because the passport only reads dates and status.

import { loadEnv, assertTestEnvironment, supabaseClient, dayOffset } from './seed-lib.mjs';

// Change this if you would rather sign in as the business address.
const GUEST_EMAIL = process.env.PASSPORT_EMAIL || 'liamworrall18@hotmail.com';

// Its own domain so a `seed-payments.mjs --reset` leaves it alone.
const HOST_EMAIL = 'host@gallowaypassport.test';

// The tag every listing here carries, so --reset can find them again.
const TAG = 'PASSPORT SEED';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);

const reset = process.argv.includes('--reset');

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    const users = (page && page.users) || [];
    return users.filter((u) => (u.email || '').toLowerCase() === email.toLowerCase())[0] || null;
}

// Created without a password on purpose. Setting one would mean this script
// knowing a credential for an address you actually use. Give yourself a
// password from the Supabase dashboard instead — Authentication, Users, then
// the three dots next to the row.
async function ensureUser(email) {
    const existing = await findUser(email);
    if (existing) {
        console.log('  already there:', email);
        return existing.id;
    }
    const made = await db.auth('POST', '/admin/users', {
        email: email,
        email_confirm: true,
    });
    console.log('  created:', email);
    return made.id;
}

async function main() {
    if (reset) {
        const guest = await findUser(GUEST_EMAIL);
        const host = await findUser(HOST_EMAIL);

        const listings = await db.select('listings', '?select=id,title&title=like.' + encodeURIComponent(TAG + '%'));
        for (const l of listings) {
            await db.remove('bookings', '?listing_id=eq.' + l.id);
            await db.remove('listings', '?id=eq.' + l.id);
            console.log('  removed listing:', l.title);
        }

        // The guest account itself stays. It is a real address you sign in
        // with, and deleting it would take the sign-in with it.
        if (guest) console.log('  left in place:', GUEST_EMAIL);
        if (host) {
            await db.auth('DELETE', '/admin/users/' + host.id);
            console.log('  removed host:', HOST_EMAIL);
        }
        console.log('Done.');
        return;
    }

    console.log('Accounts');
    const guestId = await ensureUser(GUEST_EMAIL);
    const hostId = await ensureUser(HOST_EMAIL);

    await db.update('profiles', '?id=eq.' + hostId, {
        full_name: 'Kirkcudbright host',
        stripe_payouts_enabled: true,
    });

    console.log('Listing');
    const existing = await db.select(
        'listings',
        '?select=id&title=like.' + encodeURIComponent(TAG + '%')
    );
    for (const l of existing) {
        await db.remove('bookings', '?listing_id=eq.' + l.id);
        await db.remove('listings', '?id=eq.' + l.id);
    }

    // The town is what earns the stamp — the passport groups by whatever
    // townOf() pulls out of `location`.
    const [listing] = await db.insert('listings', [{
        host_id: hostId,
        title: TAG + ' — Harbour cottage',
        location: 'Kirkcudbright, Dumfries and Galloway',
        price_per_night: 120,
        status: 'published',
        max_guests: 4,
        bedrooms: 2,
        beds: 2,
        bathrooms: 1,
        description: 'Seeded so the passport has a stamp in it.',
    }]);
    console.log('  ' + listing.title);

    // Two separate visits to the same town: one stamp, two visits, the nights
    // added up. Non-overlapping, or the no-double-booking constraint refuses
    // the second one.
    const stays = [
        { in: dayOffset(-120), out: dayOffset(-114) },  // 6 nights
        { in: dayOffset(-40), out: dayOffset(-37) },    // 3 nights
    ];

    console.log('Stays');
    for (const s of stays) {
        const nights = Math.round((new Date(s.out) - new Date(s.in)) / 86400000);
        const total = nights * 120;
        await db.insert('bookings', [{
            listing_id: listing.id,
            guest_id: guestId,
            host_id: hostId,
            check_in: s.in,
            check_out: s.out,
            guests: 2,
            adults: 2,
            total_price: total,
            status: 'confirmed',
            payment_status: 'paid',
            amount_paid: total,
            confirmed_at: new Date().toISOString(),
            paid_at: new Date().toISOString(),
        }]);
        console.log('  ' + s.in + ' → ' + s.out + '  (' + nights + ' nights, £' + total + ')');
    }

    console.log('');
    console.log('Sign in as ' + GUEST_EMAIL + '.');
    console.log('It has no password yet — set one in the Supabase dashboard,');
    console.log('Authentication → Users → the row → Reset password.');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
