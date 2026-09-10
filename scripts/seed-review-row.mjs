// A guest experience WAITING FOR REVIEW on the TEST project, fully filled in —
// a priced menu and the written answers — so /admin/providers shows the review
// content block with real content in it (the menu with prices, "from £X", the
// Title, what happens, qualifications, dietary, and the terms acceptance).
//
//   node scripts/seed-review-row.mjs           # seed (or re-seed)
//   node scripts/seed-review-row.mjs --reset   # remove it

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const DOMAIN = 'gallowayreview.test';
const LOGIN_EMAIL = 'aileen@' + DOMAIN;
const LOGIN_PASSWORD = 'review-row-2026';

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')');
    process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
}

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

async function ownerIds() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    return (users || [])
        .filter((u) => String(u.email || '').endsWith('@' + DOMAIN))
        .map((u) => ({ id: u.id, email: u.email }));
}

async function clear() {
    const owners = await ownerIds();
    for (const owner of owners) {
        const providers = await db.select('service_providers', '?owner_id=eq.' + owner.id + '&select=id');
        for (const p of providers) {
            await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_areas', '?provider_id=eq.' + p.id).catch(() => {});
        }
        await db.remove('service_providers', '?owner_id=eq.' + owner.id);
        await db.remove('profiles', '?id=eq.' + owner.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + owner.id);
        console.log('  removed ' + owner.email);
    }
    if (!owners.length) console.log('  nothing to remove');
}

async function seed() {
    const now = new Date();
    const user = await db.auth('POST', '/admin/users', { email: LOGIN_EMAIL, password: LOGIN_PASSWORD, email_confirm: true });
    const owner = user.id;

    await db.rest('POST', '/profiles?on_conflict=id',
        [{ id: owner, email: LOGIN_EMAIL, full_name: 'Aileen Broom', is_host: false }],
        'return=minimal,resolution=merge-duplicates'
    ).catch((e) => console.log('  (profile upsert note: ' + e.message + ')'));

    const [prov] = await db.insert('service_providers', [{
        owner_id: owner,
        // The listing's display name is the Title now.
        business_name: 'Grazing tables & Galloway bakes',
        trade: 'guest',
        audience: 'guest',
        kind: 'external',
        shape: 'made_to_order',
        fulfilment: 'delivery',
        lead_time_days: 2,
        description:
            'Cakes, grazing tables and hampers made to order and delivered around the '
            + 'Stewartry. Everything baked to order from local produce.',
        // Assigned so approval is not blocked on category — the point of this
        // fixture is the content/menu block, not the assign-category flow.
        custom_label: 'Food to order',
        stripe_mcc: '5462',
        provider_name: 'Aileen Broom',
        based_line: 'Kirkcudbright',
        contact_email: LOGIN_EMAIL,
        contact_phone: '01557 555 0184',
        // The written answers live in guest_details (jsonb).
        guest_details: {
            professional_title: 'Home baker and grazing-table maker',
            what_to_expect: 'Order two days ahead and collect from Kirkcudbright, or I’ll drop it to your cottage on the morning.',
            qualifications: 'Level 3 Food Hygiene; ten years baking for weddings and events across Dumfries & Galloway.',
            dietary_options: ['vegetarian', 'gluten_free'],
            years_experience: '10',
        },
        dietary_note: 'Gluten-free with a day’s extra notice; not a nut-free kitchen.',
        // declarations is the terms acceptance store now.
        declarations: { terms_version: 'draft-2026-09-07', terms_agreed_at: now.toISOString() },
        status: 'pending_review',
        submitted_at: now.toISOString(),
        plan: 'commission',
        commission_rate: 0.10,
        updated_at: now.toISOString(),
    }]);

    await db.insert('service_areas', [
        { provider_id: prov.id, label: 'The Stewartry', centre_lat: 54.84, centre_lng: -4.05, radius_miles: 20 },
    ]);

    await db.insert('service_provider_items', [
        { provider_id: prov.id, name: 'Victoria sponge', description: 'Classic sponge, jam and cream', price: 25, unit: 'item', sort_order: 0, active: true },
        { provider_id: prov.id, name: 'Grazing table for 8', description: 'Cheese, charcuterie and Galloway bakes', price: 120, unit: 'item', sort_order: 1, active: true },
        { provider_id: prov.id, name: 'Celebration cake', description: 'Two-tier, decorated to order', price: 85, unit: 'item', sort_order: 2, active: true },
    ]);

    console.log('\n  Seeded "Grazing tables & Galloway bakes" — WAITING FOR REVIEW, fully filled in.');
    console.log('  Walk it: /admin/providers → "Waiting for review" → the content block shows the');
    console.log('  menu (from £25), the Title, what happens, qualifications, dietary and the terms.');
    console.log('  (seed-other-applicant.mjs\'s Rowan row, with no items, shows the red "No price — unbookable" flag.)');
}

console.log(reset ? 'clearing the review-row fixture…' : 'seeding a review-row fixture on ' + TEST_PROJECT_REF + '…');
await clear();
if (!reset) await seed();
console.log('done.');
