// Prove, on TEST, that admin_anonymise_account() erases every piece of personal
// data a guest, host, co-host, experience provider or trade leaves behind.
//
// HOW IT PROVES IT, SAFELY. Everything runs inside ONE transaction that is
// ALWAYS rolled back (see `finally`). The script creates one throwaway account
// per role on the reserved @gallowaydelete.test domain, fills every
// personal-data table with a recognisable sentinel, runs the real scrub, reads
// every column back, and classifies each as CLEARED (null / '' / tombstone /
// row gone) or LEAK (the sentinel survived). It never commits, so TEST is
// untouched and no real account is ever deleted — the proof is the read-back.
//
// This is the "run the thing it guards and watch it say no" check MAINTENANCE.md
// asks for, applied to erasure: it was written against the OLD two-table routine
// first and watched to LEAK on message bodies, allergies, wifi, door codes,
// addresses, third-party contacts and the auth audit IP, then re-run against the
// new routine and watched to clear them.
//
//   node scripts/prove-account-erasure.mjs
//
// Exit 0 = every personal field cleared. Exit 1 = at least one leak.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv, assertTestEnvironment, isProtectedEmail, ROOT } from './seed-lib.mjs';
import { createRequire } from 'node:module';
// Door codes and wifi passwords are stored sealed (lib/secretBox); so are these.
const { sealSecret } = createRequire(import.meta.url)('./secretBox.cjs');

// The migration whose function this proves. Applied INSIDE the rolled-back
// transaction below, so the proof validates the exact file before it ever
// reaches a database — and persists nothing.
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261005094931_complete_account_erasure_across_all_personal_data.sql');

const env = loadEnv();
assertTestEnvironment(env);
const url = env.SUPABASE_TEST_DB_URL;
if (!url) {
    console.error('SUPABASE_TEST_DB_URL is not set in .env.local');
    process.exit(1);
}
if (!/yefoqcabuijcowoqewtc/.test(url)) {
    console.error('Refusing to run: SUPABASE_TEST_DB_URL is not the TEST project.');
    process.exit(1);
}

const PAST_IN = '2020-01-01';
const PAST_OUT = '2020-01-05';
const leaks = [];
const rows = [];

function note(role, table, column, value, ok) {
    rows.push({ role, where: `${table}.${column}`, status: ok ? 'CLEARED' : 'LEAK', value: value === null ? 'null' : String(value).slice(0, 40) });
    if (!ok) leaks.push(`${role}: ${table}.${column} = ${JSON.stringify(value)}`);
}

// A field is cleared if it is null/empty or a known tombstone, and in every case
// does NOT still contain its sentinel marker.
function cleared(value, sentinel) {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value === 'string' && sentinel && value.includes(sentinel)) return false;
    const tombstones = ['Deleted user', 'Removed provider', '[message removed]', '[removed]', '[reporter account closed]', 'invalid.example'];
    if (typeof value === 'string' && tombstones.some((t) => value.includes(t))) return true;
    return !(typeof value === 'string' && sentinel && value.includes(sentinel));
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (sql, params) => client.query(sql, params);

async function makeSubject(tag) {
    const email = `${tag}@gallowaydelete.test`;
    if (isProtectedEmail(email)) throw new Error(`refusing: ${email} is protected`);
    const { rows: [u] } = await q(
        `insert into auth.users (id, instance_id, aud, role, email, phone, encrypted_password,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            $1, '+447700900123', 'bcrypt$notarealhash', '{"provider":"email"}'::jsonb, '{"full_name":"SENTINEL Person"}'::jsonb, now(), now())
         returning id`, [email]);
    const uid = u.id;
    await q(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
             values ($1::text, $1::uuid, jsonb_build_object('sub',$1::text,'email',$2::text), 'email', now(), now())`, [uid, email]);
    await q(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now())`, [uid]);
    await q(`insert into auth.audit_log_entries (id, instance_id, payload, ip_address, created_at)
             values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                     jsonb_build_object('actor_id',$1::text,'action','login'), '203.0.113.7', now())`, [uid]);
    await q(`insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
             values (gen_random_uuid(), $1, 'confirmation_token', 'SENTINELtoken', $2, now(), now())`, [uid, email]);
    // A handle_new_user trigger auto-creates the profile row on the auth insert,
    // so we UPDATE it with sentinels rather than inserting a second one.
    await q(
        `update public.profiles set
            full_name = 'SENTINEL Full Name', preferred_name = 'SENTINEL Pref', phone = '+447700900123',
            residential_address = 'SENTINEL 1 Castle St, Dumfries DG1 1AA', host_bio = 'SENTINEL bio',
            trading_name = 'SENTINEL Trading', welcome_message = 'SENTINEL welcome', welcome_message_enabled = true,
            avatar_url = 'avatars/'||$1::text||'-123.jpg', show_full_name = true
         where id = $1`, [uid]);
    return { uid, email };
}

async function anonymise(uid) { await q('select public.admin_anonymise_account($1)', [uid]); }

// A counterparty — the "other side" of bookings/messages — stays untouched.
async function makeOther() {
    const { rows: [u] } = await q(
        `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 'other@gallowaydelete.test', now(), now()) returning id`);
    await q(`update public.profiles set full_name = 'Other Person' where id = $1`, [u.id]);
    return u.id;
}

async function listingFor(hostId) {
    const { rows: [l] } = await q(
        `insert into public.listings (id, host_id, title, location, price_per_night, status, street_address, postcode)
         values (gen_random_uuid(), $1, 'SENTINEL Cottage', 'Dumfries', 100, 'published', 'SENTINEL 2 Loch Rd', 'DG2 2BB')
         returning id`, [hostId]);
    return l.id;
}

async function bookingFor({ guestId, hostId, listingId, checkIn = PAST_IN, checkOut = PAST_OUT }) {
    const { rows: [b] } = await q(
        `insert into public.bookings (id, listing_id, guest_id, host_id, check_in, check_out, total_price, status)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 500, 'confirmed') returning id`,
        [listingId, guestId, hostId, checkIn, checkOut]);
    return b.id;
}
function daysAgo(n) { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); }

async function providerFor(ownerId, trade) {
    const { rows: [p] } = await q(
        `insert into public.service_providers (id, owner_id, business_name, trade, provider_name, contact_email,
            contact_phone, based_line, collection_street, collection_town, collection_postcode, venue_lat, venue_lng,
            custom_label, stripe_product_description)
         values (gen_random_uuid(), $1, 'SENTINEL Biz', $2, 'SENTINEL Provider', 'SENTINEL@prov.test',
            '+447700900999', 'SENTINEL based line', 'SENTINEL coll st', 'SENTINEL town', 'DG3 3CC', 55.07, -3.6,
            'SENTINEL label', 'SENTINEL product desc') returning id`, [ownerId, trade]);
    return p.id;
}

const report = {};
try {
    await q('begin');
    // Install the new function from the migration file, within the transaction.
    // Set PROVE_OLD=1 to skip this and watch the current (old) function LEAK —
    // the "see the guard fail first" check MAINTENANCE.md asks for.
    if (!process.env.PROVE_OLD) await q(fs.readFileSync(MIGRATION, 'utf8'));
    const other = await makeOther();

    // ---- GUEST -----------------------------------------------------------
    {
        const { uid } = await makeSubject('guest');
        const listing = await listingFor(other);
        // Recent-past stay so the 14-day review window is open, but check_out is
        // before today so it does not count as an upcoming/blocking booking.
        const booking = await bookingFor({ guestId: uid, hostId: other, listingId: listing, checkIn: daysAgo(10), checkOut: daysAgo(3) });
        await q(`insert into public.messages (sender_id, recipient_id, booking_id, body) values ($1,$2,$3,'SENTINEL message text')`, [uid, other, booking]);
        const { rows: [pr] } = await q(`insert into public.service_providers (id, owner_id, business_name, trade) values (gen_random_uuid(),$1,'Host-owned prov','sponge') returning id`, [other]);
        await q(`insert into public.service_orders (id, provider_id, guest_id, trade, service_date, price, guest_name, guest_phone, guest_email, note, allergy, service_address)
                 values (gen_random_uuid(),$1,$2,'cake','2020-02-02',50,'SENTINEL Guest','+447700900222','SENTINEL@guest.test','SENTINEL note','SENTINEL peanuts','SENTINEL 9 Delivery Rd')`, [pr.id, uid]);
        await q(`insert into public.guest_delivery_addresses (guest_id, house, street, town, postcode, line) values ($1,'SENTINEL 9','SENTINEL St','Dumfries','DG9 9ZZ','SENTINEL 9 St, Dumfries')`, [uid]);
        await q(`insert into public.booking_guests (booking_id, user_id, invited_by, email, name) values ($1,$2,$2,'SENTINEL@coguest.test','SENTINEL Coguest')`, [booking, uid]);
        await q(`insert into public.reviews (booking_id, listing_id, reviewer_id, reviewee_id, review_type, rating, comment) values ($1,$2,$3,$4,'guest_to_host',5,'SENTINEL review body')`, [booking, listing, uid, other]);
        await q(`insert into public.conversation_prefs (user_id, booking_id) values ($1,$2)`, [uid, booking]);
        await q(`insert into public.error_log (source, message, user_id, user_agent) values ('client','x',$1,'SENTINEL Mozilla UA')`, [uid]);
        await q(`insert into public.interest_registrations (category, email, name, phone, ip, user_agent, status) values ('holiday_let','guest@gallowaydelete.test','SENTINEL Name','+447700900111','203.0.113.9','SENTINEL UA','new')`);
        await q(`insert into public.rate_limit_hits (bucket, key) values ('login','guest@gallowaydelete.test')`);

        await anonymise(uid);

        const p = (await q('select * from public.profiles where id=$1', [uid])).rows[0];
        note('guest', 'profiles', 'full_name', p.full_name, cleared(p.full_name, 'SENTINEL'));
        note('guest', 'profiles', 'email', p.email, cleared(p.email, '@gallowaydelete'));
        note('guest', 'profiles', 'phone', p.phone, cleared(p.phone, '447700900123'));
        note('guest', 'profiles', 'residential_address', p.residential_address, cleared(p.residential_address, 'SENTINEL'));
        note('guest', 'profiles', 'avatar_url', p.avatar_url, cleared(p.avatar_url, 'avatars/'));
        const m = (await q('select body from public.messages where sender_id=$1', [uid])).rows[0];
        note('guest', 'messages', 'body', m.body, cleared(m.body, 'SENTINEL'));
        const o = (await q('select guest_name, guest_phone, guest_email, allergy, service_address, note from public.service_orders where guest_id=$1', [uid])).rows[0];
        for (const c of ['guest_name', 'guest_phone', 'guest_email', 'allergy', 'service_address', 'note']) note('guest', 'service_orders', c, o[c], cleared(o[c], 'SENTINEL'));
        const gda = (await q('select count(*)::int n from public.guest_delivery_addresses where guest_id=$1', [uid])).rows[0];
        note('guest', 'guest_delivery_addresses', 'row', gda.n, gda.n === 0);
        const bg = (await q('select email, name from public.booking_guests where user_id=$1', [uid])).rows[0];
        note('guest', 'booking_guests', 'email', bg.email, cleared(bg.email, 'SENTINEL'));
        note('guest', 'booking_guests', 'name', bg.name, cleared(bg.name, 'SENTINEL'));
        const rv = (await q('select comment from public.reviews where reviewer_id=$1', [uid])).rows[0];
        // Reviews are KEPT by design (Airbnb-style, shown as "Deleted user"). This
        // is informational, not a leak check: we assert the comment survived and
        // the author shows the tombstone via the profile scrub above.
        rows.push({ role: 'guest', where: 'reviews.comment (KEPT by design)', status: rv.comment.includes('SENTINEL') ? 'KEPT' : 'GONE?!', value: rv.comment.slice(0, 40) });
        const el = (await q('select user_agent, user_id from public.error_log where user_agent like $1', ['SENTINEL%'])).rows;
        note('guest', 'error_log', 'user_agent', el.length ? el[0].user_agent : null, el.length === 0);
        const ir = (await q(`select count(*)::int n from public.interest_registrations where email='guest@gallowaydelete.test'`)).rows[0];
        note('guest', 'interest_registrations', 'row', ir.n, ir.n === 0);
        const rl = (await q(`select count(*)::int n from public.rate_limit_hits where key='guest@gallowaydelete.test'`)).rows[0];
        note('guest', 'rate_limit_hits', 'row', rl.n, rl.n === 0);
        await authChecks('guest', uid);
        report.guest = uid;
    }

    // ---- HOST ------------------------------------------------------------
    {
        const { uid } = await makeSubject('host');
        const listing = await listingFor(uid);
        const booking = await bookingFor({ guestId: other, hostId: uid, listingId: listing });
        await q(`insert into public.listing_arrival (listing_id, arrival_directions, parking_info, wifi_name, wifi_password, what3words) values ($1,'SENTINEL dir','SENTINEL park','SENTINEL-WIFI',$2,'SENTINEL.word.word')`, [listing, sealSecret('SENTINEL-pass123', 'listing_arrival', listing, env)]);
        await q(`insert into public.listing_access_codes (listing_id, code) values ($1,$2)`, [listing, sealSecret('SENTINEL1234', 'listing_access_codes', listing, env)]);
        await q(`insert into public.booking_access_codes (booking_id, code) values ($1,$2)`, [booking, sealSecret('SENTINEL5678', 'booking_access_codes', booking, env)]);
        await q(`insert into public.listing_ical_feeds (listing_id, url, events) values ($1,'https://sentinel.example/cal.ics','[]'::jsonb)`, [listing]);
        await q(`insert into public.booking_host_notes (booking_id, host_note, created_by) values ($1,'SENTINEL private note about guest',$2)`, [booking, uid]);
        await q(`insert into public.listing_access (listing_id, email, invited_by, role) values ($1,'SENTINEL@cohost.test',$2,'co_host')`, [listing, uid]);
        await q(`insert into public.message_templates (user_id, template_type, body) values ($1,'checkin_details','SENTINEL template body')`, [uid]);
        await q(`insert into public.quick_replies (user_id, title, body) values ($1,'SENTINEL title','SENTINEL reply body')`, [uid]);
        await q(`insert into public.service_wanted (host_id, listing_id, trade, note, contact) values ($1,$2,'plumber','SENTINEL need','SENTINEL contact 07000')`, [uid, listing]);
        await q(`insert into public.service_requests (host_id, listing_id, notes) values ($1,$2,'SENTINEL request notes')`, [uid, listing]);
        await q(`insert into public.listing_reports (listing_id, reporter_id, reason, details) values ($1,$2,'spam','SENTINEL accusation text')`, [listing, uid]);

        await anonymise(uid);

        const la = (await q('select wifi_name, wifi_password, arrival_directions, what3words from public.listing_arrival where listing_id=$1', [listing])).rows[0];
        for (const c of ['wifi_name', 'wifi_password', 'arrival_directions', 'what3words']) note('host', 'listing_arrival', c, la[c], cleared(la[c], 'SENTINEL'));
        const lac = (await q('select count(*)::int n from public.listing_access_codes where listing_id=$1', [listing])).rows[0];
        note('host', 'listing_access_codes', 'row (door code)', lac.n, lac.n === 0);
        const bac = (await q('select count(*)::int n from public.booking_access_codes where booking_id=$1', [booking])).rows[0];
        note('host', 'booking_access_codes', 'row (door code)', bac.n, bac.n === 0);
        const icf = (await q('select count(*)::int n from public.listing_ical_feeds where listing_id=$1', [listing])).rows[0];
        note('host', 'listing_ical_feeds', 'row', icf.n, icf.n === 0);
        const bhn = (await q('select count(*)::int n from public.booking_host_notes where created_by=$1', [uid])).rows[0];
        note('host', 'booking_host_notes', 'row', bhn.n, bhn.n === 0);
        const laacc = (await q('select count(*)::int n from public.listing_access where listing_id=$1', [listing])).rows[0];
        note('host', 'listing_access', 'co-host invite email', laacc.n, laacc.n === 0);
        const mt = (await q('select count(*)::int n from public.message_templates where user_id=$1', [uid])).rows[0];
        note('host', 'message_templates', 'row', mt.n, mt.n === 0);
        const qr = (await q('select count(*)::int n from public.quick_replies where user_id=$1', [uid])).rows[0];
        note('host', 'quick_replies', 'row', qr.n, qr.n === 0);
        const sw = (await q('select count(*)::int n from public.service_wanted where host_id=$1', [uid])).rows[0];
        note('host', 'service_wanted', 'row', sw.n, sw.n === 0);
        const sr = (await q('select count(*)::int n from public.service_requests where host_id=$1', [uid])).rows[0];
        note('host', 'service_requests', 'row', sr.n, sr.n === 0);
        const lr = (await q('select reporter_id, details from public.listing_reports where listing_id=$1', [listing])).rows[0];
        note('host', 'listing_reports', 'reporter_id', lr.reporter_id, lr.reporter_id === null);
        note('host', 'listing_reports', 'details', lr.details, cleared(lr.details, 'SENTINEL'));
        const ls = (await q('select status from public.listings where id=$1', [listing])).rows[0];
        note('host', 'listings', 'status (unpublished)', ls.status, ls.status === 'hidden');
        await authChecks('host', uid);
        report.host = uid;
    }

    // ---- CO-HOST ---------------------------------------------------------
    {
        const { uid } = await makeSubject('cohost');
        const listing = await listingFor(other);
        await q(`insert into public.listing_access (listing_id, user_id, email, invited_by, role, status) values ($1,$2,'SENTINEL@me-cohost.test',$3,'co_host','active')`, [listing, uid, other]);
        await anonymise(uid);
        const n = (await q('select count(*)::int n from public.listing_access where user_id=$1', [uid])).rows[0];
        note('cohost', 'listing_access', 'own co-host row+email', n.n, n.n === 0);
        const np = (await q('select count(*)::int n from public.notification_preferences where user_id=$1', [uid])).rows[0];
        note('cohost', 'notification_preferences', 'row', np.n, np.n === 0);
        await authChecks('cohost', uid);
        report.cohost = uid;
    }

    // ---- EXPERIENCE PROVIDER --------------------------------------------
    {
        const { uid } = await makeSubject('provider');
        const prov = await providerFor(uid, 'sponge');
        await q(`insert into public.service_provider_registrations (provider_id, scheme, number, verified_number) values ($1,'gas_safe','SENTINEL-REG-99','SENTINEL-VER-99')`, [prov]);
        await q(`insert into public.provider_ical_feeds (provider_id, url, clashes) values ($1,'https://sentinel.example/p.ics','[]'::jsonb)`, [prov]);
        await q(`insert into public.service_applications (email, name, trade, business_name, contact_phone, payload, token_hash, token_sent_at) values ('provider@gallowaydelete.test','SENTINEL App','cake','SENTINEL Biz','+447700900333','{"x":1}'::jsonb,'hash',now())`);
        await anonymise(uid);
        const sp = (await q('select business_name, provider_name, contact_email, contact_phone, based_line, collection_street, venue_lat, venue_lng, custom_label, stripe_product_description from public.service_providers where id=$1', [prov])).rows[0];
        note('provider', 'service_providers', 'business_name', sp.business_name, cleared(sp.business_name, 'SENTINEL'));
        for (const c of ['provider_name', 'contact_email', 'contact_phone', 'based_line', 'collection_street', 'venue_lat', 'venue_lng', 'custom_label', 'stripe_product_description']) note('provider', 'service_providers', c, sp[c], sp[c] === null);
        const reg = (await q('select count(*)::int n from public.service_provider_registrations where provider_id=$1', [prov])).rows[0];
        note('provider', 'service_provider_registrations', 'row (reg number)', reg.n, reg.n === 0);
        const pif = (await q('select count(*)::int n from public.provider_ical_feeds where provider_id=$1', [prov])).rows[0];
        note('provider', 'provider_ical_feeds', 'row', pif.n, pif.n === 0);
        const sa = (await q(`select count(*)::int n from public.service_applications where email='provider@gallowaydelete.test'`)).rows[0];
        note('provider', 'service_applications', 'row', sa.n, sa.n === 0);
        await authChecks('provider', uid);
        report.provider = uid;
    }

    // ---- TRADE -----------------------------------------------------------
    {
        const { uid } = await makeSubject('trade');
        const prov = await providerFor(uid, 'plumber');
        // A host (other) enquires with this trade; trade's reply + contact must go.
        await q(`insert into public.service_enquiries (reference, host_id, provider_id, trade, business_name, summary, expires_at,
                    host_name, host_phone, host_email, access_note, when_note, provider_reply, provider_phone, provider_email)
                 values ('REF-'||substr(gen_random_uuid()::text,1,8), $1, $2, 'plumber', 'SENTINEL Biz', 'SENTINEL summary', now()+interval '7 days',
                    'OTHER host','+447700000001','otherhost@x.test','host access','host when','SENTINEL provider reply','+447700900999','SENTINEL@prov.test')`, [other, prov]);
        // And one where this trade's owner is themselves the host side (rare but possible).
        await q(`insert into public.service_enquiries (reference, host_id, provider_id, trade, business_name, summary, expires_at,
                    host_name, host_phone, host_email, access_note, when_note)
                 values ('REF-'||substr(gen_random_uuid()::text,1,8), $1, $2, 'plumber', 'B', 'SENTINEL host-side summary', now()+interval '7 days',
                    'SENTINEL Host Name','+447700900444','SENTINEL@host.test','SENTINEL access','SENTINEL when')`, [uid, prov]);
        await anonymise(uid);
        const provSide = (await q(`select provider_reply, provider_phone, provider_email from public.service_enquiries where provider_id=$1 and host_id=$2`, [prov, other])).rows[0];
        for (const c of ['provider_reply', 'provider_phone', 'provider_email']) note('trade', 'service_enquiries(provider side)', c, provSide[c], provSide[c] === null);
        const hostSide = (await q(`select host_name, host_phone, host_email, access_note, when_note, summary from public.service_enquiries where host_id=$1`, [uid])).rows[0];
        for (const c of ['host_name', 'host_phone', 'host_email', 'access_note', 'when_note', 'summary']) note('trade', 'service_enquiries(host side)', c, hostSide[c], cleared(hostSide[c], 'SENTINEL'));
        await authChecks('trade', uid);
        report.trade = uid;
    }
} finally {
    // Always undo everything.
    await q('rollback').catch(() => {});
}

async function authChecks(role, uid) {
    const u = (await q('select email, phone, encrypted_password, banned_until, raw_user_meta_data, confirmation_token, recovery_token from auth.users where id=$1', [uid])).rows[0];
    note(role, 'auth.users', 'email', u.email, cleared(u.email, '@gallowaydelete'));
    note(role, 'auth.users', 'phone', u.phone, u.phone === null);
    note(role, 'auth.users', 'encrypted_password', u.encrypted_password, u.encrypted_password === null);
    note(role, 'auth.users', 'banned_until(set)', u.banned_until, u.banned_until !== null);
    note(role, 'auth.users', 'raw_user_meta_data', JSON.stringify(u.raw_user_meta_data), !JSON.stringify(u.raw_user_meta_data).includes('SENTINEL'));
    const id = (await q('select count(*)::int n from auth.identities where user_id=$1', [uid])).rows[0];
    note(role, 'auth.identities', 'row (sign-in)', id.n, id.n === 0);
    const se = (await q('select count(*)::int n from auth.sessions where user_id=$1', [uid])).rows[0];
    note(role, 'auth.sessions', 'row', se.n, se.n === 0);
    const ott = (await q('select count(*)::int n from auth.one_time_tokens where user_id=$1', [uid])).rows[0];
    note(role, 'auth.one_time_tokens', 'row', ott.n, ott.n === 0);
    const al = (await q(`select count(*)::int n, string_agg(ip_address::text,',') ips from auth.audit_log_entries where payload->>'actor_id'=$1`, [uid])).rows[0];
    note(role, 'auth.audit_log_entries', 'row (holds IP)', al.ips, al.n === 0);
}

await client.end();

// ---- Report ----------------------------------------------------------------
const byRole = {};
for (const r of rows) (byRole[r.role] ||= []).push(r);
for (const role of Object.keys(byRole)) {
    console.log(`\n=== ${role.toUpperCase()} (uid ${report[role] || '?'}) ===`);
    for (const r of byRole[role]) console.log(`  ${r.status.padEnd(7)} ${r.where.padEnd(42)} -> ${r.value}`);
}
console.log(`\nChecked ${rows.length} fields across ${Object.keys(byRole).length} roles. Leaks: ${leaks.length}`);
if (leaks.length) {
    console.log('\nLEAKS:');
    for (const l of leaks) console.log('  ' + l);
    process.exit(1);
}
console.log('\nAll personal data cleared. Reviews kept by design (shown as "Deleted user"). TEST rolled back — nothing persisted.');
