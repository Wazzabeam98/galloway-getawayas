// Can a stranger read what a stranger must not?
//
// Run with the ANON KEY, never the service key — the service role is not
// subject to any of this and a probe using it would pass against a completely
// open database. That is the whole point: this asks the question the way an
// attacker asks it, with the key that is compiled into the front end and
// visible to anybody who opens devtools.
//
// WHAT IT COVERS
//
//   profiles   a stranger may see a display name, an avatar and the flags a
//              listing page needs. Not an email, a phone number, a home
//              address, a Stripe id or any figure about money.
//
//   bookings   a stranger may see nothing at all. The calendar needs dates,
//              and gets them from a view that exposes three columns and no
//              row.
//
// Every check asserts a REFUSAL, so a pass means the database said no. Run it
// against an unfixed database first and watch it fail; a privacy check that
// has only ever been seen passing proves nothing.
//
// Usage:
//   node scripts/data-privacy-rls.mjs
//   node scripts/data-privacy-rls.mjs --target prod     (read-only, safe)

import { loadEnv, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
const args = process.argv.slice(2);
const wantProd = args.includes('--target') && args[args.indexOf('--target') + 1] === 'prod';

// Reading production is legitimate here — it is exactly what any visitor can
// do — but it must be a deliberate word, and it is read-only either way.
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!wantProd && (!URL || !URL.includes(TEST_PROJECT_REF))) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// THE CANARY
// ---------------------------------------------------------------------------
//
// A privacy check cannot tell "protected" from "empty". The first run of this
// script reported profiles.phone and profiles.residential_address as safe —
// not because anything protected them, but because no row on test had either
// filled in. You cannot leak an empty box. On production, where they are
// populated, the same columns were wide open.
//
// So the check plants its own. One profile on test carries a fake number and a
// fake address, written with the service role, and every run refreshes it. If
// the grant is ever lost again the canary is there to leak, and the check
// fails instead of congratulating itself.
//
// Test only. On production it probes what is actually there and writes
// nothing.
const CANARY_PHONE = '07700 900999';
const CANARY_ADDRESS = '1 Canary Cottage, Kirkcudbright, DG6 4AA';

async function plantCanary() {
    const db = supabaseClient(env);
    const rows = await db.select('profiles', '?select=id&limit=1');
    if (!rows.length) { console.log('  (no profile on test to use as a canary)'); return null; }

    await db.update('profiles', '?id=eq.' + rows[0].id, {
        phone: CANARY_PHONE,
        residential_address: CANARY_ADDRESS,
    });

    // The same trick on bookings. Six money columns were null on every test
    // row, so the first run reported them safe — deposit_amount,
    // payout_amount, cleaning_fee, payout_transfer_id, stripe_customer_id and
    // stripe_payment_method_id. Filling one CONFIRMED booking is what makes
    // the check about the grant rather than about the fixture.
    const bookings = await db.select('bookings', '?status=eq.confirmed&select=id&limit=1');
    if (bookings.length) {
        await db.update('bookings', '?id=eq.' + bookings[0].id, {
            deposit_amount: 111.11,
            payout_amount: 222.22,
            cleaning_fee: 33.33,
            payout_transfer_id: 'tr_canary',
            stripe_customer_id: 'cus_canary',
            stripe_payment_method_id: 'pm_canary',
        });
    } else {
        console.log('  (no confirmed booking on test to use as a canary)');
    }

    return rows[0].id;
}

let passed = 0;
let failed = 0;
const ok = (n) => { passed++; console.log('  ✓ ' + n); };
const bad = (n, d) => { failed++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); };

async function anon(path) {
    const res = await fetch(URL + '/rest/v1' + path, {
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, ok: res.ok, body };
}

// A column is exposed if asking for it succeeds AND any row comes back with
// something in it. A 400 "column does not exist in the schema cache" is the
// grant being gone, which is the answer we want.
async function fieldIsPrivate(table, column, label) {
    // Asks for rows where the column IS populated, rather than the first few
    // rows and hoping. The first version took `limit=5` and reported phone and
    // residential_address as safe because the canary happened to sort outside
    // the window — a check that passed by luck, which is the exact failure
    // this whole script exists to argue against.
    const r = await anon('/' + table + '?select=' + column + '&' + column + '=not.is.null&limit=5');

    if (!r.ok) { ok(label + ' — refused (' + r.status + ')'); return; }

    const leaked = Array.isArray(r.body)
        && r.body.some((row) => row && row[column] !== null && row[column] !== '');

    if (!leaked) ok(label + ' — nothing readable');
    else bad(label, 'READABLE with the public key');
}

async function run() {
    console.log('\n  against ' + (wantProd ? 'PRODUCTION' : 'test') + ', with the ANON key\n');

    if (!wantProd) {
        const id = await plantCanary();
        if (id) console.log('  canary planted on one profile: a phone number and an address\n');
    }

    // ---- profiles ----------------------------------------------------------
    console.log('  profiles — what a stranger must not read');

    for (const c of [
        'email', 'phone', 'residential_address',
        'stripe_account_id', 'stripe_charges_enabled', 'stripe_requirements_due',
        'stripe_details_submitted', 'stripe_updated_at', 'payout_balance_owed',
    ]) {
        await fieldIsPrivate('profiles', c, 'profiles.' + c);
    }

    console.log('\n  profiles — what a stranger still needs');
    const shown = await anon('/profiles?select=id,full_name,preferred_name,show_full_name,avatar_url&limit=3');
    if (shown.ok && Array.isArray(shown.body)) ok('a display name and avatar are still readable');
    else bad('a display name and avatar are still readable', JSON.stringify(shown.body).slice(0, 140));

    // ---- bookings ----------------------------------------------------------
    console.log('\n  bookings — a stranger must not read the row at all');

    for (const c of [
        'total_price', 'deposit_amount', 'balance_amount', 'amount_paid', 'amount_refunded',
        'commission_rate', 'payout_amount', 'payout_transfer_id', 'cleaning_fee',
        'stripe_customer_id', 'stripe_payment_intent_id', 'stripe_payment_method_id',
        'guest_id', 'host_id',
    ]) {
        await fieldIsPrivate('bookings', c, 'bookings.' + c);
    }

    const anyRow = await anon('/bookings?select=id&limit=1');
    const gotRow = anyRow.ok && Array.isArray(anyRow.body) && anyRow.body.length > 0;
    if (!gotRow) ok('no booking row is returned at all');
    else bad('no booking row is returned at all', 'a row came back');

    console.log('\n  the calendar still works');
    const cal = await anon('/listing_busy_nights?select=listing_id,check_in,check_out&limit=3');
    if (cal.ok && Array.isArray(cal.body)) ok('busy nights are readable, without the booking');
    else bad('busy nights are readable, without the booking', JSON.stringify(cal.body).slice(0, 140));

    // A pending booking is somebody mid-checkout. A stranger who cannot see it
    // picks those dates, fills in a card and is refused — a lost booking that
    // looks like a broken site. The view carries pending as well as confirmed.
    //
    // AND THE CHECK HAS TO KNOW THE DIFFERENCE BETWEEN "EXCLUDED" AND "NONE".
    //
    // The first version reported a failure against production, where there is
    // not a single pending booking. That is the canary problem in mirror
    // image: an assertion that a row comes back is as blind to an empty table
    // as an assertion that one does not. It said the view was dropping pending
    // nights when the view was fine and the database was simply quiet.
    const pend = await anon('/listing_busy_nights?select=status&status=eq.pending&limit=1');
    const conf = await anon('/listing_busy_nights?select=status&status=eq.confirmed&limit=1');

    const anyPending = pend.ok && Array.isArray(pend.body) && pend.body.length > 0;
    const anyConfirmed = conf.ok && Array.isArray(conf.body) && conf.body.length > 0;

    if (anyPending) {
        ok('pending dates show as busy, not free');
    } else if (!pend.ok) {
        bad('pending dates show as busy, not free', 'the view refused the query: ' + pend.status);
    } else if (!anyConfirmed) {
        console.log('  – pending dates: no bookings of any kind here to check against');
    } else {
        console.log('  – pending dates: none exist right now; confirmed ones come through, '
            + 'so the view is reading. Proven on test, where a pending booking exists.');
    }

    // ---- listings ----------------------------------------------------------
    console.log('\n  listings — only what is published');

    const drafts = await anon('/listings?select=id,status&status=in.(draft,pending_review)&limit=5');
    const leakedDrafts = drafts.ok && Array.isArray(drafts.body) && drafts.body.length > 0;
    if (!leakedDrafts) ok('no draft or pending_review listing is readable');
    else bad('no draft or pending_review listing is readable',
        drafts.body.length + ' unpublished listing(s) readable with the public key');

    const published = await anon('/listings?select=id&status=eq.published&limit=1');
    if (published.ok && Array.isArray(published.body)) ok('published listings still are');
    else bad('published listings still are', JSON.stringify(published.body).slice(0, 140));

    console.log('\n  ' + passed + ' passed, ' + failed + ' failed\n');
    if (failed) process.exit(1);
}

await run();
