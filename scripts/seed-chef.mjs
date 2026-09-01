// A chef on the TEST project, so the guest-experience flow can be walked by
// hand — the guest side of what the plumber walkthrough is for the host side.
//
// WHY A CHEF NEEDS MORE THAN THE PLUMBER DID
//
// The plumber is a HOST trade: approved is the whole of it, no money moves
// through us, "you're listed" and done. A chef is a GUEST trade — a guest pays
// through the platform, 10% on our side — so "approved" is only the first gate.
// The second is Stripe payouts: until the connected account can receive money,
// the chef is approved-but-not-bookable and shows to no guest. So this seeder
// does what the plumber one never had to: it stands up a real test-mode Connect
// account with the chef's own category (MCC 5811, caterers — never lodging) and
// waits for payouts to enable, then writes it onto the row.
//
// It also fills in the "who they are" fields the guest listing now carries — a
// guest is choosing someone to come into the cottage they are staying in, so
// the profile is a person, not just a price.
//
// LOGIN. Unlike the walkthrough plumbers (whose password is thrown away because
// their side arrives by email), this makes a login you can actually use: a
// known password, printed at the end. Sign in at /services/join?trade=chef to
// land on the chef's own dashboard.
//
//   node scripts/seed-chef.mjs                     # seed (or re-seed) the chef
//   node scripts/seed-chef.mjs --reset             # remove it and stop
//   node scripts/seed-chef.mjs --email you@x.com   # a real inbox for the order emails

import { loadEnv, assertTestEnvironment, stripeClient, supabaseClient, sleep, TEST_PROJECT_REF } from './seed-lib.mjs';

const CHEF_DOMAIN = 'gallowaychef.test';
const LOGIN_EMAIL = 'rosa@' + CHEF_DOMAIN;
// A known password, so this is a login you can use rather than a magic link you
// have to mint each time. It is a test account on a test project; there is
// nothing behind it worth protecting, and a fixed one is the whole point.
const LOGIN_PASSWORD = 'chef-walkthrough-2026';

const env = loadEnv();
// The full guard: this one DOES touch Stripe, so a test Stripe key is exactly
// the right thing to demand before it runs.
assertTestEnvironment(env);

const db = supabaseClient(env);
const stripe = stripeClient(env);

const reset = process.argv.includes('--reset');
const emailIndex = process.argv.indexOf('--email');
const contactEmail = emailIndex !== -1 ? String(process.argv[emailIndex + 1] || '') : LOGIN_EMAIL;

async function ownerIds() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    return (users || [])
        .filter((u) => String(u.email || '').endsWith('@' + CHEF_DOMAIN))
        .map((u) => ({ id: u.id, email: u.email }));
}

async function clear() {
    const owners = await ownerIds();

    for (const owner of owners) {
        const providers = await db.select('service_providers', '?owner_id=eq.' + owner.id + '&select=id');
        for (const p of providers) {
            // Orders reference the provider — clear them before the provider,
            // the same shape the walkthrough reset has for enquiries.
            await db.remove('service_orders', '?provider_id=eq.' + p.id);
        }
        await db.remove('service_areas', '?provider_id=in.(' + providers.map((p) => p.id).join(',') + ')').catch(() => {});
        await db.remove('service_providers', '?owner_id=eq.' + owner.id);
        await db.remove('profiles', '?id=eq.' + owner.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + owner.id);
        console.log('  removed ' + owner.email);
    }

    if (!owners.length) console.log('  nothing to remove');
}

async function makeOwner() {
    const user = await db.auth('POST', '/admin/users', {
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
        email_confirm: true,
    });
    return user.id;
}

// A Connect account that can actually receive a transfer, with the CHEF's own
// category. Modelled on createOnboardedAccount in seed-payments.mjs — the magic
// test values that Stripe verifies instantly — but MCC 5811 (caterers) and a
// chef's product description rather than the platform's lodging one.
async function onboardedChefAccount() {
    const account = await stripe.request('POST', '/accounts', {
        type: 'custom',
        country: 'GB',
        email: LOGIN_EMAIL,
        business_type: 'individual',
        capabilities: { transfers: { requested: 'true' }, card_payments: { requested: 'true' } },
        business_profile: {
            mcc: '5811',
            url: 'https://gallowaygetaways.co.uk',
            product_description: 'Private chef and in-home dining for holiday guests.',
        },
        individual: {
            first_name: 'Rosa',
            last_name: 'Maclean',
            email: LOGIN_EMAIL,
            phone: '+442071234567',
            id_number: '000000000',
            dob: { day: 1, month: 1, year: 1901 },
            address: { line1: 'address_full_match', city: 'Kirkcudbright', postal_code: 'DG6 4JG', country: 'GB' },
        },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
        external_account: {
            object: 'bank_account', country: 'GB', currency: 'gbp',
            account_number: '00012345', routing_number: '108800',
        },
        metadata: { gg_chef_seed: 'rosa' },
    });

    console.log('  created ' + account.id + ' (MCC 5811), waiting for payouts to enable…');

    for (let i = 0; i < 40; i++) {
        const fresh = await stripe.request('GET', '/accounts/' + account.id);
        if (fresh.payouts_enabled) {
            console.log('  payouts enabled after ~' + i * 5 + 's');
            return fresh;
        }
        await sleep(5000);
    }
    throw new Error('the chef Connect account never became payouts_enabled');
}

async function seed() {
    const now = new Date();

    const owner = await makeOwner();

    // A profile to match, the way the services apply route upserts one at
    // sign-up. Merge-duplicates so it is safe whether or not a trigger made one.
    await db.rest(
        'POST', '/profiles?on_conflict=id',
        [{ id: owner, email: LOGIN_EMAIL, full_name: 'Rosa Maclean', is_host: false }],
        'return=minimal,resolution=merge-duplicates'
    ).catch((e) => console.log('  (profile upsert note: ' + e.message + ')'));

    const account = await onboardedChefAccount();

    const [chef] = await db.insert('service_providers', [{
        owner_id: owner,
        business_name: 'Rosa’s Table',
        trade: 'chef',
        audience: 'guest',
        kind: 'external',
        description:
            'Three-course dinner cooked in your cottage, for up to six. Seasonal, mostly '
            + 'Galloway produce — Carrick lamb, Cream o’ Galloway, whatever the day’s catch is '
            + 'at the harbour. One sitting; I bring everything and clear it all away.',
        // The one fixed price. Their own words above carry what it covers.
        experience_price: 180,

        // Who they are — a name and a line, the fields the listing carries.
        provider_name: 'Rosa Maclean',
        based_line: 'Kirkcudbright · cooking privately since 2016',

        contact_email: contactEmail,
        contact_phone: '01557 555 0134',

        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'commission',
        commission_rate: 0.10,

        // The payout gate, crossed. This is what "approved-but-not-bookable"
        // becomes once Stripe can pay them.
        stripe_account_id: account.id,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
        stripe_updated_at: now.toISOString(),

        updated_at: now.toISOString(),
    }]);

    // Covers the same ground the walkthrough plumber does, so the chef shows up
    // for the same test cottages around Kirkcudbright and Gatehouse of Fleet.
    await db.insert('service_areas', [{
        provider_id: chef.id,
        label: 'Kirkcudbright and 20 miles',
        centre_lat: 54.8362,
        centre_lng: -4.0530,
        radius_miles: 20,
    }]);

    console.log('');
    console.log('  Rosa’s Table — private chef, £180, approved and payouts-enabled (bookable)');
    console.log('  covers Kirkcudbright + 20 miles');
    console.log('  order emails go to ' + contactEmail);
    console.log('');
    console.log('  LOGIN');
    console.log('    email     ' + LOGIN_EMAIL);
    console.log('    password  ' + LOGIN_PASSWORD);
    console.log('    then open /services/join?trade=chef to edit the listing and see requests');
    console.log('');
    console.log('  NOTE: guests only see her while GUEST_EXPERIENCES_OPEN is set on the app.');
}

console.log(reset ? 'clearing the seeded chef…' : 'seeding a chef on ' + TEST_PROJECT_REF + '…');
await clear();
if (!reset) await seed();
console.log('done.');
