// A host and one listing for walking the listing editor (feat/listing-editor-tidy).
// Test project only (guarded). Own domain: @gallowayeditor.test.
//   node scripts/_seed-editor-walk.mjs          # create / rebuild
//   node scripts/_seed-editor-walk.mjs --reset  # remove
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);

const HOST_EMAIL = 'editor-walk@gallowayeditor.test';
const HOST_PW = 'EditorWalk2026!';
const TAG = 'EDITOR WALK';
const reset = process.argv.includes('--reset');

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email) || null;
}

async function wipe() {
    const listings = await db.select('listings', '?select=id&title=like.' + encodeURIComponent(TAG + '%'));
    for (const l of listings) {
        await db.remove('listing_arrival', '?listing_id=eq.' + l.id);
        await db.remove('listings', '?id=eq.' + l.id);
    }
}

async function main() {
    await wipe();
    const existing = await findUser(HOST_EMAIL);
    if (reset) {
        if (existing) await db.auth('DELETE', '/admin/users/' + existing.id);
        console.log('reset done');
        return;
    }
    const hostId = existing
        ? (await db.auth('PUT', '/admin/users/' + existing.id, { password: HOST_PW, email_confirm: true }), existing.id)
        : (await db.auth('POST', '/admin/users', { email: HOST_EMAIL, password: HOST_PW, email_confirm: true })).id;
    const now = new Date().toISOString();
    const version = 'v1-2026-10-03';
    await db.update('profiles', '?id=eq.' + hostId, { full_name: 'Morag', host_terms_version: version, host_terms_agreed_at: now });
    // Agreements already on record, so the walk starts in the editor, not on the agreement prompt.
    await db.remove('agreement_acceptances', '?user_id=eq.' + hostId);
    await db.insert('agreement_acceptances', ['host', 'guest'].map((document) => ({ user_id: hostId, document, version, accepted_at: now, source: 'seed' })));

    // Borrow real photos from a published TEST listing so rooms can show one.
    const donors = await db.select('listings', '?select=images&status=eq.published&images=neq.%7B%7D&limit=50');
    const donor = donors.sort((a, b) => b.images.length - a.images.length)[0];
    const images = ((donor && donor.images) || []).slice(0, 6);

    const [listing] = await db.insert('listings', [{
        host_id: hostId,
        title: TAG + ' — Harbour Townhouse',
        description: 'A listing for walking the editor.',
        location: 'Kirkcudbright, Dumfries and Galloway',
        street_address: '18 Dovecroft',
        postcode: 'DG6 4HY',
        price_per_night: 140, status: 'published', max_guests: 6,
        property_type: 'Townhouses', privacy_type: 'Entire place',
        bedrooms: 3, beds: 4, bathrooms: 2,
        sleeping_arrangements: [
            { label: 'Bedroom 1', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }], photo: images[1] || null },
            { label: 'Bedroom 2', kind: 'bedroom', beds: [{ type: 'Double bed', count: 1 }], photo: images[2] || null },
            { label: 'Bedroom 3', kind: 'bedroom', beds: [{ type: 'Single bed', count: 1 }] },
            { label: 'Living room', kind: 'common', beds: [{ type: 'Sofa bed', count: 1 }] },
        ],
        images,
        amenities: ['Wifi', 'Kitchen', 'Heating'],
        check_in_method: 'Lockbox',
        cancellation_policy: 'Moderate',
        check_in_time: '15:00:00', check_out_time: '11:00:00',
    }]);
    await db.insert('listing_arrival', [{ listing_id: listing.id, parking_info: 'Space for one car outside.' }]);
    console.log('host', HOST_EMAIL, '| listing', listing.id);
}

main().catch((e) => { console.error(e); process.exit(1); });
