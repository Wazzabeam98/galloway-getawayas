// DEMO ONLY — a brand-new host, the way they are the day after finishing the
// become-a-host wizard: one cottage, just approved, the wizard's fields filled
// and nothing else (no sleeping arrangements, no licence, no safety
// disclosures, no arrival details). For walking the rebuilt listing editor as a
// new host would meet it.
//
// TEST PROJECT ONLY (seed-lib refuses a non-test service key).
//
//   node scripts/_seed-new-host.mjs          # create / refresh (resets the listing)
//   node scripts/_seed-new-host.mjs --reset  # remove everything it made
//
// Its own domain, @gallowaynewhost.test, per CLAUDE.md — nothing else may live
// there, and it clears only the one account it owns. Sign in with a minted
// link (no inbox at .test):
//   SITE=<preview url> EMAIL=newhost@gallowaynewhost.test NEXT=/dashboard node scripts/_login-url.mjs

import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const EMAIL = 'newhost@gallowaynewhost.test';
const TITLE = 'Harbour Cottage, Kippford';
const AGREEMENT_VERSION = 'v1-2026-10-03';

async function findUser(email) {
    for (let page = 1; page <= 10; page++) {
        const r = await db.auth('GET', '/admin/users?page=' + page + '&per_page=200');
        const u = (r.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
        if (u) return u;
        if (!r.users || r.users.length < 200) break;
    }
    return null;
}

async function cleanup() {
    const u = await findUser(EMAIL);
    if (!u) return;
    await db.remove('listings', '?host_id=eq.' + u.id).catch(() => {});
    await db.remove('agreement_acceptances', '?user_id=eq.' + u.id).catch(() => {});
    await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
}

async function main() {
    await cleanup();
    if (reset) {
        console.log('Removed the new-host account and its listing.');
        return;
    }

    const made = await db.auth('POST', '/admin/users', { email: EMAIL, email_confirm: true });
    const hostId = made.id;

    await db.rest('POST', '/profiles?on_conflict=id', [{
        id: hostId, email: EMAIL, full_name: 'Morag Laing', preferred_name: 'Morag',
        show_full_name: false, host_terms_version: AGREEMENT_VERSION,
    }], 'resolution=merge-duplicates');

    // Accepted at the end of the wizard, as a real new host would have — so the
    // agreement gate does not stand in front of the editor.
    await db.insert('agreement_acceptances', [
        { user_id: hostId, document: 'guest', version: AGREEMENT_VERSION },
        { user_id: hostId, document: 'host', version: AGREEMENT_VERSION },
    ]);

    // Photos borrowed from a listing that has some, so the editor and the page
    // are not empty.
    const withImages = await db.select('listings', '?select=images&images=not.is.null&order=created_at.desc&limit=20');
    const images = ((withImages.find((l) => Array.isArray(l.images) && l.images.length >= 5) || {}).images || []).slice(0, 6);

    const [listing] = await db.insert('listings', [{
        host_id: hostId,
        title: TITLE,
        description:
            'A whitewashed cottage on the front at Kippford, looking straight out over the Urr estuary. ' +
            'Two bedrooms, a wood burner and a garden that runs down to the shore path.',
        location: 'Kippford, Dumfries and Galloway',
        street_address: '3 Shore Row', postcode: 'DG5 4LN',
        latitude: 54.876, longitude: -3.812,
        price_per_night: 120, max_guests: 4, bedrooms: 2, beds: 2, bathrooms: 1,
        property_type: 'Cottages', privacy_type: 'Entire place',
        amenities: ['Wifi', 'Kitchen', 'Heating', 'Washing machine', 'Free parking on premises', 'Indoor fireplace', 'Smoke alarm'],
        images,
        check_in_method: 'Lockbox', check_in_time: '16:00', check_out_time: '10:00',
        cancellation_policy: 'Moderate',
        instant_book: false,
        status: 'published',
        approved_at: new Date().toISOString(),
    }]);
    console.log('  ✓ new host ' + EMAIL + ' (' + hostId + ')');
    console.log('  ✓ listing ' + listing.id + ' — ' + TITLE);
}

main().catch((e) => { console.error(e); process.exit(1); });
