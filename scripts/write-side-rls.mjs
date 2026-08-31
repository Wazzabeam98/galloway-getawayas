// Can a stranger, or an ordinary signed-in user, WRITE what they must not?
//
// scripts/data-privacy-rls.mjs asks the reading question. This asks the other
// half, which nothing has ever asked: INSERT and UPDATE are granted to anon and
// to authenticated on every column of bookings, listings, profiles and reviews
// — 156 columns in all — and nobody has ever checked what that permits.
//
// A grant is not a hole. RLS still stands between the grant and the row, and
// for most of these the policy does refuse. The point of this script is to say
// WHICH, with evidence, rather than reasoning about it from pg_policies and
// hoping the reasoning is right.
//
// ---------------------------------------------------------------------------
// TWO KEYS, TWO ATTACKERS
// ---------------------------------------------------------------------------
//
//   anon         the key compiled into the front end. Anybody who opens
//                devtools has it. auth.uid() is null for this key, so every
//                policy written as `auth.uid() = something` is false and the
//                write should be refused. Should be.
//
//   attacker     an ordinary signed-in account that owns nothing — no listing,
//                no booking, not an admin. The account any visitor can create
//                by signing up. auth.uid() is a real value here, which is what
//                makes it the interesting one.
//
// ---------------------------------------------------------------------------
// THE CANARY, AND WHY EVERY VICTIM ROW IS ONE
// ---------------------------------------------------------------------------
//
// The reading script learned that a check cannot tell "protected" from
// "empty". A writing check has the same problem twice over, and a worse one
// besides: a probe that succeeds has CHANGED PRODUCTION DATA.
//
// So nothing real is ever the target. The script plants its own victim — a
// host, a listing, a booking, a profile with money on it — writes with the
// service role, and points every probe at those. The policy cannot tell a
// canary row from a real one, so the answer is the true answer; but a probe
// that gets through has vandalised a fake cottage, not one of Liam's.
//
// And every refusal is checked against the canary rather than against silence:
// after each probe the row is read back with the service role, and the script
// asserts that it still exists and still holds the value it started with. A
// refusal reported because the row was never there is the failure this whole
// idea exists to prevent.
//
// If a probe DOES get through, the original value is put back immediately and
// the check fails loudly.
//
// ---------------------------------------------------------------------------
// REFUSED HAS TWO SHAPES, AND ONLY ONE OF THEM IS AN ERROR
// ---------------------------------------------------------------------------
//
// A PATCH that RLS filters out is not an error. PostgREST returns 200 and an
// empty array, because the UPDATE matched no rows — the same response as
// patching a row that does not exist. A check that only looked at res.ok would
// call that a pass without ever knowing whether it wrote something.
//
// So a refusal is only recorded once the value has been read back and found
// unchanged. Both shapes are reported by name:
//
//   refused by the grant   401 / 403 / 42501 — the key may not touch the column
//   refused by RLS         no error, no rows, value unchanged
//
// Usage:
//   node scripts/write-side-rls.mjs --target prod
//   node scripts/write-side-rls.mjs --target prod --keep    (leave the canary)

import { loadEnv } from './seed-lib.mjs';

const PROD_REF = 'hviwjxigqivjfhmhpjiy';
const TEST_REF = 'yefoqcabuijcowoqewtc';

const args = process.argv.slice(2);
const targetName = (args.includes('--target') && args[args.indexOf('--target') + 1]) || 'test';
const keep = args.includes('--keep');

// data-privacy-rls.mjs takes `--target prod` and then reads .env.local anyway,
// which points at TEST — so that script has never once run against production
// despite the flag. Named in SECURITY-WRITE-AUDIT.md. This one loads the file
// that belongs to the target and then checks the URL really is that project,
// so the flag cannot lie.
const ENV_FILE = { prod: '.env.production.local', test: '.env.local' }[targetName];
if (!ENV_FILE) {
    console.error('unknown --target "' + targetName + '". It is test or prod.');
    process.exit(1);
}

const env = loadEnv(ENV_FILE);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const wantRef = targetName === 'prod' ? PROD_REF : TEST_REF;
const otherRef = targetName === 'prod' ? TEST_REF : PROD_REF;

if (!URL_BASE || !ANON || !SERVICE) {
    console.error('refusing to run: ' + ENV_FILE + ' is missing a URL, an anon key or a service key');
    process.exit(1);
}
if (URL_BASE.includes(otherRef) || !URL_BASE.includes(wantRef)) {
    console.error('refusing to run: ' + ENV_FILE + ' does not point at the ' + targetName + ' project');
    process.exit(1);
}

// Everything the script creates carries this, so cleanup can find it again and
// a human reading the row knows what it is at a glance.
const TAG = 'gg-write-audit';
const CANARY_TITLE = 'CANARY — write audit, not a real cottage';

let passed = 0;
let failed = 0;
const results = [];

const ok = (name, how) => {
    passed++;
    results.push({ name, verdict: 'refused', how });
    console.log('  ✓ ' + name + (how ? '  (' + how + ')' : ''));
};
const bad = (name, detail) => {
    failed++;
    results.push({ name, verdict: 'WRITABLE', how: detail });
    console.log('  ✗ ' + name + '\n      ' + detail);
};
const note = (line) => console.log('  – ' + line);

/* --------------------------------------------------------------- the keys */

// The apikey header and the Authorization header are NOT the same thing, and
// conflating them is how the first run of this script reported twenty-one
// refusals it had not earned.
//
// Supabase wants the PROJECT key in `apikey` always, and whoever is acting in
// `Authorization`. Passing a user's JWT as the apikey gets "Invalid API key" —
// a 401, which reads exactly like a refusal and is nothing of the kind. Every
// signed-in probe passed that way, and every one of them was the gateway
// turning the request away before RLS was ever consulted.
//
// So `who` carries both, and the anon case is the one where they coincide.
async function rest(who, method, path, body, extraHeaders) {
    const token = typeof who === 'string' ? who : who.token;
    const headers = {
        apikey: ANON,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        // MINIMAL, NOT REPRESENTATION.
        //
        // `return=representation` makes PostgREST SELECT the row back after
        // writing it, so the write needs SELECT as well as UPDATE. Since
        // 20260828234003 revoked table-level SELECT on profiles, asking for the
        // representation gets 42501 "permission denied for table profiles" —
        // which is the READ grant refusing, not the write policy. The second
        // run of this script mistook that for a refusal on every profile probe.
        //
        // An attacker does not need the row back. Nothing here asks for it, and
        // every verdict comes from reading the value again with the service
        // role, which is the only reader that cannot be fooled.
        Prefer: 'return=minimal',
        ...(extraHeaders || {}),
    };
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

// The service role is not subject to any of this. It is used ONLY to plant the
// canary, to read values back, and to put anything back that a probe managed
// to change. It never stands in for an attacker.
async function serviceRest(method, path, body) {
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers: {
            apikey: SERVICE,
            Authorization: 'Bearer ' + SERVICE,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

const svc = {
    select: (p) => serviceRest('GET', p),
    insert: (t, rows) => serviceRest('POST', '/' + t, rows),
    patch: (t, q, patch) => serviceRest('PATCH', '/' + t + q, patch),
    del: (t, q) => serviceRest('DELETE', '/' + t + q),
};

async function adminAuth(method, endpoint, body) {
    const res = await fetch(URL_BASE + '/auth/v1' + endpoint, {
        method,
        headers: {
            apikey: SERVICE,
            Authorization: 'Bearer ' + SERVICE,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) throw new Error(method + ' ' + endpoint + ': ' + text.slice(0, 300));
    return parsed;
}

function dayOffset(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

/* ------------------------------------------------------------- the canary */

// Numbers chosen to be unmistakable in a database. If any of these ever turn
// up on a real row, something in this script pointed at the wrong place.
const CANARY = {
    payoutOwed: 4242.42,
    commission: 0.11,
    price: 137.00,
    total: 548.00,
    payout: 999.99,
};

const state = {
    victimId: null,      // owns the listing and hosts the booking
    attackerId: null,    // an ordinary account that owns nothing
    listingId: null,
    bookingId: null,
    attackerToken: null,
    created: { users: [], listings: [], bookings: [], reviews: [] },
};

async function ensureUser(email) {
    // Deleted and recreated each run, so a half-finished previous run cannot
    // leave a stale password behind and fail the sign-in for reasons that have
    // nothing to do with the thing being tested.
    const existing = await adminAuth('GET', '/admin/users?page=1&per_page=200');
    const users = (existing && existing.users) || [];
    for (const u of users) {
        if (u.email === email) await adminAuth('DELETE', '/admin/users/' + u.id);
    }
    const made = await adminAuth('POST', '/admin/users', {
        email,
        password: 'canary-' + TAG + '-Aa1!',
        email_confirm: true,
    });
    state.created.users.push(made.id);
    return made.id;
}

async function plantCanary() {
    state.victimId = await ensureUser('victim@' + TAG + '.test');
    state.attackerId = await ensureUser('attacker@' + TAG + '.test');

    // add_profile_for_new_user fires on signup, so the rows exist. Give the
    // victim something worth stealing and make sure neither is an admin, so
    // "flipped is_admin" cannot be confused with "was already true".
    await svc.patch('profiles', '?id=eq.' + state.victimId, {
        payout_balance_owed: CANARY.payoutOwed,
        is_admin: false,
    });
    await svc.patch('profiles', '?id=eq.' + state.attackerId, { is_admin: false });

    // DRAFT on purpose. A published canary would appear on the live site next
    // to four real cottages. Draft is invisible to visitors and the write
    // policies do not read status, so it tests exactly the same rule.
    const listing = await svc.insert('listings', [{
        host_id: state.victimId,
        title: CANARY_TITLE,
        location: 'Nowhere, Dumfries and Galloway',
        price_per_night: CANARY.price,
        commission_rate: CANARY.commission,
        status: 'draft',
    }]);
    if (!listing.ok || !listing.body || !listing.body[0]) {
        throw new Error('could not plant the canary listing: ' + JSON.stringify(listing.body).slice(0, 300));
    }
    state.listingId = listing.body[0].id;
    state.created.listings.push(state.listingId);

    // A finished stay, three days ago. Finished because the review probe needs
    // a booking inside the 14-day window that check_review_window allows —
    // otherwise a refusal would be the trigger's calendar rule talking, not the
    // policy, and the script would credit RLS for something it did not do.
    const booking = await svc.insert('bookings', [{
        listing_id: state.listingId,
        host_id: state.victimId,
        guest_id: state.victimId,
        check_in: dayOffset(-6),
        check_out: dayOffset(-3),
        total_price: CANARY.total,
        status: 'confirmed',
        payment_status: 'unpaid',
        payout_amount: CANARY.payout,
    }]);
    if (!booking.ok || !booking.body || !booking.body[0]) {
        throw new Error('could not plant the canary booking: ' + JSON.stringify(booking.body).slice(0, 300));
    }
    state.bookingId = booking.body[0].id;
    state.created.bookings.push(state.bookingId);

    // The attacker signs in the way anybody signs in, with the anon key.
    const res = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'attacker@' + TAG + '.test',
            password: 'canary-' + TAG + '-Aa1!',
        }),
    });
    const session = await res.json();
    if (!session.access_token) {
        throw new Error('the attacker could not sign in: ' + JSON.stringify(session).slice(0, 300));
    }
    state.attackerToken = session.access_token;
}

async function removeCanary() {
    // Reviews first, then bookings, then listings — foreign keys point that
    // way, and a failed cleanup that leaves a canary cottage on production is
    // worse than a failed test.
    for (const id of state.created.reviews) await svc.del('reviews', '?id=eq.' + id);
    await svc.del('reviews', '?booking_id=eq.' + state.bookingId);
    for (const id of state.created.bookings) await svc.del('bookings', '?id=eq.' + id);
    for (const id of state.created.listings) await svc.del('listings', '?id=eq.' + id);
    for (const id of state.created.users) {
        try { await adminAuth('DELETE', '/admin/users/' + id); } catch { /* profile cascade */ }
    }
}

/* ------------------------------------------------------------ the probes */

// One update probe. Reads the value first, tries to change it as `who`, then
// reads it back with the service role and decides from what actually happened
// rather than from the status code.
async function probeUpdate({ name, who, key, table, id, column, to }) {
    const before = await svc.select('/' + table + '?id=eq.' + id + '&select=' + column);
    if (!before.ok || !before.body || !before.body.length) {
        bad(name, 'THE CANARY IS MISSING — ' + table + '.' + id + ' did not come back, '
            + 'so a refusal here would prove nothing');
        return;
    }
    const original = before.body[0][column];

    const attempt = await rest(key, 'PATCH', '/' + table + '?id=eq.' + id, { [column]: to });

    const after = await svc.select('/' + table + '?id=eq.' + id + '&select=' + column);
    const now = after.ok && after.body && after.body.length ? after.body[0][column] : undefined;
    const changed = String(now) !== String(original);

    if (changed) {
        // Put it straight back before saying anything. This is production.
        await svc.patch(table, '?id=eq.' + id, { [column]: original });
        bad(name, who + ' changed ' + table + '.' + column
            + ' from ' + JSON.stringify(original) + ' to ' + JSON.stringify(now)
            + ' (HTTP ' + attempt.status + '). Reverted.');
        return;
    }

    if (!attempt.ok) {
        const code = attempt.body && attempt.body.code ? attempt.body.code : attempt.status;
        ok(name, 'refused by the grant — ' + code);
    } else {
        const rows = Array.isArray(attempt.body) ? attempt.body.length : 0;
        ok(name, rows === 0 ? 'refused by RLS — no row matched' : 'value unchanged');
    }
}

// One insert probe. Nothing is believed from the response — the service role
// goes and looks for the row afterwards, and deletes it if it is there.
async function probeInsert({ name, who, key, table, row, find, tellTale }) {
    const attempt = await rest(key, 'POST', '/' + table, [row]);

    const sweep = await svc.select('/' + table + find + '&select=id');
    const landed = sweep.ok && Array.isArray(sweep.body) ? sweep.body : [];

    if (landed.length) {
        for (const r of landed) await svc.del(table, '?id=eq.' + r.id);
        bad(name, who + ' inserted a row into ' + table
            + (tellTale ? ' — ' + tellTale : '')
            + ' (HTTP ' + attempt.status + '). Deleted again.');
        return;
    }

    if (!attempt.ok) {
        const code = attempt.body && attempt.body.code ? attempt.body.code : attempt.status;
        const msg = attempt.body && attempt.body.message ? ' ' + attempt.body.message : '';
        ok(name, 'refused — ' + code + msg.slice(0, 90));
    } else {
        // A 2xx with no row is PostgREST reporting that the statement ran and
        // RLS filtered every row out of it.
        ok(name, 'refused by RLS — accepted, wrote nothing (' + attempt.status + ')');
    }
}


// Whether a browser role is REFUSED a delete outright, rather than being
// answered 204 and quietly matching nothing.
//
// The distinction is the whole point of this probe. Before the grant sweep on
// 29 August, `anon` and `authenticated` held DELETE on every table in the
// schema, including payments, payouts and bookings. Nothing could actually be
// deleted, because row level security had no DELETE policy on those tables —
// so PostgREST answered 204 No Content and removed nothing, and every probe
// that only asked "did a row disappear" scored it as safe.
//
// It was not safe. It was one permissive `for all` policy away from working,
// silently, on the money tables. So this asserts on the REFUSAL, not on the
// survival of the row: a 204 here is a failure even though nothing was lost.
async function probeDeleteRefused({ name, who, key, table, filter }) {
    // A token, not a label. Passing the string 'anon' here sends
    // `Authorization: Bearer anon`, PostgREST answers PGRST301 for a malformed
    // JWT, and every probe below scores a ✓ for a request that never reached
    // the table. That is exactly what the first version of this section did,
    // and the negative control caught it — re-granting DELETE on payments
    // changed nothing, because nothing was being tested.
    if (!key || key.length < 40) {
        bad(name, 'the probe was handed "' + key + '" instead of a token — it tested nothing');
        return;
    }

    const before = await svc.select('/' + table + '?select=id&limit=200');
    const countBefore = before.ok && Array.isArray(before.body) ? before.body.length : null;

    const attempt = await rest(key, 'DELETE', '/' + table + (filter || '?id=neq.' + NIL_UUID));

    const after = await svc.select('/' + table + '?select=id&limit=200');
    const countAfter = after.ok && Array.isArray(after.body) ? after.body.length : null;

    if (countBefore !== null && countAfter !== null && countAfter < countBefore) {
        bad(name, who + ' DELETED ' + (countBefore - countAfter) + ' row(s) from ' + table
            + ' (HTTP ' + attempt.status + '). They are gone — this probe cannot put them back.');
        return;
    }

    if (attempt.status === 401 || attempt.status === 403) {
        const code = attempt.body && attempt.body.code ? attempt.body.code : attempt.status;
        ok(name, 'refused by the grant — ' + code);
        return;
    }

    // A 400 is PostgREST rejecting the SHAPE of the request — usually a filter
    // naming a column the target does not have. That is the probe being wrong,
    // not the database being safe, and it must not be scored either way.
    // Caught by pointing this at listing_busy_nights, which has no `id`.
    if (attempt.status === 400) {
        bad(name, 'the probe sent a request ' + table + ' could not parse ('
            + ((attempt.body && attempt.body.message) || '400').slice(0, 80)
            + '). It tested nothing — fix the filter.');
        return;
    }

    // Nothing was lost, and that is not the same as being refused.
    bad(name, who + ' was ANSWERED ' + attempt.status + ' on ' + table
        + ' rather than refused. Nothing was deleted, because no DELETE policy '
        + 'matched — but the grant is there, so the next permissive policy on '
        + 'this table makes it work, silently.');
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';


// Whether the public bucket will take something that is not an image, or is
// absurdly large.
//
// The overnight audit uploaded an arbitrary file to the publicly readable
// `listings` bucket from an ordinary free account: no size limit, no MIME
// allowlist, and an INSERT policy of `bucket_id = 'listings'`. Overwrite and
// delete were already refused, so the loss was cost and abuse rather than a
// host's photos — which is exactly the kind of finding that gets deprioritised
// and then quietly reverted by somebody clearing a bucket setting.
//
// Uploads what it can and deletes anything that lands, with the service role,
// before saying anything.
async function probeUploadRefused({ name, key, filename, contentType, bytes }) {
    const path = 'probe-' + filename;
    const res = await fetch(URL_BASE + '/storage/v1/object/listings/' + path, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: 'Bearer ' + key, 'Content-Type': contentType },
        body: Buffer.alloc(bytes, 1),
    });

    if (res.ok) {
        await fetch(URL_BASE + '/storage/v1/object/listings/' + path, {
            method: 'DELETE',
            headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
        });
        bad(name, 'it was accepted (HTTP ' + res.status + ') and has been deleted again');
        return;
    }

    let why = String(res.status);
    try {
        const body = await res.json();
        why = (body && (body.error || body.message)) || why;
    } catch { /* not JSON */ }
    ok(name, 'refused — ' + String(why).slice(0, 60));
}

/* ---------------------------------------------------------------- the run */

async function run() {
    console.log('\n  WRITE-SIDE REFUSALS — against '
        + (targetName === 'prod' ? 'PRODUCTION' : 'test')
        + ', ' + URL_BASE.replace(/https:\/\/([a-z]+)\..*/, '$1') + '\n');

    if (targetName !== 'prod') {
        note('test and production have diverged on grants. A pass here proves');
        note('nothing about the live site. Run with --target prod.\n');
    }

    await plantCanary();
    console.log('  canary planted — a host, a draft listing, a finished booking,');
    console.log('  £' + CANARY.payoutOwed + ' owed on the victim profile, and an');
    console.log('  ordinary account that owns nothing\n');

    const A = { who: 'a stranger', key: ANON };
    const U = { who: 'an ordinary signed-in user', key: state.attackerToken };

    // ---- BEFORE ANY OF IT: are these two keys actually working? -------------
    //
    // The first run of this script reported twenty-one refusals and zero
    // findings. Every signed-in one was "401 Invalid API key" — the gateway
    // rejecting a malformed request before RLS was consulted at all. A refusal
    // that never reached the policy is not evidence about the policy.
    //
    // So each key must first be seen DOING something it is entitled to do. If
    // a key cannot pass this, nothing below it means anything and the script
    // stops rather than printing a screenful of ticks it has not earned.
    console.log('  first, proof that both keys work at all');

    const anonAlive = await rest(ANON, 'GET', '/listings?select=id&status=eq.published&limit=1');
    if (!anonAlive.ok) {
        throw new Error('the anon key cannot read published listings (' + anonAlive.status
            + '). Every "refusal" below would be this, not RLS.');
    }
    ok('the anon key reads published listings', 'so its refusals are refusals');

    // The attacker updating their OWN display name is squarely inside "Users
    // can update own profile". If this cannot get through, the token is not
    // being accepted and every signed-in probe is meaningless.
    const selfWrite = await rest(state.attackerToken, 'PATCH',
        '/profiles?id=eq.' + state.attackerId, { full_name: 'Canary Attacker' });
    const selfBack = await svc.select('/profiles?id=eq.' + state.attackerId + '&select=full_name');
    const selfOk = selfBack.ok && selfBack.body && selfBack.body.length
        && selfBack.body[0].full_name === 'Canary Attacker';
    if (!selfOk) {
        throw new Error('the signed-in token could not update its own full_name ('
            + selfWrite.status + ' ' + JSON.stringify(selfWrite.body).slice(0, 200)
            + '). Every "refusal" below would be this, not RLS.');
    }
    ok('the signed-in token writes its own full_name', 'so its refusals are refusals');
    console.log('');

    // ---- can a stranger write at all? --------------------------------------
    console.log('  a stranger, with the key from the front end');

    await probeInsert({
        name: 'stranger cannot insert a booking', ...A, table: 'bookings',
        row: {
            listing_id: state.listingId, host_id: state.victimId, guest_id: state.victimId,
            check_in: dayOffset(200), check_out: dayOffset(203), total_price: 0,
            status: 'confirmed', payment_status: 'paid',
        },
        find: '?check_in=eq.' + dayOffset(200) + '&listing_id=eq.' + state.listingId,
        tellTale: 'a free confirmed stay',
    });

    await probeInsert({
        name: 'stranger cannot insert a listing', ...A, table: 'listings',
        row: {
            host_id: state.victimId, title: CANARY_TITLE + ' (stranger)',
            location: 'Nowhere', price_per_night: 1, status: 'published',
        },
        find: '?title=eq.' + encodeURIComponent(CANARY_TITLE + ' (stranger)'),
        tellTale: 'a published listing under another host',
    });

    await probeInsert({
        name: 'stranger cannot insert a profile', ...A, table: 'profiles',
        row: { id: '00000000-0000-4000-8000-00000000dead', is_admin: true },
        find: '?id=eq.00000000-0000-4000-8000-00000000dead',
        tellTale: 'an admin profile',
    });

    await probeUpdate({
        name: "stranger cannot change a listing's price", ...A,
        table: 'listings', id: state.listingId, column: 'price_per_night', to: 1,
    });
    await probeUpdate({
        name: 'stranger cannot mark a booking paid', ...A,
        table: 'bookings', id: state.bookingId, column: 'payment_status', to: 'paid',
    });
    await probeUpdate({
        name: 'stranger cannot alter commission_rate', ...A,
        table: 'listings', id: state.listingId, column: 'commission_rate', to: 0,
    });
    await probeUpdate({
        name: 'stranger cannot set payout_balance_owed', ...A,
        table: 'profiles', id: state.victimId, column: 'payout_balance_owed', to: 0,
    });
    await probeUpdate({
        name: 'stranger cannot flip is_admin', ...A,
        table: 'profiles', id: state.victimId, column: 'is_admin', to: true,
    });
    await probeUpdate({
        name: 'stranger cannot set payout_amount', ...A,
        table: 'bookings', id: state.bookingId, column: 'payout_amount', to: 99999,
    });
    await probeUpdate({
        name: "stranger cannot change a booking's status", ...A,
        table: 'bookings', id: state.bookingId, column: 'status', to: 'cancelled',
    });

    // ---- an ordinary account, against somebody else's rows ------------------
    console.log("\n  an ordinary signed-in user, against somebody else's rows");

    await probeUpdate({
        name: "user cannot change another host's listing price", ...U,
        table: 'listings', id: state.listingId, column: 'price_per_night', to: 1,
    });
    await probeUpdate({
        name: "user cannot alter another host's commission_rate", ...U,
        table: 'listings', id: state.listingId, column: 'commission_rate', to: 0,
    });
    await probeUpdate({
        name: "user cannot mark someone else's booking paid", ...U,
        table: 'bookings', id: state.bookingId, column: 'payment_status', to: 'paid',
    });
    await probeUpdate({
        name: "user cannot change status on someone else's booking", ...U,
        table: 'bookings', id: state.bookingId, column: 'status', to: 'cancelled',
    });
    await probeUpdate({
        name: "user cannot set payout_amount on someone else's booking", ...U,
        table: 'bookings', id: state.bookingId, column: 'payout_amount', to: 99999,
    });
    await probeUpdate({
        name: "user cannot set another profile's payout_balance_owed", ...U,
        table: 'profiles', id: state.victimId, column: 'payout_balance_owed', to: 0,
    });
    await probeUpdate({
        name: "user cannot flip another profile's is_admin", ...U,
        table: 'profiles', id: state.victimId, column: 'is_admin', to: true,
    });

    // ---- an ordinary account, against its OWN rows --------------------------
    //
    // The half nobody thinks to ask. "Users can update own profile" reads like
    // a safe rule, and the question it never answers is WHICH COLUMNS.
    console.log('\n  an ordinary signed-in user, against their own row');

    await probeUpdate({
        name: 'user cannot make themselves an admin', ...U,
        table: 'profiles', id: state.attackerId, column: 'is_admin', to: true,
    });
    await probeUpdate({
        name: 'user cannot set what they are owed', ...U,
        table: 'profiles', id: state.attackerId, column: 'payout_balance_owed', to: 5000,
    });

    // A booking they own outright, inserted by them, priced by them.
    await probeInsert({
        name: 'user cannot insert a booking already marked paid', ...U, table: 'bookings',
        row: {
            listing_id: state.listingId, host_id: state.victimId, guest_id: state.attackerId,
            check_in: dayOffset(210), check_out: dayOffset(213), total_price: 0,
            status: 'confirmed', payment_status: 'paid',
        },
        find: '?check_in=eq.' + dayOffset(210) + '&guest_id=eq.' + state.attackerId,
        tellTale: 'a confirmed, paid, £0 stay in somebody else’s cottage',
    });

    // ---- a review for a stay that did not happen ----------------------------
    console.log('\n  a review for a stay that did not happen');

    // The canary booking belongs to the victim, start to finish. The attacker
    // was never on it. check_review_window will allow the dates — the stay
    // finished three days ago — so anything that gets through got through on
    // ownership, which is the question.
    const review = await rest(state.attackerToken, 'POST', '/reviews', [{
        booking_id: state.bookingId,
        reviewer_id: state.attackerId,
        reviewee_id: state.victimId,
        review_type: 'guest_to_host',
        rating: 1,
        comment: 'CANARY — write audit. This reviewer was never on this booking.',
    }]);

    const sweep = await svc.select('/reviews?booking_id=eq.' + state.bookingId
        + '&reviewer_id=eq.' + state.attackerId + '&select=id');
    const landed = sweep.ok && Array.isArray(sweep.body) ? sweep.body : [];

    if (landed.length) {
        for (const r of landed) await svc.del('reviews', '?id=eq.' + r.id);
        bad('user cannot review a stay that was not theirs',
            'the review was accepted for a booking the reviewer has no part in '
            + '(HTTP ' + review.status + '). Deleted again.');
    } else {
        const code = review.body && review.body.code ? review.body.code : review.status;
        const msg = review.body && review.body.message ? ' ' + review.body.message : '';
        ok('user cannot review a stay that was not theirs', 'refused — ' + code + msg.slice(0, 80));
    }

    // ---- the functions a stranger may call ----------------------------------
    //
    // Not a table write, but the same question. Four SECURITY DEFINER routines
    // are executable by anon, which means anybody with the front-end key can
    // run them. Each carries its own time guard; this asks whether calling one
    // does anything a caller should not be able to cause.
    console.log('\n  the SECURITY DEFINER routines a stranger may call');

    for (const fn of ['expire_unpaid_bookings', 'publish_expired_reviews']) {
        const r = await rest(ANON, 'POST', '/rpc/' + fn, {});
        if (r.ok) {
            note(fn + ' — a stranger CAN call it (HTTP ' + r.status + '). '
                + 'It carries its own time guard, so it does only what the cron does.');
        } else {
            ok('stranger cannot call ' + fn, 'refused — ' + r.status);
        }
    }

    // ---- the whole chain, from nothing --------------------------------------
    //
    // Everything above used an account the service role created. That is a
    // fair test of the policy and an unfair test of the risk: it skips the
    // question of whether an outsider can GET such an account.
    //
    // So this does the entire thing the way a stranger would — public signup
    // with the front-end key, no invitation, no approval — and then asks for
    // the admin bit. If this passes end to end, "an ordinary user can make
    // themselves an admin" is really "anybody at all can", and the distance
    // between a stranger and the commission screen is one signup form.
    console.log('\n  the whole chain, starting from nothing');

    const chainEmail = 'chain@' + TAG + '.test';
    let chainId = null;
    try {
        const signup = await fetch(URL_BASE + '/auth/v1/signup', {
            method: 'POST',
            headers: { apikey: ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: chainEmail, password: 'canary-' + TAG + '-Aa1!' }),
        });
        const made = await signup.json();

        // /auth/v1/signup returns the USER OBJECT ITSELF, not { user }. Reading
        // made.user.id gets undefined on a signup that worked perfectly, and
        // the first version of this probe reported "signup refused — 200" on
        // the strength of it: a contradiction in its own sentence, and one more
        // false refusal in a script written to find them.
        chainId = made && made.id;

        if (!chainId) {
            ok('a stranger cannot sign themselves up',
                'signup refused — ' + signup.status + ' ' + JSON.stringify(made).slice(0, 120));
        } else {
            state.created.users.push(chainId);
            note('LINK 1 — signed up with the front-end key alone. No invitation, no approval.');

            // Link two is the address. Supabase sends a confirmation mail and
            // withholds the session until it is clicked, so the attacker needs
            // a mailbox — any mailbox, one they own.
            //
            // This script cannot receive mail at a .test domain, so the service
            // role marks the address confirmed instead. THAT IS NOT A BYPASS
            // AND MUST NOT BE READ AS ONE: it stands in for the attacker
            // opening their own inbox and clicking the link. Confirming an
            // address you control is not a security control — it costs a real
            // attacker nothing and about ten seconds. The link is recorded as
            // present rather than waved away, so the report can say honestly
            // that there is a step here and how much it is worth.
            let token = made.access_token;
            if (!token) {
                note('LINK 2 — a confirmation mail is required. Standing in for the '
                    + 'attacker\'s own inbox by confirming the address.');
                await adminAuth('PUT', '/admin/users/' + chainId, { email_confirm: true });
                const si = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
                    method: 'POST',
                    headers: { apikey: ANON, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: chainEmail, password: 'canary-' + TAG + '-Aa1!' }),
                });
                const sj = await si.json();
                token = sj.access_token;
            }

            if (!token) {
                ok('a fresh signup cannot reach the admin bit', 'no session could be obtained');
            } else {
                note('LINK 3 — signed in. Now asking for the admin bit.');
                await rest(token, 'PATCH', '/profiles?id=eq.' + chainId, { is_admin: true });
                const back = await svc.select('/profiles?id=eq.' + chainId + '&select=is_admin');
                const isAdmin = back.ok && back.body && back.body.length && back.body[0].is_admin === true;

                if (isAdmin) {
                    await svc.patch('profiles', '?id=eq.' + chainId, { is_admin: false });
                    bad('a stranger cannot become an admin from a standing start',
                        'public signup, confirm an address they own, then set is_admin = true '
                        + 'on their own profile. is_admin is the whole of what the '
                        + 'admin commission route checks before setting '
                        + 'commission_rate on ANY listing. Reverted.');
                } else {
                    ok('a stranger cannot become an admin from a standing start',
                        'the profile stayed is_admin = false');
                }
            }
        }
    } catch (err) {
        note('the chain probe could not run: ' + (err && err.message));
    }

    /* ------------------------------------------------------------- summary */

    // ------------------------------------------------------------------
    // Deletes. Added after the grant sweep of 29 August 2026, which found
    // DELETE and TRUNCATE granted to both browser roles on every table in the
    // schema — the Supabase default, never asked for, and load-bearing on
    // nothing.
    // ------------------------------------------------------------------
    console.log('\n  deleting things nobody should be able to delete');

    for (const table of ['payments', 'payouts', 'bookings', 'listings', 'profiles', 'error_log']) {
        await probeDeleteRefused({
            name: 'a signed-out stranger cannot delete from ' + table,
            ...A, table,
        });
        await probeDeleteRefused({
            name: 'an ordinary signed-in user cannot delete from ' + table,
            ...U, table,
        });
    }

    // The views were missed by the first pass of that sweep, because the table
    // list came from pg_tables and views are not in it. All three are
    // auto-updatable, so a delete against one propagates to the table beneath.
    // A signed-in user deleted their own profiles row through profile_private
    // AFTER every table-level revoke was in place.
    // Each with a filter naming a column that view actually has — a 400 for a
    // missing `id` would look like a refusal to a careless reading.
    for (const [view, filter] of [
        ['profile_private', '?id=neq.' + NIL_UUID],
        ['service_provider_own_contacts', '?id=neq.' + NIL_UUID],
        ['listing_busy_nights', '?listing_id=neq.' + NIL_UUID],
    ]) {
        await probeDeleteRefused({
            name: 'nobody can delete through the ' + view + ' view',
            ...U, table: view, filter,
        });
    }

    // ------------------------------------------------------------------
    // Storage. The bucket is public and anybody signed in may add to it, which
    // is correct — a host uploads their own photos. What it must not take is
    // anything that is not an image, or anything enormous.
    // ------------------------------------------------------------------
    console.log('\n  putting things in the public bucket that do not belong there');

    await probeUploadRefused({
        name: 'the public bucket refuses an HTML file',
        key: state.attackerToken,
        filename: Date.now() + '.html',
        contentType: 'text/html',
        bytes: 4096,
    });

    await probeUploadRefused({
        name: 'the public bucket refuses something enormous',
        key: state.attackerToken,
        filename: Date.now() + '.jpg',
        contentType: 'image/jpeg',
        bytes: 20 * 1024 * 1024,
    });

    console.log('\n  ' + passed + ' refused, ' + failed + ' WRITABLE\n');

    if (failed) {
        console.log('  writable:');
        for (const r of results.filter((x) => x.verdict === 'WRITABLE')) {
            console.log('    · ' + r.name);
        }
        console.log('');
    }

    return failed;
}

let code = 1;
try {
    code = await run();
} catch (err) {
    console.error('\n  the probe itself failed: ' + (err && err.message) + '\n');
    code = 1;
} finally {
    if (keep) {
        console.log('  --keep: the canary is still there. Rows tagged "' + CANARY_TITLE + '".');
    } else {
        await removeCanary();
        console.log('  canary removed\n');
    }
}

process.exit(code ? 1 : 0);
