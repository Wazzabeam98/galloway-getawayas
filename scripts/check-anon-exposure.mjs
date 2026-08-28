// What a stranger can read, asked of a real deployment with the real anon key.
//
// WHY THIS IS A SCRIPT AND NOT A UNIT TEST
//
// It is the only check in this repo that can answer the question that matters,
// because the answer lives in Postgres grants and policies rather than in code.
// Two things this project has learned the hard way:
//
//   Reading the SQL is not enough. A policy on `listings` looked right and
//   refused every read, including the public site's, because of a recursion
//   nothing in the file showed.
//
//   Testing on TEST proves nothing here. Production and test have DIVERGED on
//   grants: on 28 August 2026 `anon` held SELECT on `bookings` and `profiles`
//   on production and on neither on test. A probe of test would have reported
//   both safe.
//
// So it runs against whichever project you point it at, and the one that counts
// is production.
//
//   node scripts/check-anon-exposure.mjs             # test
//   node scripts/check-anon-exposure.mjs --prod      # the one that matters
//
// It writes nothing, ever. Every request is a GET with the anon key, which is
// public by design and ships in every page of the site.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const prod = process.argv.includes('--prod');
const file = prod ? '.env.production.local' : '.env.local';

function env() {
    const out = {};
    for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return out;
}

const E = env();
const URL_ = E.NEXT_PUBLIC_SUPABASE_URL;
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PROD_REF = 'hviwjxigqivjfhmhpjiy';
const TEST_REF = 'yefoqcabuijcowoqewtc';
const expected = prod ? PROD_REF : TEST_REF;

if (!URL_ || !URL_.includes(expected)) {
    console.error(`refusing: ${file} is not the ${prod ? 'production' : 'test'} project`);
    process.exit(1);
}

const get = (q) => fetch(URL_ + q, { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

const failures = [];
const notes = [];

function check(name, ok, detail) {
    console.log(`  ${ok ? 'ok  ' : 'LEAK'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures.push(name);
}

console.log(`\n  anonymous exposure — ${prod ? 'PRODUCTION' : 'test'} (${expected})\n`);

/* ------------------------------------------------------------- profiles */

{
    const { body } = await get('/rest/v1/profiles?select=phone,residential_address,email&limit=50');
    if (!Array.isArray(body)) {
        check('profiles: contact details', true, 'refused outright');
    } else {
        const withPhone = body.filter((p) => p.phone).length;
        const withAddress = body.filter((p) => p.residential_address).length;
        const withEmail = body.filter((p) => p.email).length;
        check('profiles: phone numbers', withPhone === 0, `${withPhone} readable`);
        check('profiles: home addresses', withAddress === 0, `${withAddress} readable`);
        check('profiles: email addresses', withEmail === 0, `${withEmail} readable`);
    }
}

{
    // The names ARE public on purpose — a listing says who hosts it, and a
    // review says who wrote it. If this breaks, the public pages lose them.
    const { body } = await get('/rest/v1/profiles?select=id,full_name&limit=1');
    const ok = Array.isArray(body) && body.length > 0;
    if (!ok) notes.push('profiles: display names are NOT readable — "Hosted by…" and reviewer names will be blank');
    console.log(`  ${ok ? 'ok  ' : 'WARN'}  profiles: display names still readable${ok ? '' : '  — public pages will lose them'}`);
}

/* ------------------------------------------------------------- listings */

{
    const { body } = await get('/rest/v1/listings?select=latitude,longitude&limit=50');
    if (!Array.isArray(body)) {
        check('listings: exact coordinates', true, 'refused outright');
    } else {
        const withCoords = body.filter((l) => l.latitude !== null && l.latitude !== undefined).length;
        check('listings: exact coordinates', withCoords === 0, `${withCoords} readable`);
    }
}

{
    const { body } = await get('/rest/v1/listings?select=street_address,postcode&limit=50');
    if (!Array.isArray(body)) {
        check('listings: street address', true, 'refused outright');
    } else {
        const withStreet = body.filter((l) => l.street_address).length;
        const withPostcode = body.filter((l) => l.postcode).length;
        check('listings: street addresses', withStreet === 0, `${withStreet} readable`);
        check('listings: postcodes', withPostcode === 0, `${withPostcode} readable`);
    }
}

{
    // The site itself. If this fails the fix has gone too far.
    const { body } = await get('/rest/v1/listings?select=id,title,status&limit=50');
    const published = Array.isArray(body) ? body.filter((l) => l.status === 'published').length : 0;
    const other = Array.isArray(body) ? body.filter((l) => l.status !== 'published').length : 0;
    console.log(`  ${published > 0 ? 'ok  ' : 'WARN'}  listings: ${published} published still public`);
    check('listings: nothing unpublished visible', other === 0, `${other} readable`);
}

/* ------------------------------------------------------------- bookings */

{
    const { body } = await get('/rest/v1/bookings?select=id,guest_id,total_price,status&limit=50');
    if (!Array.isArray(body)) {
        check('bookings', true, 'refused outright');
    } else {
        check('bookings', body.length === 0,
            `${body.length} readable` + (body.length ? ` (${Array.from(new Set(body.map((b) => b.status))).join(', ')})` : ''));
        if (body.length === 0) {
            // The trap that made two sessions disagree: production had no
            // confirmed bookings, and the policy only exposes confirmed ones.
            notes.push('bookings returned nothing — check there are confirmed bookings, or this proves little');
        }
    }
}

/* ------------------------------------------------------------- messages */

{
    const { body } = await get('/rest/v1/messages?select=id,body&limit=5');
    check('messages', !Array.isArray(body) || body.length === 0,
        Array.isArray(body) ? `${body.length} readable` : 'refused outright');
}

console.log('');
for (const n of notes) console.log('  note: ' + n);

if (failures.length) {
    console.log(`\n  ${failures.length} LEAK(S): ${failures.join(', ')}\n`);
    process.exit(1);
}
console.log('\n  nothing leaking.\n');
