// A "something else" applicant on the TEST project, waiting for review, so the
// assign-category flow can be walked by hand.
//
// This is the counterpart to seed-chef.mjs. The chef is already through the
// gate (approved, payouts on, bookable). THIS one is deliberately stopped at
// the first gate: trade 'other', status pending_review, and NO category
// assigned. That is the whole point — in /admin/providers it shows in "Waiting
// for review" with the "Payout category" panel, and Approve is greyed until you
// read what they described, pick a Stripe code and type the word a guest reads.
//
// No Stripe here on purpose: an "other" applicant cannot even reach onboarding
// until you have categorised them, so there is nothing to connect yet. That is
// why the guard is the narrow one (database only), like the walkthrough plumbers
// rather than the chef.
//
//   node scripts/seed-other-applicant.mjs           # seed (or re-seed) the applicant
//   node scripts/seed-other-applicant.mjs --reset   # remove it and stop

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const OTHER_DOMAIN = 'gallowayother.test';
const LOGIN_EMAIL = 'rowan@' + OTHER_DOMAIN;
const LOGIN_PASSWORD = 'other-walkthrough-2026';

const env = loadEnv();

// Database only — no Stripe key demanded, because this fixture never touches
// Stripe (that is the gate it is stopped before).
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
        .filter((u) => String(u.email || '').endsWith('@' + OTHER_DOMAIN))
        .map((u) => ({ id: u.id, email: u.email }));
}

async function clear() {
    const owners = await ownerIds();

    for (const owner of owners) {
        const providers = await db.select('service_providers', '?owner_id=eq.' + owner.id + '&select=id');
        for (const p of providers) {
            await db.remove('service_orders', '?provider_id=eq.' + p.id).catch(() => {});
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

    const user = await db.auth('POST', '/admin/users', {
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
        email_confirm: true,
    });
    const owner = user.id;

    await db.rest(
        'POST', '/profiles?on_conflict=id',
        [{ id: owner, email: LOGIN_EMAIL, full_name: 'Rowan Kerr', is_host: false }],
        'return=minimal,resolution=merge-duplicates'
    ).catch((e) => console.log('  (profile upsert note: ' + e.message + ')'));

    // Trade 'other', pending review, and NO stripe_mcc / custom_label — so the
    // category blocker holds approval until you assign one. A wellbeing business
    // is a good demo: it is genuinely not on the list, and it maps cleanly to
    // 7299 (personal services), the first code in ASSIGNABLE_MCCS.
    const [prov] = await db.insert('service_providers', [{
        owner_id: owner,
        business_name: 'Rowan Therapies',
        trade: 'other',
        audience: 'guest',
        kind: 'external',
        description:
            'Mobile massage and sound-bath sessions, in the cottage where you are staying. '
            + 'Sports and deep-tissue massage, or an hour’s guided relaxation with singing bowls. '
            + 'Not a spa, not a therapist in the clinical sense — just an unwind after a long walk.',
        experience_price: 60,

        provider_name: 'Rowan Kerr',
        based_line: 'Gatehouse of Fleet · massage since 2018',
        about:
            'I qualified in sports and remedial massage in Glasgow and moved back to Galloway a '
            + 'few years ago. I work out of my own place and travel to cottages nearby. It is '
            + 'just me — I bring the table, the oils and the bowls.',
        what_to_expect:
            'Tell me about injuries or anything sore when you book. I bring my own table and '
            + 'everything else; you just need a bit of floor space. If you need to move the time '
            + 'or cancel, a day’s notice and there is nothing to pay.',

        contact_email: LOGIN_EMAIL,
        contact_phone: '01557 555 0161',

        status: 'pending_review',
        submitted_at: now.toISOString(),
        plan: 'commission',
        commission_rate: 0.10,
        updated_at: now.toISOString(),
    }]);

    await db.insert('service_areas', [{
        provider_id: prov.id,
        label: 'Gatehouse of Fleet and 20 miles',
        centre_lat: 54.8810,
        centre_lng: -4.2060,
        radius_miles: 20,
    }]);

    console.log('');
    console.log('  Rowan Therapies — trade "other", WAITING FOR REVIEW, no category assigned');
    console.log('  walk it: /admin/providers → "Waiting for review" → Payout category panel');
    console.log('    - Approve is greyed until you assign a category');
    console.log('    - type the guest word (e.g. "Massage & wellbeing") and pick a Stripe code');
    console.log('      (7299 — personal services fits), then Approve un-greys');
    console.log('');
    console.log('  LOGIN (to see the applicant’s own side)');
    console.log('    email     ' + LOGIN_EMAIL);
    console.log('    password  ' + LOGIN_PASSWORD);
    console.log('    open /services/join?trade=other — the "with us, we’ll be in touch" panel shows');
}

console.log(reset ? 'clearing the "other" applicant…' : 'seeding an "other" applicant on ' + TEST_PROJECT_REF + '…');
await clear();
if (!reset) await seed();
console.log('done.');
