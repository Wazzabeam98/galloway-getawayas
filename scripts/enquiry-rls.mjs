// Does the database actually refuse what the browser must not do?
//
// WHY A SCRIPT AND NOT A TEST
//
// Every rule below lives in Postgres — column grants and row-level security —
// and none of it is reachable from a unit test, which has no database and no
// session. The suite can assert that `contactReleased` returns true for one
// status; it cannot assert that a host who edits the request in devtools is
// refused. Only a real access token against PostgREST can, which is the same
// reason scripts/inbox-scenarios.mjs exists.
//
// WHAT IT IS CHECKING, AND WHY THAT AND NOT SOMETHING ELSE
//
// The whole flow rests on two claims. An accept is the only route to a phone
// number, and a host cannot manufacture one. Both are enforced by grants
// rather than by any code path, so both are invisible to every other kind of
// test in this repo — and a grant that silently stops applying looks exactly
// like a grant that is working.
//
// Every check is written as "this must be REFUSED". A pass here means the
// database said no.
//
// Makes its own accounts on @gallowayrls.test, which is a reserved TLD, so
// nothing it creates can be emailed and the payment seeder's reset never
// touches it. Cleans up after itself; --reset clears an interrupted run.
//
// Usage:
//   node scripts/enquiry-rls.mjs
//   node scripts/enquiry-rls.mjs --reset

import { loadEnv, supabaseClient, signIn, TEST_PROJECT_REF } from './seed-lib.mjs';

const DOMAIN = 'gallowayrls.test';
const PASSWORD = 'rls-password-';

const env = loadEnv();

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project');
    process.exit(1);
}

const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log('  ✓ ' + name); }
function bad(name, detail) { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }

// A request made exactly as the browser makes it: the user's own token, with
// row-level security and the column grants in force.
async function asUser(token, method, pathAndQuery, body, prefer) {
    const headers = {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;

    const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1' + pathAndQuery, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

// The signed-out case, which is what an attacker actually has.
async function asAnon(method, pathAndQuery, body) {
    const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1' + pathAndQuery, {
        method,
        headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

function refused(result) {
    // 401/403 is the grant or the policy. A 200 that wrote nothing is PostgREST
    // reporting an RLS filter that matched no rows, which is also a refusal.
    if (result.status === 401 || result.status === 403) return true;
    if (result.status >= 400) return true;
    if (Array.isArray(result.body) && result.body.length === 0) return true;
    return false;
}

async function clear() {
    const { users } = await db.auth('GET', '/admin/users?per_page=200');
    const mine = (users || []).filter((u) => String(u.email || '').endsWith('@' + DOMAIN));

    for (const u of mine) {
        const providers = await db.select('service_providers', '?owner_id=eq.' + u.id + '&select=id');
        for (const p of providers) await db.remove('service_enquiries', '?provider_id=eq.' + p.id);
        await db.remove('service_enquiries', '?host_id=eq.' + u.id);
        await db.remove('service_providers', '?owner_id=eq.' + u.id);
        await db.auth('DELETE', '/admin/users/' + u.id);
    }
    if (mine.length) console.log('  cleared ' + mine.length + ' account(s)');
}

async function makeUser(label) {
    const email = label + '@' + DOMAIN;
    const user = await db.auth('POST', '/admin/users', {
        email, password: PASSWORD + label, email_confirm: true,
    });
    return { id: user.id, email, password: PASSWORD + label };
}

async function run() {
    await clear();

    const host = await makeUser('host');
    const other = await makeUser('other');
    const owner = await makeUser('owner');

    const [provider] = await db.insert('service_providers', [{
        owner_id: owner.id,
        business_name: 'RLS Plumbing',
        trade: 'plumber',
        audience: 'host',
        status: 'approved',
        contact_email: 'rls@' + DOMAIN,
        contact_phone: '01557 555 0000',
    }]);

    const hostToken = (await signIn(env, host.email, host.password)).session.access_token;
    const otherToken = (await signIn(env, other.email, other.password)).session.access_token;
    const ownerToken = (await signIn(env, owner.email, owner.password)).session.access_token;

    const base = {
        host_id: host.id,
        provider_id: provider.id,
        trade: 'plumber',
        business_name: 'RLS Plumbing',
        urgency: 'soon',
        summary: 'No hot water since Sunday, combi boiler.',
        host_name: 'A Host',
        host_phone: '07700900123',
        host_email: host.email,
    };

    console.log('\n  A host writing straight to the table');

    // THE BROWSER CANNOT LODGE AN ENQUIRY AT ALL, and that is stronger than
    // the design claimed. `reference` is NOT NULL and is not among the columns
    // granted to `authenticated`, so an insert from a signed-in host fails on
    // the constraint before any policy is consulted. The route, under the
    // service role, is the only thing that can write one.
    //
    // Worth knowing rather than worth changing: it means the INSERT grant and
    // the insert policy on service_enquiries are belt to a brace that is
    // already holding. If `reference` ever gains a default, they become the
    // only thing standing between a host and a hand-written enquiry, so they
    // stay.
    const direct = await asUser(hostToken, 'POST', '/service_enquiries', base, 'return=representation');
    if (refused(direct)) ok('cannot lodge one directly — only the route can');
    else bad('cannot lodge one directly', 'the browser wrote an enquiry: ' + JSON.stringify(direct.body).slice(0, 160));

    // So the row under test is made the way the route makes it.
    const [row] = await db.insert('service_enquiries', [{
        ...base,
        reference: 'GG-RLS1',
        status: 'sent',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        reply_token_hash: 'not-a-real-hash',
    }]);

    console.log('\n  A host writing columns that are the platform\u2019s');

    for (const [name, patch] of [
        ['status', { status: 'accepted' }],
        ['expires_at', { expires_at: '2030-01-01T00:00:00Z' }],
        ['reply_token_hash', { reply_token_hash: 'deadbeef' }],
        ['reference', { reference: 'GG-MINE' }],
        ['responded_at', { responded_at: '2026-01-01T00:00:00Z' }],
        ['host_phone', { host_phone: '07000000000' }],
    ]) {
        const r = await asUser(hostToken, 'PATCH', '/service_enquiries?id=eq.' + row.id, patch);
        if (refused(r)) ok('cannot set ' + name);
        else bad('cannot set ' + name, 'it was accepted — check the column grants');
    }

    // The one that matters most of all. If this ever passes, a host can hand
    // themselves a tradesman's phone number and the accept means nothing.
    const forged = await asUser(hostToken, 'GET',
        '/service_enquiries?id=eq.' + row.id + '&select=status');
    const stillSent = forged.ok && Array.isArray(forged.body) && forged.body[0]
        && forged.body[0].status === 'sent';
    if (stillSent) ok('the accept cannot be forged');
    else bad('the accept cannot be forged', 'THE STATUS MOVED: ' + JSON.stringify(forged.body).slice(0, 160));

    const outcome = await asUser(hostToken, 'PATCH', '/service_enquiries?id=eq.' + row.id,
        { outcome: 'went_ahead' }, 'return=representation');
    if (outcome.ok) ok('may record an outcome, which gates nothing');
    else bad('may record an outcome', JSON.stringify(outcome.body).slice(0, 160));

    // ---- whose enquiry is whose -------------------------------------------

    console.log('\n  Reading somebody else’s');

    {
        const nosy = await asUser(otherToken, 'GET', '/service_enquiries?id=eq.' + row.id + '&select=summary,host_phone');
        if (refused(nosy)) ok('another host cannot read it');
        else bad('another host cannot read it', JSON.stringify(nosy.body).slice(0, 160));

        const mine = await asUser(hostToken, 'GET', '/service_enquiries?id=eq.' + row.id + '&select=summary');
        if (mine.ok && Array.isArray(mine.body) && mine.body.length === 1) ok('the host who wrote it can');
        else bad('the host who wrote it can', JSON.stringify(mine.body).slice(0, 160));

        const his = await asUser(ownerToken, 'GET', '/service_enquiries?id=eq.' + row.id + '&select=summary');
        if (his.ok && Array.isArray(his.body) && his.body.length === 1) ok('the tradesman it was sent to can');
        else bad('the tradesman it was sent to can', JSON.stringify(his.body).slice(0, 160));

        const rewrite = await asUser(ownerToken, 'PATCH', '/service_enquiries?id=eq.' + row.id,
            { summary: 'something else entirely' });
        if (refused(rewrite)) ok('the tradesman cannot rewrite what he was sent');
        else bad('the tradesman cannot rewrite what he was sent', 'he changed the job description');
    }

    // ---- anonymous ---------------------------------------------------------

    console.log('\n  Signed out');

    const anonRead = await asAnon('GET', '/service_enquiries?select=reference,host_phone');
    if (refused(anonRead)) ok('cannot read any enquiry');
    else bad('cannot read any enquiry', JSON.stringify(anonRead.body).slice(0, 160));

    const anonWrite = await asAnon('POST', '/service_enquiries', base);
    if (refused(anonWrite)) ok('cannot lodge one for somebody');
    else bad('cannot lodge one for somebody', JSON.stringify(anonWrite.body).slice(0, 160));

    // ---- what a host wanted -----------------------------------------------
    //
    // Write-only from the browser on purpose: readable, it is a list of every
    // gap in our coverage handed to anyone with the public key.

    console.log('\n  service_wanted');

    const wanted = await asAnon('POST', '/service_wanted', { trade: 'roofer', area_key: 'Wigtown' });
    if (wanted.ok || wanted.status === 201) ok('a signed-out visitor may say what they wanted');
    else bad('a signed-out visitor may say what they wanted', JSON.stringify(wanted.body).slice(0, 160));

    const wantedRead = await asAnon('GET', '/service_wanted?select=trade,area_key');
    if (refused(wantedRead)) ok('and cannot read the list back');
    else bad('and cannot read the list back', 'COVERAGE GAPS ARE PUBLIC: ' + JSON.stringify(wantedRead.body).slice(0, 160));

    const wantedReadIn = await asUser(hostToken, 'GET', '/service_wanted?select=trade');
    if (refused(wantedReadIn)) ok('nor can a signed-in host');
    else bad('nor can a signed-in host', JSON.stringify(wantedReadIn.body).slice(0, 160));

    await db.remove('service_wanted', '?trade=eq.roofer&area_key=eq.Wigtown');
    await clear();
}

console.log(reset ? '\nclearing...' : '\nchecking what the database refuses...');

if (reset) {
    await clear();
    console.log('done.\n');
} else {
    await run();
    console.log('\n  ' + passed + ' passed, ' + failed + ' failed\n');
    if (failed) process.exit(1);
}
