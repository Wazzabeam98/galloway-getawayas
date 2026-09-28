// One approved TRADESPERSON (a plumber) on the TEST project, with a handful of
// enquiries, so the provider Reservations page can be walked in its ENQUIRY
// shape — the fourth kind alongside the slot / comes-to-you / made-to-order
// experience providers seeded by seed-experiences.mjs.
//
// WHY IT IS ITS OWN SEEDER
//
// A tradesperson is a different animal from a guest-experience provider: a host
// audience, paid off-platform, found by property owners and contacted by an
// enquiry rather than a booking. There is no money on the platform for them, so
// none of seed-experiences' Stripe machinery applies. What they DO have is
// service_enquiries — some accepted and coming up, some still to answer — and
// that is what makes their Reservations page worth looking at.
//
// The owner account lives on @gallowayexp.test, the same reserved domain the
// experience seeders use, so it is torn down with them and never emails anyone.
// The enquiries are sent BY Liam's real account (the property owner asking for
// help) against his own listings, so signing in as the plumber shows real names
// and real cottages, and signing in as Liam shows the other side of the same
// jobs.
//
// USAGE
//   node scripts/seed-trade-provider.mjs
//   node scripts/seed-trade-provider.mjs --reset

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const SEED_DOMAIN = 'gallowayexp.test';
const OWNER_EMAIL = 'seed-trade@' + SEED_DOMAIN;
const LIAM_EMAIL = 'liamworrall18@hotmail.com';

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

const now = new Date();
const inDays = (n) => new Date(now.getTime() + n * 24 * 3600 * 1000);
const dateKey = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

// A short, unique-ish reference in the same GG-XXXX shape the app mints.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const reference = () => 'GG-' + Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

async function ownerId() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    const found = (users || []).find((u) => String(u.email || '').toLowerCase() === OWNER_EMAIL);
    return found ? found.id : null;
}

async function clear() {
    const id = await ownerId();
    if (id) {
        // service_enquiries.provider_id is ON DELETE RESTRICT, so the enquiries
        // must go before the provider they point at.
        const providers = await db.select('service_providers', '?owner_id=eq.' + id + '&select=id');
        for (const p of providers) {
            await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
        }
        await db.remove('service_providers', '?owner_id=eq.' + id);
        await db.auth('DELETE', '/admin/users/' + id);
        console.log('  removed ' + OWNER_EMAIL);
    } else {
        console.log('  nothing to remove');
    }
}

async function seed() {
    // The owner account.
    const made = await db.auth('POST', '/admin/users', {
        email: OWNER_EMAIL,
        password: 'trade-' + Math.random().toString(36).slice(2, 10),
        email_confirm: true,
        user_metadata: { full_name: 'Cammy (Solway Plumbing)' },
    });
    const owner = made.id || made.user?.id;
    const existing = await db.select('profiles', '?select=id&id=eq.' + owner);
    if (existing.length) await db.update('profiles', '?id=eq.' + owner, { email: OWNER_EMAIL, full_name: 'Cammy (Solway Plumbing)' });
    else await db.insert('profiles', { id: owner, email: OWNER_EMAIL, full_name: 'Cammy (Solway Plumbing)' });

    // The business. A general plumber (no gas/oil), so no registration gate to
    // satisfy — off-platform, approved, listed.
    const [provider] = await db.insert('service_providers', [{
        owner_id: owner,
        business_name: 'Solway Plumbing',
        trade: 'plumber',
        audience: 'host',
        kind: 'external',
        description:
            'Repairs and bathroom work across the Stewartry, based in Kirkcudbright. '
            + 'Fifteen years on the tools, most common parts on the van, and I turn up when I say I will.',
        contact_email: OWNER_EMAIL,
        contact_phone: '01557 555 0134',
        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'subscription',
        commission_rate: 0,
        trial_ends_at: inDays(90).toISOString(),
        callout_fee: 40,
        hourly_rate: 50,
        callout_waived: true,
        does_gas: false,
        does_oil: false,
    }]);

    await db.insert('service_areas', [{
        provider_id: provider.id,
        label: 'Kirkcudbright and 20 miles',
        centre_lat: 54.8362,
        centre_lng: -4.0530,
        radius_miles: 20,
    }]);

    await db.insert('service_provider_extras',
        ['plumb_leak', 'plumb_blocked_toilet', 'plumb_no_hot_water', 'plumb_bathrooms', 'plumb_boiler_fault']
            .map((key) => ({ provider_id: provider.id, extra_key: key, offered: true }))
    );

    // The property owner sending the work: Liam's real account, against his own
    // listings, so the plumber sees real names and cottages.
    const [liam] = await db.select('profiles', '?select=id,email,full_name&email=eq.' + encodeURIComponent(LIAM_EMAIL));
    if (!liam) {
        console.log('  no profile for ' + LIAM_EMAIL + ' — provider seeded, but no enquiries to show.');
        return provider;
    }
    let listings = await db.select('listings', '?select=id,title,location&host_id=eq.' + liam.id + '&order=created_at.asc&limit=3');
    if (!listings.length) {
        // Fall back to any listing so the enquiries still have a property.
        listings = await db.select('listings', '?select=id,title,location&order=created_at.asc&limit=3');
    }
    const pick = (i) => listings[i % Math.max(listings.length, 1)] || null;
    const hostName = liam.full_name || 'Liam Worrall';

    const base = {
        host_id: liam.id,
        provider_id: provider.id,
        trade: 'plumber',
        business_name: provider.business_name,
        host_name: hostName,
        host_phone: '07700 900123',
        host_email: liam.email,
    };

    // Two accepted jobs coming up, two requests still to answer. The unique
    // "one live enquiry" index only bites on sent/viewed rows keyed by
    // (host, provider, trade, urgency, listing) — so the two to-answer rows
    // differ by both urgency and property.
    const rows = [
        {
            ...base, status: 'accepted',
            listing_id: pick(0)?.id || null, area_key: pick(0)?.location || '',
            summary: 'Dripping tap in the ensuite and a slow-draining bath',
            urgency: 'planned', preferred_date: dateKey(inDays(3)),
            window_from: '09:00', window_to: '12:00',
            sent_at: inDays(-4).toISOString(), expires_at: inDays(10).toISOString(),
            reference: reference(),
        },
        {
            ...base, status: 'accepted',
            listing_id: pick(1)?.id || null, area_key: pick(1)?.location || '',
            summary: 'Replace the kitchen mixer tap between guest stays',
            urgency: 'soon', preferred_date: dateKey(inDays(9)),
            window_from: '13:00', window_to: '17:00',
            sent_at: inDays(-2).toISOString(), expires_at: inDays(12).toISOString(),
            reference: reference(),
        },
        {
            ...base, status: 'sent',
            listing_id: pick(0)?.id || null, area_key: pick(0)?.location || '',
            summary: 'No hot water — combi boiler firing but water stays cold',
            urgency: 'soon', preferred_date: dateKey(inDays(1)),
            window_from: '08:00', window_to: '11:00',
            sent_at: inDays(-1).toISOString(), expires_at: inDays(2).toISOString(),
            reference: reference(),
        },
        {
            ...base, status: 'sent',
            listing_id: pick(1)?.id || null, area_key: pick(1)?.location || '',
            summary: 'Quote for a new bathroom suite at the cottage',
            urgency: 'planned', preferred_date: dateKey(inDays(14)),
            window_from: '10:00', window_to: '16:00',
            sent_at: inDays(-1).toISOString(), expires_at: inDays(6).toISOString(),
            reference: reference(),
        },
    ];

    for (const r of rows) {
        await db.insert('service_enquiries', [r]);
    }

    console.log('');
    console.log('  Solway Plumbing (plumber, approved, off-platform)  owner ' + OWNER_EMAIL);
    console.log('  ' + rows.filter((r) => r.status === 'accepted').length + ' accepted jobs coming up, '
        + rows.filter((r) => r.status === 'sent').length + ' requests to answer');
    console.log('  enquiries sent by ' + hostName + ' against ' + listings.length + ' of their listings');
    console.log('');
    console.log('  sign in as ' + OWNER_EMAIL + ' → /services/dashboard');
    return provider;
}

console.log(reset ? 'clearing trade-provider seed...' : 'seeding trade provider...');
await clear();
if (!reset) await seed();
console.log('done.');
