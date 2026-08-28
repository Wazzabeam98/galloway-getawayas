// Two plumbers on the TEST project, so the enquiry flow can be walked by hand.
//
// WHY IT NEEDS AN ADDRESS YOU CAN READ
//
// There is no provider-facing page on this site. A tradesman's entire side of
// the flow arrives by email and is answered from a link in it, so walking the
// flow end to end means reading that email. Every other seeder on this project
// uses a reserved test domain precisely so nothing is ever sent — see
// lib/testAddresses.ts — and this one is the exception that proves the rule:
// the OWNER accounts stay on a reserved domain, and only `contact_email`, the
// address the enquiry is sent to, is a real inbox you name on the command line.
//
// So nothing here can email a stranger: the address is one you typed.
//
// TWO OF THEM, ON PURPOSE
//
//   Baxter Plumbing & Heating   a call-out fee, an hourly rate, a verified Gas
//                               Safe number, and out-of-hours ticked. The
//                               emergency route is offered for this one.
//   Nith Valley Plumbing        no published prices and no out-of-hours. Shows
//                               what an empty price renders as, and shows the
//                               emergency route being refused rather than
//                               quietly hidden.
//
// The Gas Safe row is inserted with `verified_at` AND `verified_number` set to
// the same number, which is what the admin decision route does. Without it
// registrationBlockers refuses the provider and neither the shop nor the
// enquiry route will show them — which is the correct behaviour and would look
// like a broken seeder.
//
// TWO PROPERTIES, OPTIONALLY
//
// `--host you@example.com` gives that account a pair of DRAFT listings, which
// is what the shop needs to work out where to search without asking. Test held
// none for a real account, so the second walk-through landed on the town
// picker and looked like the derivation was broken when it was simply reading
// an empty table.
//
// Draft rather than published on purpose: the shop reads a host's own listings
// whatever their status, and a published one would turn up in search results
// and in other suites' counts.
//
// One of them is deliberately a NAMED house with no street number — the shape
// that broke town matching until townForLocation started reading every part of
// the address.
//
// USAGE
//   node scripts/seed-enquiry-walkthrough.mjs --email you@example.com
//   node scripts/seed-enquiry-walkthrough.mjs --email you@ex.com --host you@ex.com
//   node scripts/seed-enquiry-walkthrough.mjs --reset
//
// Everything it makes hangs off owner accounts on @gallowaywalk.test, which is
// how --reset finds them again and why it can never touch anything else.

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const WALK_DOMAIN = 'gallowaywalk.test';

const env = loadEnv();

// Narrower than assertTestEnvironment on purpose: this seeder has nothing to
// do with Stripe, and demanding a test Stripe key to write two rows would be a
// guard about the wrong thing. The database is the only thing at stake, so the
// database is what is checked.
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

const emailIndex = process.argv.indexOf('--email');
const contactEmail = emailIndex !== -1 ? String(process.argv[emailIndex + 1] || '') : '';

const hostIndex = process.argv.indexOf('--host');
const hostEmail = hostIndex !== -1 ? String(process.argv[hostIndex + 1] || '') : '';

const LISTING_TAG = 'WALKTHROUGH — ';

if (!reset && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contactEmail)) {
    console.error('usage: node scripts/seed-enquiry-walkthrough.mjs --email you@example.com');
    console.error('       an address YOU can read — the tradesman\'s side of the flow arrives there.');
    process.exit(1);
}

async function ownerIds() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    return (users || [])
        .filter((u) => String(u.email || '').endsWith('@' + WALK_DOMAIN))
        .map((u) => ({ id: u.id, email: u.email }));
}

async function clear() {
    const owners = await ownerIds();

    for (const owner of owners) {
        // The enquiries go first: service_enquiries.provider_id is ON DELETE
        // RESTRICT, deliberately, so a provider cannot be deleted out from
        // under the record of what was sent to them. That is the right rule
        // and it makes a reset a two-step.
        const providers = await db.select('service_providers', '?owner_id=eq.' + owner.id + '&select=id');
        for (const p of providers) {
            await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
        }
        await db.remove('service_providers', '?owner_id=eq.' + owner.id);
        await db.auth('DELETE', '/admin/users/' + owner.id);
        console.log('  removed ' + owner.email);
    }

    // Listings are tagged by title rather than by owner: they hang off a REAL
    // account, and deleting by owner would take that host's own work with
    // them.
    const listings = await db.select(
        'listings',
        '?title=like.' + encodeURIComponent(LISTING_TAG + '*') + '&select=id,title'
    );

    for (const l of listings) {
        await db.remove('listings', '?id=eq.' + l.id);
        console.log('  removed listing ' + l.title);
    }

    if (!owners.length && !listings.length) console.log('  nothing to remove');
}

async function seedListings() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    const host = (users || []).filter((u) => String(u.email || '').toLowerCase() === hostEmail.toLowerCase())[0];

    if (!host) {
        console.log('  no account for ' + hostEmail + ' on test — skipping the listings');
        return;
    }

    await db.insert('listings', [
        {
            host_id: host.id,
            // A named house with no street number. lib/places only strips a
            // leading part that starts with a digit, so this is the shape that
            // used to resolve to the town "Anchorlee" and match nothing.
            title: LISTING_TAG + 'Anchorlee',
            location: 'Anchorlee, Gatehouse of Fleet, Dumfries and Galloway',
            price_per_night: 120,
            bedrooms: 3,
            status: 'draft',
        },
        {
            host_id: host.id,
            title: LISTING_TAG + 'Dovecroft',
            location: '18 Dovecroft, Kirkcudbright, Dumfries and Galloway',
            price_per_night: 95,
            bedrooms: 2,
            status: 'draft',
        },
    ]);

    console.log('  two draft listings on ' + hostEmail + ' — Gatehouse of Fleet and Kirkcudbright');
}

async function makeOwner(email) {
    const user = await db.auth('POST', '/admin/users', {
        email,
        password: 'walkthrough-' + Math.random().toString(36).slice(2, 10),
        email_confirm: true,
    });
    return user.id;
}

async function seed() {
    const now = new Date();
    const inAYear = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

    // ---- the one who can do everything --------------------------------
    const baxterOwner = await makeOwner('baxter@' + WALK_DOMAIN);

    const [baxter] = await db.insert('service_providers', [{
        owner_id: baxterOwner,
        business_name: 'Baxter Plumbing & Heating',
        trade: 'plumber',
        audience: 'host',
        kind: 'external',
        description:
            'Two of us, out of Kirkcudbright, doing repairs and boiler work across the Stewartry. '
            + 'Twenty years at it. We carry most common parts on the van.',
        contact_email: contactEmail,
        contact_phone: '01557 555 0117',
        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'subscription',
        commission_rate: 0,
        trial_ends_at: new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString(),
        callout_fee: 45,
        hourly_rate: 55,
        callout_waived: true,
        does_gas: true,
        does_oil: false,
    }]);

    await db.insert('service_areas', [{
        provider_id: baxter.id,
        label: 'Kirkcudbright and 20 miles',
        centre_lat: 54.8362,
        centre_lng: -4.0530,
        radius_miles: 20,
    }]);

    // Written the way the admin decision route writes it: verified_number
    // equal to number is what "verified" MEANS — change the number and it
    // stops matching in the same statement.
    await db.insert('service_provider_registrations', [{
        provider_id: baxter.id,
        scheme: 'gas_safe',
        number: '512874',
        verified_at: now.toISOString(),
        verified_number: '512874',
        expires_at: inAYear.toISOString().slice(0, 10),
    }]);

    await db.insert('service_provider_extras',
        [
            'plumb_leak', 'plumb_no_water', 'plumb_no_hot_water', 'plumb_no_heating',
            'plumb_boiler_fault', 'plumb_burst_frozen',
            'plumb_boiler_service', 'plumb_gas_certificate',
            'plumb_same_day', 'plumb_out_of_hours', 'plumb_winter',
        ].map((key) => ({ provider_id: baxter.id, extra_key: key, offered: true }))
    );

    // ---- the one who cannot ---------------------------------------------
    //
    // No prices and no out-of-hours. Both absences are the point: a host
    // should see an honest blank rather than "£0", and should be told plainly
    // that this one cannot be rung at nine at night rather than wondering
    // where the option went.
    const nithOwner = await makeOwner('nith@' + WALK_DOMAIN);

    const [nith] = await db.insert('service_providers', [{
        owner_id: nithOwner,
        business_name: 'Nith Valley Plumbing',
        trade: 'plumber',
        audience: 'host',
        kind: 'external',
        description: 'One-man band based in Dalbeattie. Bathrooms and general plumbing, weekdays.',
        contact_email: contactEmail,
        contact_phone: '01556 555 0142',
        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'subscription',
        commission_rate: 0,
        does_gas: false,
        does_oil: false,
    }]);

    await db.insert('service_areas', [{
        provider_id: nith.id,
        label: 'Dalbeattie and 15 miles',
        centre_lat: 54.9350,
        centre_lng: -3.8200,
        radius_miles: 15,
    }]);

    await db.insert('service_provider_extras',
        ['plumb_leak', 'plumb_blocked_toilet', 'plumb_bathrooms']
            .map((key) => ({ provider_id: nith.id, extra_key: key, offered: true }))
    );

    console.log('');
    console.log('  Baxter Plumbing & Heating   £45 call-out (waived), £55/hr, Gas Safe 512874');
    console.log('                              out-of-hours ticked — emergency route offered');
    console.log('  Nith Valley Plumbing        no published prices, no out-of-hours');
    console.log('');
    console.log('  both send to ' + contactEmail);
    console.log('  both cover Kirkcudbright; only Baxter covers it from 20 miles out');
}

console.log(reset ? 'clearing walkthrough data...' : 'seeding walkthrough plumbers...');
await clear();
if (!reset) {
    await seed();
    if (hostEmail) await seedListings();
}
console.log('done.');
