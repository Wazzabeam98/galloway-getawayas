// Signed-in journey checks, run without a browser and without a person.
//
// The thing that used to make these manual is that every interesting page is
// behind a login, and a login needed an inbox or a password. Neither is true:
// the admin API mints a one-time link with `generate_link` (which sends no
// email), /verify turns it into a session, and auth-helpers stores a session
// as one cookie whose format is a plain JSON array. So a session can be built
// on demand, held for the length of a run, and thrown away.
//
// No password is stored anywhere. The accounts are created with a random one
// that is discarded immediately and never used to sign in.
//
// Read-mostly: it creates two accounts on a domain nothing else uses, and the
// RLS probe below writes one column to a row it made itself. `--reset` removes
// everything it has ever made.
//
// Usage:
//   node scripts/journeys.mjs                 against the preview
//   node scripts/journeys.mjs --host http://localhost:3000
//   node scripts/journeys.mjs --reset         delete the accounts and stop

import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
const args = process.argv.slice(2);
const hostArg = (() => {
    const i = args.indexOf('--host');
    return i >= 0 ? args[i + 1] : null;
})();

const HOST =
    hostArg ||
    'https://galloway-getawayas-git-services-phase-one-wazzabeam98s-projects.vercel.app';
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project');
    process.exit(1);
}

// Its own domain, so the payment seeder's reset and the inbox runner's reset
// can never reach these and vice versa.
const AUTO_DOMAIN = 'gallowayauto.test';
const GUEST = `auto-guest@${AUTO_DOMAIN}`;
const ADMIN = `auto-admin@${AUTO_DOMAIN}`;

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

const admin = (path, init = {}) =>
    fetch(`${SUPABASE_URL}${path}`, {
        ...init,
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

/* ------------------------------------------------------------- accounts */

async function findUser(email) {
    const res = await admin('/auth/v1/admin/users?per_page=200');
    const body = await res.json();
    return (body.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
}

async function ensureUser(email, { isAdmin = false } = {}) {
    let user = await findUser(email);
    if (!user) {
        // A random password that is immediately forgotten. Sessions come from
        // generate_link, so nothing ever needs to know it.
        const throwaway = [...crypto.getRandomValues(new Uint8Array(24))]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        const res = await admin('/auth/v1/admin/users', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password: throwaway,
                email_confirm: true,
                user_metadata: { name: isAdmin ? 'Auto Admin' : 'Auto Guest' },
            }),
        });
        user = await res.json();
        if (!user.id) throw new Error(`could not create ${email}: ${JSON.stringify(user)}`);
    }

    // The profile row is what the admin pages actually read.
    await admin('/rest/v1/profiles', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
            id: user.id,
            email,
            full_name: isAdmin ? 'Auto Admin' : 'Auto Guest',
            is_admin: isAdmin,
            is_host: false,
        }),
    });

    return user;
}

/**
 * A session for `email`, as the cookie the server reads.
 *
 * generate_link sends no email — it hands back the token hash directly — and
 * /verify turns that into a real session. The cookie format is the compact
 * array auth-helpers writes: [access, refresh, provider, providerRefresh,
 * factors]. See stringifySupabaseSession in @supabase/auth-helpers-shared.
 */
async function sessionCookie(email) {
    const linkRes = await admin('/auth/v1/admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email }),
    });
    const link = await linkRes.json();
    if (!link.hashed_token) throw new Error(`no token for ${email}: ${JSON.stringify(link)}`);

    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
    });
    const session = await verifyRes.json();
    if (!session.access_token) throw new Error(`no session for ${email}`);

    const value = JSON.stringify([
        session.access_token,
        session.refresh_token,
        session.provider_token ?? null,
        session.provider_refresh_token ?? null,
        session.user?.factors ?? null,
    ]);
    return {
        header: `${COOKIE_NAME}=${encodeURIComponent(value)}`,
        accessToken: session.access_token,
        userId: session.user.id,
    };
}

/* ---------------------------------------------------------------- checks */

const results = [];
function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function page(path, cookie) {
    const res = await fetch(`${HOST}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
    });
    const body = res.status === 200 ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), body };
}

// notFound() renders the not-found boundary but Next still answers HTTP 200,
// so the status says nothing about whether the page was allowed. What is on
// the page does. These words appear on the admin index and nowhere a signed
// out visitor can reach.
const ADMIN_MARKERS = ['Payouts', 'Commission', 'Disputes', 'Errors'];

function looksLikeAdmin(html) {
    const text = html.replace(/<[^>]+>/g, ' ');
    return ADMIN_MARKERS.filter((m) => text.includes(m));
}

async function run() {
    console.log(`host: ${HOST}`);
    console.log(`supabase: ${PROJECT_REF}\n`);

    const guest = await ensureUser(GUEST);
    const adminUser = await ensureUser(ADMIN, { isAdmin: true });
    const guestCookie = (await sessionCookie(GUEST)).header;
    const adminCookie = (await sessionCookie(ADMIN)).header;
    console.log(`accounts ready: ${GUEST}, ${ADMIN}\n`);

    console.log('--- signed out ---');
    {
        const r = await page('/dashboard');
        // middleware.ts matches /dashboard/:path* and bounces the signed out.
        record('signed-out /dashboard does not render', r.status !== 200, `HTTP ${r.status}`);
    }
    {
        const r = await page('/admin');
        const leaked = looksLikeAdmin(r.body);
        record('signed-out /admin shows no admin content', leaked.length === 0, leaked.join(', ') || 'nothing');
    }

    console.log('\n--- signed in as a guest ---');
    for (const path of ['/dashboard', '/trips', '/passport', '/messages']) {
        const r = await page(path, guestCookie);
        record(`${path} renders`, r.status === 200, `HTTP ${r.status}`);
    }
    {
        const r = await page('/services/join/apply?trade=plumber', guestCookie);
        record('/services/join/apply renders', r.status === 200, `HTTP ${r.status}`);
    }
    {
        const r = await page('/admin', guestCookie);
        const leaked = looksLikeAdmin(r.body);
        record('a guest sees no admin content', leaked.length === 0, leaked.join(', ') || 'nothing');
    }

    console.log('\n--- signed in as an admin ---');
    {
        const r = await page('/admin', adminCookie);
        const seen = looksLikeAdmin(r.body);
        // The positive half. Without this the two checks above would pass just
        // as well if /admin were broken for everybody.
        record('an admin DOES see admin content', seen.length === ADMIN_MARKERS.length, seen.join(', ') || 'nothing');
    }
    for (const path of ['/admin/providers', '/admin/listings', '/admin/errors']) {
        const r = await page(path, adminCookie);
        record(`${path} renders for an admin`, r.status === 200, `HTTP ${r.status}`);
    }

    console.log('\n--- cron routes ---');
    {
        const r = await fetch(`${HOST}/api/cron/error-digest`, { redirect: 'manual' });
        record('cron route refuses an unauthenticated call', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
    }

    console.log('\n--- RLS: can an owner approve themselves? (known hole, item 8) ---');
    await rlsProbe(guest.id);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}

/**
 * The policy `owners manage their own provider` allows an owner to write any
 * column on their own row, `status` included. This writes as the USER, with
 * their own access token, so RLS is genuinely in the path — the service role
 * would bypass it and prove nothing.
 *
 * A PASS here means the hole is closed. It is expected to FAIL until it is.
 */
async function rlsProbe(ownerId) {
    const { accessToken } = await sessionCookie(GUEST);
    const asUser = (path, init = {}) =>
        fetch(`${SUPABASE_URL}${path}`, {
            ...init,
            headers: {
                apikey: ANON_KEY,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...(init.headers || {}),
            },
        });

    // A row of their own to try it on.
    const created = await asUser('/rest/v1/service_providers', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            owner_id: ownerId,
            trade: 'plumber',
            business_name: 'AUTO — rls probe',
            contact_email: GUEST,
            status: 'pending_review',
        }),
    });
    const rows = await created.json();
    if (!Array.isArray(rows) || !rows[0]) {
        record('RLS probe could not create a provider row', false, JSON.stringify(rows).slice(0, 120));
        return;
    }
    const id = rows[0].id;

    const escalate = await asUser(`/rest/v1/service_providers?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'approved' }),
    });
    const after = await escalate.json();
    const nowApproved = Array.isArray(after) && after[0] && after[0].status === 'approved';
    record(
        'an owner CANNOT set their own status to approved',
        !nowApproved,
        nowApproved ? 'they can — item 8 is still open' : 'blocked'
    );

    await admin(`/rest/v1/service_providers?id=eq.${id}`, { method: 'DELETE' });
}

/* ----------------------------------------------------------------- reset */

async function reset() {
    for (const email of [GUEST, ADMIN]) {
        const user = await findUser(email);
        if (!user) {
            console.log(`  ${email}: nothing to remove`);
            continue;
        }
        await admin(`/rest/v1/service_providers?owner_id=eq.${user.id}`, { method: 'DELETE' });
        await admin(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'DELETE' });
        await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
        console.log(`  ${email}: removed`);
    }
}

if (args.includes('--reset')) {
    await reset();
} else {
    await run();
}
