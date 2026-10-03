// Two fully-fleshed TRADESPEOPLE on the TEST project — a joiner and a plumber —
// with photos, a headshot, an About-you profile (years, title, qualifications,
// endorsements), coverage, services, the availability ticks, a call-out fee, an
// accepted subscription, and a live enquiry from a host still to answer. Enough
// to walk the trade side (public profile, card, dashboard, messaging) AND the
// host side of the same jobs.
//
// Both owners get a KNOWN password so the logins can actually be walked. They
// live on the reserved @gallowaytrade.test domain — the trade seeds' OWN domain,
// deliberately separate from the experience seeders' @gallowayexp.test. The
// experience seed (scripts/seed-experiences.mjs) resets by deleting EVERY user on
// its domain, so a trade account sharing that domain was wiped whenever the
// experience seed ran. Each seed owns a distinct domain — the same way the
// passport seed (@gallowaypassport.test) stays clear of the payments seed
// (@gallowayseed.test). Do not move the trade seeds back onto an experience or
// payments domain. The enquiries are sent BY Liam's real account against his own
// listings, so the trade sees real cottages and names, and Liam sees the other
// side of the same jobs.
//
// Photos: there are no trade stock images in the repo, so this uploads a few of
// the site's Galloway hero photos to the bucket under seed-assets/trade/ as
// PLACEHOLDERS (scenery, not real job photos) — enough to prove the layout with
// images present. Swap them for real ones any time; the keys are stable.
//
// USAGE
//   node scripts/seed-trades-parity.mjs
//   node scripts/seed-trades-parity.mjs --reset

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const SEED_DOMAIN = 'gallowaytrade.test';
const LIAM_EMAIL = 'liamworrall18@hotmail.com';
const PASSWORD = 'walk-the-trade-2026';
const AGREEMENT_VERSION = 'v1-2026-10-03'; // keep in sync with AGREEMENTS in lib/agreements.ts

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
const BUCKET = env.NEXT_PUBLIC_S3_BUCKET || 'listings';

const now = new Date();
const inDays = (n) => new Date(now.getTime() + n * 24 * 3600 * 1000);
// Six CALENDAR months, matching lib/serviceProviders.trialEndsAt — the trial is
// six months, not the ninety days this used to hard-code.
const inMonths = (n) => { const d = new Date(now.getTime()); d.setMonth(d.getMonth() + n); return d; };
const dateKey = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const reference = () => 'GG-' + Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

async function uploadImage(localRel, key) {
    const abs = path.join(process.cwd(), localRel);
    if (!fs.existsSync(abs)) return false;
    const bytes = fs.readFileSync(abs);
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + key, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
                    'Content-Type': 'image/jpeg',
                    'x-upsert': 'true',
                },
                body: bytes,
            });
            if (res.ok || res.status === 409) return true;
            console.log('  upload ' + key + ' -> ' + res.status + ' (attempt ' + attempt + ')');
        } catch (e) {
            console.log('  upload ' + key + ' failed (attempt ' + attempt + '): ' + (e.message || e));
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
    return false;
}

// Placeholder imagery — the site's own Galloway hero photos (smaller web copy
// first so the upload is light), uploaded once. Returns the keys that landed.
const PHOTO_KEYS = ['seed-assets/trade/gg-1.jpg', 'seed-assets/trade/gg-2.jpg', 'seed-assets/trade/gg-3.jpg'];
async function uploadPhotos() {
    const sources = ['public/images/hero-3-web.jpg', 'public/images/hero-2.jpg', 'public/images/hero-4.jpg'];
    const landed = [];
    for (let i = 0; i < PHOTO_KEYS.length; i++) {
        if (await uploadImage(sources[i], PHOTO_KEYS[i])) landed.push(PHOTO_KEYS[i]);
    }
    return landed;
}

const TRADES = [
    {
        email: 'seed-joiner@' + SEED_DOMAIN,
        fullName: 'Ewan Baird (Baird Joinery)',
        business_name: 'Baird Joinery',
        trade: 'joiner',
        description: 'Doors, floors, stairs and fitted kitchens across the Machars and the Stewartry. '
            + 'Time-served joiner, twenty years at it, and I leave a site as I found it.',
        contact_phone: '01988 555 0119',
        callout_fee: 35,
        hourly_rate: 45,
        does_gas: false,
        does_oil: false,
        registration_number: null,
        // Coverage as REGIONS, the way the live sign-up stores it now (a region
        // label with a zero radius) — so the /services area filter can match on
        // it. Baird's description says the Machars and the Stewartry.
        areas: [
            { label: 'The Machars', centre_lat: 0, centre_lng: 0, radius_miles: 0 },
            { label: 'The Stewartry', centre_lat: 0, centre_lng: 0, radius_miles: 0 },
        ],
        extras: ['joiner_doors_windows', 'joiner_flooring', 'joiner_kitchens', 'joiner_stairs'],
        guest_details: {
            years_experience: '20',
            professional_title: 'Time-served joiner',
            qualifications: 'City & Guilds Carpentry & Joinery; CSCS card.',
            recognition: 'Fitted out three of the harbour cottages in Isle of Whithorn.',
        },
    },
    {
        email: 'seed-plumber@' + SEED_DOMAIN,
        fullName: 'Cammy Rae (Solway Plumbing)',
        business_name: 'Solway Plumbing',
        trade: 'plumber',
        description: 'Repairs and bathroom work across the Stewartry, based in Kirkcudbright. '
            + 'Fifteen years on the tools, most common parts on the van, and I turn up when I say I will.',
        contact_phone: '01557 555 0134',
        callout_fee: 40,
        hourly_rate: 50,
        does_gas: false,
        does_oil: false,
        registration_number: 'SNIPEF 20915',
        // Region coverage (see the note on Baird): Solway works the Stewartry.
        areas: [
            { label: 'The Stewartry', centre_lat: 0, centre_lng: 0, radius_miles: 0 },
        ],
        extras: ['plumb_leak', 'plumb_blocked_toilet', 'plumb_no_hot_water', 'plumb_bathrooms'],
        guest_details: {
            years_experience: '15',
            professional_title: 'Plumbing & heating engineer',
            qualifications: 'NVQ Level 3 Plumbing; SNIPEF registered.',
            recognition: 'Regular for a dozen holiday cottages around Kirkcudbright.',
        },
    },
];

async function usersByEmail() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    const map = {};
    for (const u of users || []) map[String(u.email || '').toLowerCase()] = u;
    return map;
}

// One-time migration cleanup. Before the trade seeds got their own domain, the
// joiner and plumber lived on the experience seed's @gallowayexp.test, and the
// domain move left those old rows behind — so "Baird Joinery" (and "Solway
// Plumbing") showed up TWICE in the directory, once from each domain. These are
// the exact legacy logins to sweep; they are named individually rather than by
// domain so this never touches an experience-seed account that rightly lives on
// @gallowayexp.test.
const LEGACY_EMAILS = ['seed-joiner@gallowayexp.test', 'seed-plumber@gallowayexp.test'];

async function removeOwner(u, email) {
    const providers = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id');
    for (const p of providers) {
        await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
        await db.remove('service_areas', '?provider_id=eq.' + p.id);
        await db.remove('service_provider_extras', '?provider_id=eq.' + p.id);
        await db.remove('service_provider_registrations', '?provider_id=eq.' + p.id);
    }
    await db.remove('service_providers', '?owner_id=eq.' + u.id);
    await db.auth('DELETE', '/admin/users/' + u.id);
    console.log('  removed ' + email);
}

async function clear() {
    const map = await usersByEmail();
    for (const t of TRADES) {
        const u = map[t.email];
        if (u) await removeOwner(u, t.email);
    }
    // Sweep the stale duplicates left on the old domain by the historic move.
    for (const email of LEGACY_EMAILS) {
        const u = map[email];
        if (u) await removeOwner(u, email + ' (legacy duplicate)');
    }
}

async function seedOne(t, liam, listings, photoKeys) {
    // Owner account with a KNOWN password so the login can be walked.
    const made = await db.auth('POST', '/admin/users', {
        email: t.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: t.fullName },
    });
    const owner = made.id || made.user?.id;
    const has = await db.select('profiles', '?select=id&id=eq.' + owner);
    if (has.length) await db.update('profiles', '?id=eq.' + owner, { email: t.email, full_name: t.fullName });
    else await db.insert('profiles', { id: owner, email: t.email, full_name: t.fullName });

    const [provider] = await db.insert('service_providers', [{
        owner_id: owner,
        business_name: t.business_name,
        trade: t.trade,
        audience: 'host',
        kind: 'external',
        description: t.description,
        contact_email: t.email,
        contact_phone: t.contact_phone,
        status: 'approved',
        approved_at: now.toISOString(),
        plan: 'subscription',
        commission_rate: 0,
        trial_ends_at: inMonths(6).toISOString(),
        callout_fee: t.callout_fee,
        hourly_rate: t.hourly_rate,
        callout_waived: true,
        does_gas: t.does_gas,
        does_oil: t.does_oil,
        does_emergency: true,
        does_scheduled: true,
        registration_number: t.registration_number,
        headshot: photoKeys[0] || null,
        photos: photoKeys,
        guest_details: t.guest_details,
        declarations: {},
    }]);

    // Agreements are recorded in agreement_acceptances now (PR #222), not in
    // declarations. Seed the role's agreement plus the site-wide Terms so the
    // account matches a real signed-up trade and would pass the submit wall.
    await db.insert('agreement_acceptances', [
        { user_id: owner, document: 'tradesperson', version: AGREEMENT_VERSION, accepted_at: now.toISOString(), source: 'seed' },
        { user_id: owner, document: 'guest', version: AGREEMENT_VERSION, accepted_at: now.toISOString(), source: 'seed' },
    ]);

    await db.insert('service_areas', t.areas.map((a) => ({ provider_id: provider.id, ...a })));
    await db.insert('service_provider_extras', t.extras.map((key) => ({ provider_id: provider.id, extra_key: key, offered: true })));

    if (!liam) return { provider, sent: 0 };

    const pick = (i) => listings[i % Math.max(listings.length, 1)] || null;
    const base = {
        host_id: liam.id, provider_id: provider.id, trade: t.trade, business_name: provider.business_name,
        host_name: liam.full_name || 'Liam Worrall', host_phone: '07700 900123', host_email: liam.email,
    };
    const rows = [
        {
            ...base, status: 'accepted',
            listing_id: pick(0)?.id || null, area_key: pick(0)?.location || '',
            summary: t.trade === 'joiner' ? 'Re-hang a sticking front door and ease two internal doors' : 'Dripping tap in the ensuite and a slow-draining bath',
            urgency: 'planned', preferred_date: dateKey(inDays(4)), window_from: '09:00', window_to: '12:00',
            sent_at: inDays(-3).toISOString(), expires_at: inDays(10).toISOString(), reference: reference(),
        },
        {
            ...base, status: 'sent',
            listing_id: pick(1)?.id || null, area_key: pick(1)?.location || '',
            summary: t.trade === 'joiner' ? 'Quote for fitted wardrobes in the twin room' : 'No hot water — combi firing but water stays cold',
            urgency: 'soon', preferred_date: dateKey(inDays(2)), window_from: '08:00', window_to: '11:00',
            sent_at: inDays(-1).toISOString(), expires_at: inDays(3).toISOString(), reference: reference(),
        },
        {
            // A still-to-answer request on the SAME day as the accepted job above
            // (inDays(4)) with an overlapping morning window, so the soft clash
            // warning shows on the request card every time this seed runs — no
            // need to set one up by hand. Planned, so it carries a date.
            ...base, status: 'sent',
            listing_id: pick(2)?.id || null, area_key: pick(2)?.location || '',
            summary: t.trade === 'joiner' ? 'Ease a warped back door that won’t latch' : 'Bleed the radiators — three upstairs aren’t heating',
            urgency: 'planned', preferred_date: dateKey(inDays(4)), window_from: '10:00', window_to: '13:00',
            sent_at: inDays(-1).toISOString(), expires_at: inDays(6).toISOString(), reference: reference(),
        },
    ];
    for (const r of rows) await db.insert('service_enquiries', [r]);
    return { provider, sent: rows.filter((r) => r.status === 'sent').length };
}

console.log(reset ? 'clearing trades-parity seed...' : 'seeding trades parity...');
await clear();
if (reset) { console.log('done.'); process.exit(0); }

const photoKeys = await uploadPhotos();
console.log('  ' + photoKeys.length + ' placeholder photo(s) in the bucket');

const [liam] = await db.select('profiles', '?select=id,email,full_name&email=eq.' + encodeURIComponent(LIAM_EMAIL));
let listings = [];
if (liam) {
    listings = await db.select('listings', '?select=id,title,location&host_id=eq.' + liam.id + '&order=created_at.asc&limit=3');
    if (!listings.length) listings = await db.select('listings', '?select=id,title,location&order=created_at.asc&limit=3');
}

console.log('');
for (const t of TRADES) {
    const { provider, sent } = await seedOne(t, liam, listings, photoKeys);
    console.log('  ' + t.business_name + ' (' + t.trade + ', approved)  login ' + t.email + ' / ' + PASSWORD);
    console.log('    provider id ' + provider.id + '  ·  ' + sent + ' request(s) to answer + 1 accepted job');
}
console.log('');
console.log('  Trade side:  sign in as a login above → /services/dashboard/calendar');
console.log('  Host side:   sign in as ' + LIAM_EMAIL + ' → the same jobs from the other side');
console.log('done.');
