// A throwaway, CONFIRMED, un-approved guest account for walking the sign-up
// wizard — and a magic-link URL to sign in as it. It owns NO service_provider
// row, which is the whole point: an approved (or any existing) provider row
// makes the wizard open in its own state and override a seeded localStorage
// draft, so you can never land a draft on a mid-flow screen to look at it. A
// fresh account has nothing to override, so a seeded draft resolves straight to
// the screen you set.
//
//   SITE=http://localhost:<port> node scripts/_wizard-walk-account.mjs       # create + print login URL
//   node scripts/_wizard-walk-account.mjs --reset                            # delete the account
//
// Then, signed in as it, set localStorage['gg.provider-draft.guest'] to a draft
// whose `step` is the screen you want (photos pre-filled so the photos gate is
// already satisfied) and open /services/join?trade=guest.
//
// TEST PROJECT ONLY (seed-lib refuses anything else). No provider, no booking,
// no Stripe — just an auth user you throw away when you're done looking.

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project (' + TEST_PROJECT_REF + ')');
    process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set'); process.exit(1); }

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');
const EMAIL = 'wizard-walk@gallowaywalk.test';
const PASSWORD = 'wizard-walk-2026';
const site = process.env.SITE;

async function findUser() {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === EMAIL) || null;
}

async function clear() {
    const u = await findUser();
    if (u) {
        // Remove any provider row it somehow acquired, so it stays un-approved.
        const provs = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id').catch(() => []);
        for (const p of provs || []) {
            await db.remove('service_provider_items', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_areas', '?provider_id=eq.' + p.id).catch(() => {});
            await db.remove('service_providers', '?id=eq.' + p.id).catch(() => {});
        }
        await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
        await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
        console.log('  removed ' + EMAIL);
    } else {
        console.log('  nothing to remove');
    }
}

console.log(reset ? 'clearing the wizard-walk account…' : 'seeding a wizard-walk account on ' + TEST_PROJECT_REF + '…');
await clear();
if (reset) { console.log('done.'); process.exit(0); }

await db.auth('POST', '/admin/users', { email: EMAIL, password: PASSWORD, email_confirm: true });

// A magic link so you can sign in with no password (same mechanism as
// scripts/_login-url.mjs, for this throwaway email).
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) });
const link = await r.json();
if (!link.hashed_token) { console.error('no token', JSON.stringify(link).slice(0, 200)); process.exit(1); }

console.log('\n  Account : ' + EMAIL + ' (confirmed, no provider row)');
if (site) {
    console.log('  Sign in : ' + site + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token));
} else {
    console.log('  token_hash: ' + link.hashed_token + '  (set SITE=… to print the full callback URL)');
}
console.log('\n  Then set the draft and open /services/join?trade=guest. --reset when done.');
