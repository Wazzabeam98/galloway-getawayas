// A host and one listing for walking the listing editor, plus a gardener and a
// window cleaner to enquire with (the garden / window question).
// Test project only (guarded). Own domain: @gallowayeditor.test.
//   node scripts/_seed-editor-walk.mjs          # create / rebuild
//   node scripts/_seed-editor-walk.mjs --reset  # remove
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';
import { createRequire } from 'node:module';
// Door codes and wifi passwords are stored sealed (lib/secretBox); so are these.
const { sealSecret } = createRequire(import.meta.url)('./secretBox.cjs');

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

// Approved, subscription-plan trades on this seed's own domain.
const TRADES = [
    { email: 'editor-gardener@gallowayeditor.test', name: 'Callum', business_name: 'Kirkcudbright Gardens', trade: 'trees' },
    { email: 'editor-windows@gallowayeditor.test', name: 'Isla', business_name: 'Solway Window Cleaning', trade: 'droplet' },
];

async function wipeTrades() {
    for (const t of TRADES) {
        const u = await findUser(t.email);
        if (!u) continue;
        const providers = await db.select('service_providers', '?select=id&owner_id=eq.' + u.id);
        for (const p of providers) {
            await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
            await db.remove('service_areas', '?provider_id=eq.' + p.id);
            await db.remove('service_providers', '?id=eq.' + p.id);
        }
        await db.remove('agreement_acceptances', '?user_id=eq.' + u.id);
        await db.auth('DELETE', '/admin/users/' + u.id);
    }
}

async function seedTrades(now) {
    for (const t of TRADES) {
        const made = await db.auth('POST', '/admin/users', { email: t.email, password: HOST_PW, email_confirm: true });
        const owner = made.id;
        await db.update('profiles', '?id=eq.' + owner, { full_name: t.name, email: t.email });
        const [provider] = await db.insert('service_providers', [{
            owner_id: owner, business_name: t.business_name, trade: t.trade, audience: 'host', kind: 'external',
            description: 'A seeded trade for walking the enquiry form.', contact_email: t.email, contact_phone: '01557 555 0100',
            status: 'approved', approved_at: now, plan: 'subscription', commission_rate: 0,
            trial_ends_at: new Date(Date.now() + 180 * 86400000).toISOString(),
            callout_waived: true, does_scheduled: true, declarations: {},
        }]);
        await db.insert('service_areas', [{ provider_id: provider.id, label: 'The Stewartry', centre_lat: 0, centre_lng: 0, radius_miles: 0 }]);
        await db.insert('agreement_acceptances', [['tradesperson', 'v1-2026-10-03'], ['guest', 'v2-2026-10-08']].map(([document, version]) => ({ user_id: owner, document, version, accepted_at: now, source: 'seed' })));
    }
}

async function wipe() {
    // The walk listing, plus any draft a wizard walk left on this host.
    const host = await findUser(HOST_EMAIL);
    const listings = [
        ...(await db.select('listings', '?select=id&title=like.' + encodeURIComponent(TAG + '%'))),
        ...(host ? await db.select('listings', '?select=id&status=eq.draft&host_id=eq.' + host.id) : []),
    ];
    for (const l of listings) {
        // Test bookings made on the walk listing (its own TEST data only).
        await db.remove('bookings', '?listing_id=eq.' + l.id);
        await db.remove('listing_arrival', '?listing_id=eq.' + l.id);
        await db.remove('listings', '?id=eq.' + l.id);
    }
}

async function main() {
    await wipe();
    await wipeTrades();
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
    const version = 'v2-2026-10-08'; // host and guest, as in lib/agreements.ts
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
        street_address: '57 St Cuthbert Street',
        postcode: 'DG6 4DX',
        // A real pin in Kirkcudbright, for the editor's Location map.
        latitude: 54.83756, longitude: -4.04883,
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
        amenities: ['Wifi', 'Kitchen', 'Heating', 'Free parking on premises'],
        check_in_method: 'Lockbox',
        cancellation_policy: 'Moderate',
        check_in_time: '15:00:00', check_in_end_time: '20:00:00', check_out_time: '11:00:00',
        // Answered in the old editor: the enquiry form starts from it.
        plot_band: 'plot_garden',
    }]);
    await db.insert('listing_arrival', [{
        listing_id: listing.id, parking_info: 'Space for one car outside.',
        wifi_name: 'HarbourTownhouse', wifi_password: sealSecret('walk-the-wifi', 'listing_arrival', listing.id, env), what3words: '///harbour.candle.brave',
    }]);
    await seedTrades(now);
    console.log('host', HOST_EMAIL, '| listing', listing.id);
}

main().catch((e) => { console.error(e); process.exit(1); });
