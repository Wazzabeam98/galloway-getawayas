// The two rules the database enforces itself, watched refusing.
//
// Everything else in this repo that stops a bad row is application code: a
// form, a route, a policy. These two are constraints, which means they hold
// even when the application is wrong, even for the service role, even for a
// hand-written statement in the SQL editor. That is the whole reason they were
// written, and until now nothing checked they were still there.
//
//   bookings_no_overlapping_confirmed   two confirmed stays cannot share a
//                                       night on one listing.        -> 23P01
//
//   listings_published_are_complete     a published listing must have a
//                                       non-blank title and a price above
//                                       zero.                        -> 23514
//
// ---------------------------------------------------------------------------
// WHY THE SERVICE ROLE, WHEN EVERY OTHER PROBE HERE AVOIDS IT
// ---------------------------------------------------------------------------
//
// scripts/write-side-rls.mjs uses the anon key because RLS is the thing under
// test and the service role is exempt from it. Here it is the opposite: a
// constraint that the service role could step over would not be a constraint.
// Using the most privileged key available is the strongest form of the claim.
//
// ---------------------------------------------------------------------------
// THE NEGATIVE CONTROLS ARE NOT DECORATION
// ---------------------------------------------------------------------------
//
// A constraint that refused every insert would pass a test that only ever
// asserts refusal — and so would a table with a typo in a column name, and so
// would a broken connection. Each rule is therefore checked from both sides:
// the row that must be refused, AND the neighbouring row that must still get
// in. The second is what makes the first mean something.
//
//   overlap      a stay ABUTTING another (one leaves the morning the next
//                arrives) must be allowed — dates are half-open, and getting
//                this wrong turns paying guests away on changeover day.
//                An overlapping PENDING booking must also be allowed: the
//                constraint is confirmed-only on purpose.
//
//   published    a DRAFT with a blank title must be allowed. Save & finish
//                later is the entire point of drafts.
//
// ---------------------------------------------------------------------------
// TEST ONLY, AND WHY THAT IS ENOUGH HERE
// ---------------------------------------------------------------------------
//
// This one inserts rows, so it runs against the test project and refuses
// anything else. That would normally prove nothing about production — test and
// production have diverged on grants, which is the reason write-side-rls.mjs
// exists at all.
//
// A CONSTRAINT IS NOT A GRANT. It is in pg_constraint or it is not, and that
// is a question production can be asked without writing to it. So the last
// step reads production's catalogue through the guarded read-only path in
// scripts/migrate.mjs and fails if either constraint is missing there. The
// behaviour is proven on test; the presence is proven on production; neither
// half is assumed.
//
// Usage:
//   node scripts/constraint-refusals.mjs

import { execFileSync } from 'node:child_process';
import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !URL_BASE.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: this writes rows, and NEXT_PUBLIC_SUPABASE_URL is not the test project');
    process.exit(1);
}
if (!SERVICE) {
    console.error('refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
}

const TAG = 'CANARY — constraint check';

// ---------------------------------------------------------------------------
// --prove-detector
// ---------------------------------------------------------------------------
//
// The problem with any refusal check: it can only ever be watched passing, and
// a check that passes because it is asking the wrong question looks exactly
// the same from outside.
//
// The honest way to settle it is to drop the constraint on test, watch this
// script fail, and put it back. That is a migration, and applying migrations
// was not available in the session that wrote this — so here is the next best
// thing, and it is not nothing: with this flag the two "must be refused"
// probes are pointed at rows that are PERFECTLY LEGAL. A stay that does not
// overlap, a title that is not blank.
//
// The insert path, the parsing, the SQLSTATE comparison and the reporting are
// all identical. Only the row changes. So if the script still prints ticks
// with this flag on, its refusal detection is broken and every tick it has
// ever printed was worthless.
//
// It tests the detector, NOT the constraint. Both are worth knowing, and the
// difference between them is worth being clear about:
//
//   node scripts/constraint-refusals.mjs                  the constraints hold
//   node scripts/constraint-refusals.mjs --prove-detector  the check can fail
//
// Expect exactly two failures from the second, and no others.
const proveDetector = process.argv.slice(2).includes('--prove-detector');

let passed = 0;
let failed = 0;
const ok = (n, d) => { passed++; console.log('  ✓ ' + n + (d ? '  (' + d + ')' : '')); };
const bad = (n, d) => { failed++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); };

async function db(method, path, body) {
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

// PostgREST puts the SQLSTATE in `code`. Asserting on the CODE and not on the
// message: the message is prose that a Postgres upgrade may reword, and a test
// that matches prose starts failing for reasons that are not about the rule.
function sqlstate(r) {
    return r && r.body && r.body.code ? r.body.code : null;
}

const state = { listing: null, other: null, host: null, made: [] };

function dayOffset(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

async function plant() {
    const hosts = await db('GET', '/profiles?select=id&limit=1');
    if (!hosts.ok || !hosts.body.length) throw new Error('no profile on test to host a canary listing');
    state.host = hosts.body[0].id;

    const l = await db('POST', '/listings', [{
        host_id: state.host,
        title: TAG,
        location: 'Nowhere, Dumfries and Galloway',
        price_per_night: 100,
        status: 'draft',
    }]);
    if (!l.ok) throw new Error('could not plant the canary listing: ' + JSON.stringify(l.body).slice(0, 200));
    state.listing = l.body[0].id;

    // A second listing, so the overlap rule can be shown to be per-listing
    // rather than global. Without it, "the same nights on a DIFFERENT cottage
    // are fine" is untested and the constraint could be blocking the whole
    // calendar for everybody.
    const o = await db('POST', '/listings', [{
        host_id: state.host,
        title: TAG + ' (second cottage)',
        location: 'Nowhere, Dumfries and Galloway',
        price_per_night: 100,
        status: 'draft',
    }]);
    if (!o.ok) throw new Error('could not plant the second canary listing');
    state.other = o.body[0].id;
}

async function booking(listingId, checkIn, checkOut, status) {
    const r = await db('POST', '/bookings', [{
        listing_id: listingId,
        host_id: state.host,
        guest_id: state.host,
        check_in: checkIn,
        check_out: checkOut,
        total_price: 300,
        status,
        payment_status: 'unpaid',
    }]);
    if (r.ok && r.body && r.body[0]) state.made.push(r.body[0].id);
    return r;
}

async function cleanup() {
    for (const id of state.made) await db('DELETE', '/bookings?id=eq.' + id);
    if (state.listing) await db('DELETE', '/bookings?listing_id=eq.' + state.listing);
    if (state.other) await db('DELETE', '/bookings?listing_id=eq.' + state.other);
    if (state.listing) await db('DELETE', '/listings?id=eq.' + state.listing);
    if (state.other) await db('DELETE', '/listings?id=eq.' + state.other);
}

async function run() {
    console.log('\n  DATABASE CONSTRAINTS — against test, with the SERVICE ROLE\n');
    console.log('  the service role on purpose: a rule it could step over');
    console.log('  would not be a constraint.\n');

    if (proveDetector) {
        console.log('  --prove-detector: the two "must be refused" probes are pointed');
        console.log('  at legal rows. EXPECT EXACTLY TWO FAILURES. Anything else means');
        console.log('  this script cannot tell a refusal from an acceptance.\n');
    }

    await plant();

    /* ---- bookings_no_overlapping_confirmed -> 23P01 --------------------- */

    console.log('  two confirmed stays cannot share a night');

    const first = await booking(state.listing, dayOffset(300), dayOffset(305), 'confirmed');
    if (!first.ok) {
        bad('the first confirmed stay goes in', JSON.stringify(first.body).slice(0, 200));
    } else {
        ok('the first confirmed stay goes in', 'so the table is reachable');
    }

    // 303-308 overlaps 300-305. Under --prove-detector it becomes 310-315,
    // which does not overlap anything and must therefore be accepted — and the
    // assertion below must notice that it was.
    const clash = proveDetector
        ? await booking(state.listing, dayOffset(310), dayOffset(315), 'confirmed')
        : await booking(state.listing, dayOffset(303), dayOffset(308), 'confirmed');
    if (sqlstate(clash) === '23P01') {
        ok('an overlapping confirmed stay is refused', '23P01 exclusion_violation');
    } else if (clash.ok) {
        bad('an overlapping confirmed stay is refused',
            'IT WENT IN. Two confirmed stays now share nights on one listing.');
    } else {
        bad('an overlapping confirmed stay is refused',
            'refused, but with ' + sqlstate(clash) + ' rather than 23P01 — '
            + 'that is a different rule talking: ' + JSON.stringify(clash.body).slice(0, 160));
    }

    // Wholly inside the first stay, which a naive range test can miss.
    const inside = await booking(state.listing, dayOffset(301), dayOffset(303), 'confirmed');
    if (sqlstate(inside) === '23P01') ok('a stay wholly inside another is refused', '23P01');
    else if (inside.ok) bad('a stay wholly inside another is refused', 'IT WENT IN.');
    else bad('a stay wholly inside another is refused', 'refused with ' + sqlstate(inside));

    console.log('\n  and the rows that must still get in');

    // Half-open dates: the 305th is the morning the first guest leaves.
    const abutting = await booking(state.listing, dayOffset(305), dayOffset(308), 'confirmed');
    if (abutting.ok) ok('a stay starting the morning the last one ends is allowed', 'changeover day');
    else bad('a stay starting the morning the last one ends is allowed',
        'REFUSED with ' + sqlstate(abutting) + ' — this turns paying guests away on changeover day');

    const pending = await booking(state.listing, dayOffset(301), dayOffset(304), 'pending');
    if (pending.ok) ok('an overlapping PENDING stay is allowed', 'the host has not accepted it yet');
    else bad('an overlapping PENDING stay is allowed', 'REFUSED with ' + sqlstate(pending));

    const elsewhere = await booking(state.other, dayOffset(300), dayOffset(305), 'confirmed');
    if (elsewhere.ok) ok('the same nights on another cottage are allowed', 'the rule is per listing');
    else bad('the same nights on another cottage are allowed', 'REFUSED with ' + sqlstate(elsewhere));

    /* ---- listings_published_are_complete -> 23514 ------------------------ */

    console.log('\n  a published listing must have a title and a price');

    const blank = await db('PATCH', '/listings?id=eq.' + state.listing,
        { status: 'published', title: proveDetector ? 'A Perfectly Good Title' : '   ' });
    if (sqlstate(blank) === '23514') {
        ok('publishing with a blank title is refused', '23514 check_violation');
    } else if (blank.ok) {
        await db('PATCH', '/listings?id=eq.' + state.listing, { status: 'draft', title: TAG });
        bad('publishing with a blank title is refused', 'IT WENT THROUGH. Reverted.');
    } else {
        bad('publishing with a blank title is refused',
            'refused with ' + sqlstate(blank) + ' rather than 23514: '
            + JSON.stringify(blank.body).slice(0, 160));
    }

    const free = await db('PATCH', '/listings?id=eq.' + state.listing,
        { status: 'published', title: TAG, price_per_night: 0 });
    if (sqlstate(free) === '23514') {
        ok('publishing at a price of zero is refused', '23514');
    } else if (free.ok) {
        await db('PATCH', '/listings?id=eq.' + state.listing,
            { status: 'draft', price_per_night: 100 });
        bad('publishing at a price of zero is refused', 'IT WENT THROUGH. Reverted.');
    } else {
        bad('publishing at a price of zero is refused', 'refused with ' + sqlstate(free));
    }

    console.log('\n  and the rows that must still get in');

    const draft = await db('PATCH', '/listings?id=eq.' + state.listing,
        { status: 'draft', title: '   ' });
    if (draft.ok) ok('a DRAFT with a blank title is allowed', 'Save & finish later');
    else bad('a DRAFT with a blank title is allowed', 'REFUSED with ' + sqlstate(draft));

    const good = await db('PATCH', '/listings?id=eq.' + state.listing,
        { status: 'published', title: TAG, price_per_night: 100 });
    if (good.ok) ok('a complete listing publishes normally', 'so the rule is not refusing everything');
    else bad('a complete listing publishes normally', 'REFUSED with ' + sqlstate(good));

    await db('PATCH', '/listings?id=eq.' + state.listing, { status: 'draft' });

    /* ---- and are they on production at all? ------------------------------ */
    //
    // Behaviour proven on test. Presence has to be asked of production, or the
    // whole script is an argument about the wrong database.
    console.log('\n  the same two constraints, on PRODUCTION');

    try {
        const out = execFileSync('node', [
            'scripts/migrate.mjs', '--target', 'prod', '--sql',
            "select conname from pg_constraint where conname in "
            + "('bookings_no_overlapping_confirmed','listings_published_are_complete')",
        ], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });

        for (const name of ['bookings_no_overlapping_confirmed', 'listings_published_are_complete']) {
            if (out.includes(name)) ok(name + ' exists on production');
            else bad(name + ' exists on production', 'IT IS NOT THERE. Test proves nothing about the live site.');
        }
    } catch (err) {
        bad('production could be asked about its constraints',
            'could not read it: ' + (err && err.message || '').slice(0, 200));
    }

    console.log('\n  ' + passed + ' passed, ' + failed + ' failed\n');
    return failed;
}

let code = 1;
try {
    code = await run();
} catch (err) {
    console.error('\n  the check itself failed: ' + (err && err.message) + '\n');
    code = 1;
} finally {
    await cleanup();
    console.log('  canary rows removed\n');
}

process.exit(code ? 1 : 0);
