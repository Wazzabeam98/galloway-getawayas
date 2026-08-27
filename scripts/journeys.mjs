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
// The stranger who applies. Its own address so the round trip starts from
// nothing every run.
const APPLICANT = `auto-applicant@${AUTO_DOMAIN}`;

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

    console.log('\n--- the whole application round trip ---');
    await applyRoundTrip();

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

    // Note what is NOT sent: `status`. It is revoked from `authenticated`, so a
    // payload mentioning it would be refused — the column default makes this a
    // draft, exactly as the sign-up form now does it.
    const created = await asUser('/rest/v1/service_providers', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            owner_id: ownerId,
            trade: 'plumber',
            business_name: 'AUTO — rls probe',
            contact_email: GUEST,
        }),
    });
    const rows = await created.json();
    if (!Array.isArray(rows) || !rows[0]) {
        record('a provider can create their own draft listing', false, JSON.stringify(rows).slice(0, 140));
        return;
    }
    const id = rows[0].id;
    record('a provider can create their own draft listing', rows[0].status === 'draft', `status=${rows[0].status}`);

    // THE HOLE. Writing as the user with their own token, so the policy and the
    // grants are both genuinely in the path — the service role would bypass
    // them and prove nothing.
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
        nowApproved ? 'they can — the hole is open' : `refused (HTTP ${escalate.status})`
    );

    // Nor any of the other columns the decision owns. A lock that only covers
    // the column somebody thought of is not a lock.
    const sneak = await asUser(`/rest/v1/service_providers?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ approved_digest: 'forged', commission_rate: 0 }),
    });
    const sneakRows = await sneak.json();
    const sneaked = Array.isArray(sneakRows) && sneakRows[0] && sneakRows[0].approved_digest === 'forged';
    record(
        'an owner CANNOT write approved_digest or commission_rate',
        !sneaked,
        sneaked ? 'they can — the digest gate is not trustworthy' : `refused (HTTP ${sneak.status})`
    );

    // THE GRANT LIST MATCHES THE FORM. Every column ProviderSignUp actually
    // sends, written as the user in one go. A column missing from the grant
    // list in 20260829 would break saving in the browser and every other check
    // here would still be green — the lock would be perfect and the door
    // welded shut. Keep this payload in step with `payload` in
    // components/services/ProviderSignUp.tsx.
    const formShaped = await asUser(`/rest/v1/service_providers?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            owner_id: ownerId,
            business_name: 'AUTO — full form payload',
            trade: 'plumber',
            description: 'every column the form sends',
            contact_email: GUEST,
            contact_phone: null,
            audience: 'host',
            photos: [],
            logo: null,
            does_gas: false,
            does_oil: false,
            callout_fee: 45,
            hourly_rate: 30,
            callout_waived: false,
            pricing_choice: null,
            billable_hourly_rate: null,
            covered_bands: [],
            updated_at: new Date().toISOString(),
        }),
    });
    const savedRows = await formShaped.json();
    record(
        'the full sign-up payload still saves',
        formShaped.status < 300,
        formShaped.status < 300
            ? 'every granted column accepted'
            : `HTTP ${formShaped.status}: ${JSON.stringify(savedRows).slice(0, 160)}`
    );

    // THE DOOR STILL OPENS. Without this the checks above would pass just as
    // well if submitting were broken for everybody.
    const submitted = await asUser('/rest/v1/rpc/submit_service_provider', {
        method: 'POST',
        body: JSON.stringify({ p_id: id }),
    });
    const readBack = await asUser(`/rest/v1/service_providers?id=eq.${id}&select=status,submitted_at`);
    const state = await readBack.json();
    const pending = Array.isArray(state) && state[0] && state[0].status === 'pending_review';
    record(
        'a provider CAN still submit, via submit_service_provider',
        pending,
        pending ? 'status=pending_review' : `HTTP ${submitted.status}, status=${state?.[0]?.status}`
    );

    // And the function must refuse a listing that is not theirs.
    const someoneElse = await admin('/rest/v1/service_providers?select=id&limit=1&owner_id=neq.' + ownerId);
    const others = await someoneElse.json();
    if (Array.isArray(others) && others[0]) {
        const stolen = await asUser('/rest/v1/rpc/submit_service_provider', {
            method: 'POST',
            body: JSON.stringify({ p_id: others[0].id }),
        });
        // 404 does not count. Before the migration every call to a function
        // that does not exist is a 404, and "refused" for that reason would be
        // a pass earned by the lock being absent.
        record(
            'submit_service_provider refuses a listing that is not yours',
            stolen.status >= 400 && stolen.status !== 404,
            stolen.status === 404 ? 'function not deployed yet' : `HTTP ${stolen.status}`
        );
    }

    await admin(`/rest/v1/service_providers?id=eq.${id}`, { method: 'DELETE' });
}


/**
 * A stranger applies, and everything that is supposed to happen, happens.
 *
 * This is the path that was broken: the press used to make an account, send a
 * confirmation email and write NOTHING, so an application could be lost with no
 * trace to chase. It now goes through /api/services/apply in one request.
 *
 * It also drives `submit_service_provider`, which until now nothing exercised —
 * neither the unit tests nor this file. The RPC is not on the lodging path (the
 * route is the platform and writes the status itself); it is how a signed-in
 * provider re-submits, so that is what is driven here, on a real session.
 */
async function applyRoundTrip() {
    const stamp = Math.abs(hashOf(HOST + APPLICANT)).toString(36);
    const email = APPLICANT;

    // Start from nothing, so a leftover from a previous run cannot make a
    // failure look like a pass — or a unique constraint make a pass look like a
    // failure, which is exactly what happened once.
    await removeApplicant();

    const res = await fetch(`${HOST}/api/services/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            password: 'auto-harness-' + stamp,
            name: 'AUTO Joinery',
            provider: {
                business_name: 'AUTO Joinery',
                trade: 'joiner',
                description: 'Created by scripts/journeys.mjs.',
                contact_email: email,
                callout_fee: 45,
                hourly_rate: 30,
                // Things a stranger must not be able to decide for themselves.
                status: 'approved',
                approved_digest: 'forged',
                commission_rate: 0,
            },
            areas: [{ label: 'Kirkcudbright', centre_lat: 54.84, centre_lng: -4.05, radius_miles: 10 }],
            registrations: [],
            prices: [],
            extras: [],
            skills: [],
        }),
    });
    const out = await res.json().catch(() => ({}));
    record('an application can be lodged with no account', res.ok && out.ok, `HTTP ${res.status} ${out.error || ''}`);
    if (!out.ok) return;

    // The row exists NOW, not after somebody opens an inbox.
    const { data: rows } = await adminJson(`/rest/v1/service_providers?id=eq.${out.providerId}&select=status,submitted_at,owner_id,approved_digest,commission_rate`);
    const row = rows && rows[0];
    record('the row exists immediately', !!row, row ? `status=${row.status}` : 'missing');
    record('it is lodged, not a draft', row && row.status === 'pending_review', row ? row.status : '—');
    record('the forged columns were dropped', row && row.approved_digest === null, row ? String(row.approved_digest) : '—');

    const { data: areas } = await adminJson(`/rest/v1/service_areas?provider_id=eq.${out.providerId}&select=label`);
    record('its coverage was written too', Array.isArray(areas) && areas.length === 1, `${(areas || []).length} area(s)`);

    // The applicant is real but unverified — which is what the queue badge reads.
    const { users } = await adminJson('/auth/v1/admin/users?per_page=200', true);
    const applicant = (users || []).find((u) => (u.email || '').toLowerCase() === email);
    record('the account exists', !!applicant, applicant ? applicant.id : 'missing');
    record(
        'and is UNVERIFIED, so the badge has something true to say',
        applicant && !applicant.email_confirmed_at && !applicant.confirmed_at,
        applicant && (applicant.email_confirmed_at || applicant.confirmed_at) ? 'already confirmed' : 'unconfirmed'
    );

    // Now the half nothing was exercising. Confirm the address the way opening
    // the link would, take a real session, and re-submit through the RPC.
    const cookie = await sessionCookie(email);
    const { accessToken } = cookie;

    await fetch(`${SUPABASE_URL}/rest/v1/service_providers?id=eq.${out.providerId}`, {
        method: 'PATCH',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Edited by the harness.' }),
    });

    const submitted = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_service_provider`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: out.providerId }),
    });
    const { data: after } = await adminJson(`/rest/v1/service_providers?id=eq.${out.providerId}&select=status,description`);
    record(
        'the provider can edit and re-submit through the RPC',
        submitted.status < 300 && after && after[0] && after[0].description === 'Edited by the harness.',
        `HTTP ${submitted.status}`
    );

    await removeApplicant();
}

function hashOf(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}

async function adminJson(path, raw = false) {
    const res = await admin(path);
    const body = await res.json().catch(() => null);
    return raw ? body : { data: body };
}

async function removeApplicant() {
    const { users } = await adminJson('/auth/v1/admin/users?per_page=200', true);
    const found = (users || []).find((u) => (u.email || '').toLowerCase() === APPLICANT);
    if (!found) return;
    const { data: theirs } = await adminJson(`/rest/v1/service_providers?owner_id=eq.${found.id}&select=id`);
    for (const p of theirs || []) {
        await admin(`/rest/v1/service_areas?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await admin(`/rest/v1/service_providers?id=eq.${p.id}`, { method: 'DELETE' });
    }
    await admin(`/rest/v1/profiles?id=eq.${found.id}`, { method: 'DELETE' });
    await admin(`/auth/v1/admin/users/${found.id}`, { method: 'DELETE' });
}

/* ----------------------------------------------------------------- reset */

async function reset() {
    await removeApplicant();
    console.log(`  ${APPLICANT}: removed`);
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
