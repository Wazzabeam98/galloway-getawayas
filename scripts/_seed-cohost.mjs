// A co-host on Liam's WALKTHROUGH stay, for walking the host reservation page as
// somebody who is NOT the owner. The grant is deliberately partial: can_bookings
// and can_messages, but NOT can_listing (so the door code stays hidden) and NOT
// can_earnings (so the money card stays hidden). That is the exact persona the
// host-reservation walk needs.
//
//   node scripts/_seed-cohost.mjs          # create/refresh the co-host + grant
//   node scripts/_seed-cohost.mjs --reset  # remove the grant and the test user
//
// TEST PROJECT ONLY — seed-lib refuses any other database.

import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const OWNER = 'liamworrall18@hotmail.com';
const COHOST = 'cohost.hostres@gallowaygetaways.co.uk';
const PW = 'walkthrough-cohost-1997';

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function main() {
    const owner = await findUser(OWNER);
    if (!owner) { console.error('No test account for ' + OWNER + '.'); process.exit(1); }

    const listings = await db.select('listings', '?host_id=eq.' + owner.id + '&title=like.WALKTHROUGH*&select=id,title&order=id.asc');
    if (!listings || !listings.length) { console.error('Owner hosts no WALKTHROUGH listings on test.'); process.exit(1); }
    const listing = listings[0];

    let cohost = await findUser(COHOST);

    if (reset) {
        if (cohost) {
            await db.remove('listing_access', '?user_id=eq.' + cohost.id);
            await db.remove('profiles', '?id=eq.' + cohost.id).catch(() => {});
            await db.auth('DELETE', '/admin/users/' + cohost.id).catch(() => {});
        }
        console.log('Removed the co-host and its grant.');
        return;
    }

    if (!cohost) {
        const made = await db.auth('POST', '/admin/users', { email: COHOST, password: PW, email_confirm: true });
        cohost = { id: made.id, email: COHOST };
    }

    // A profile so the app has a name for them (the reservation page reads the
    // owner's profile, not the co-host's, but other screens want one).
    await db.insert('profiles', [{ id: cohost.id, full_name: 'Sam Fairley', preferred_name: 'Sam', show_full_name: true }])
        .catch(async () => { await db.update('profiles', '?id=eq.' + cohost.id, { full_name: 'Sam Fairley', preferred_name: 'Sam' }).catch(() => {}); });

    // The grant. Fresh each run: delete any existing row for this pair, then
    // insert the partial permission set.
    await db.remove('listing_access', '?listing_id=eq.' + listing.id + '&user_id=eq.' + cohost.id);
    await db.insert('listing_access', [{
        listing_id: listing.id,
        user_id: cohost.id,
        email: COHOST,
        role: 'co_host',
        status: 'active',
        can_calendar: true,
        can_messages: true,
        can_bookings: true,
        can_listing: false,
        can_earnings: false,
    }]);

    console.log('Co-host ready on "' + listing.title + '"');
    console.log('  listing id : ' + listing.id);
    console.log('  co-host    : ' + COHOST + '  (id ' + cohost.id + ')');
    console.log('  grant      : can_bookings + can_messages; NOT can_listing, NOT can_earnings');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
