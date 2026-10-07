// Proves door codes and wifi passwords are encrypted at rest and still reach
// exactly the people who saw them before. TEST only (guarded), against a
// running dev server with LISTING_SECRETS_KEY set.
//
// It plants a host, a listing, two guests with confirmed stays tomorrow and an
// outsider, with LEGACY PLAIN values (as stored before encryption). Then:
//   1. fingerprints every secret on TEST (hashes only, never printed),
//   2. runs the real /api/cron/seal-listing-secrets twice (the second must
//      find nothing to do),
//   3. checks every row on TEST is sealed and opens to its fingerprint,
//   4. reads through the app as the host (editor routes, message thread) and
//      as each guest (arrival screen) — the right value, in the right place,
//      for the right person, and the outsider gets none,
//   5. saves a new code and wifi password through the editor routes and checks
//      they are stored sealed and read back plain.
// The check-in sender's use is covered in tests/scheduled-messages.test.ts and
// tests/checkin-fallback.test.ts (running it here would send every overdue
// message on TEST, not just ours).
//
//   BASE_URL=http://localhost:<port> node scripts/prove-listing-secrets-sealed.mjs
//   node scripts/prove-listing-secrets-sealed.mjs --keep     (leave the fixture)

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnv, assertTestEnvironment, supabaseClient, signIn, SEED_DOMAIN } from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const { openSecret, sealSecret } = createRequire(import.meta.url)('./secretBox.cjs');
const env = loadEnv();
assertTestEnvironment(env);
if (!env.LISTING_SECRETS_KEY) throw new Error('LISTING_SECRETS_KEY is not in .env.local');
const SITE = await resolveTarget({ runner: 'scripts/prove-listing-secrets-sealed.mjs', envNames: ['BASE_URL', 'SITE_URL'], fallback: LOCAL_URL });
const db = supabaseClient(env);
const tag = 'seal-' + Date.now();
const PW = 'Test-' + tag + '-pw';
const V = { listing: 'LEGACY-L-' + tag.slice(-5), booking: 'LEGACY-B-' + tag.slice(-5), wifi: 'legacy-wifi-' + tag.slice(-5) };
const results = [];
const check = (name, ok, note = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`); };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
const hash = (table, id, v) => crypto.createHash('sha256').update(`${table}|${id}|${v}`).digest('hex');

async function user(role) {
    const email = `${role}-${tag}@${SEED_DOMAIN}`;
    const u = await db.auth('POST', '/admin/users', { email, password: PW, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: u.id, email, full_name: role + ' ' + tag.slice(-4) }], 'return=minimal,resolution=merge-duplicates');
    const { cookie } = await signIn(env, email, PW);
    return { id: u.id, email, cookie };
}
const as = async (cookie, path, init = {}) => {
    const r = await fetch(SITE + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) }, redirect: 'manual' });
    return { status: r.status, text: await r.text() };
};
const cron = async () => {
    const r = await fetch(SITE + '/api/cron/seal-listing-secrets', { headers: { authorization: 'Bearer ' + env.CRON_SECRET } });
    return { status: r.status, body: await r.json() };
};
async function everyRow() {
    const rows = [];
    for (const [table, key, col] of [['listing_access_codes', 'listing_id', 'code'], ['booking_access_codes', 'booking_id', 'code'], ['listing_arrival', 'listing_id', 'wifi_password']]) {
        for (let from = 0; ; from += 1000) {
            const page = await db.select(table, `?select=${key},${col}&order=${key}&offset=${from}&limit=1000`);
            for (const r of page) if (r[col] !== null) rows.push({ table, id: r[key], value: r[col] });
            if (page.length < 1000) break;
        }
    }
    return rows;
}

let fixture = null;
try {
    // ── The fixture, stored the old way: plain text ───────────────────────
    const host = await user('host'), g1 = await user('guest1'), g2 = await user('guest2'), outsider = await user('outsider');
    fixture = { listing: null, users: [host, g1, g2, outsider] };
    const listing = (await db.insert('listings', [{
        host_id: host.id, title: 'Sealed cottage ' + tag, location: 'Kirkcudbright, Dumfries and Galloway', price_per_night: 100,
        status: 'published', street_address: '1 Sealed Lane', postcode: 'DG6 4AA', check_in_method: 'Lockbox',
    }]))[0];
    fixture = { listing: listing.id, users: [host, g1, g2, outsider] };
    // Back to back (a listing takes one confirmed stay a night), both inside
    // the arrival window.
    const stay = (guest, from, to) => ({ listing_id: listing.id, guest_id: guest.id, host_id: host.id, check_in: day(from), check_out: day(to), total_price: 200, guests: 2, adults: 2, status: 'confirmed', payment_status: 'paid', confirmed_at: new Date().toISOString() });
    const [b1, b2] = await db.insert('bookings', [stay(g1, 1, 2), stay(g2, 2, 3)]);
    // Plain, as before encryption — unless the database lock
    // (20261006113742_listing_secrets_sealed_at_rest) is on, in which case it
    // must refuse them, and the fixture is planted sealed instead.
    let locked = false;
    try { await db.insert('listing_access_codes', [{ listing_id: listing.id, code: V.listing }]); }
    catch (e) { locked = /23514|_sealed/.test(String(e.message)); if (!locked) throw e; }
    if (locked) {
        check('The database refuses a plain door code', true, 'check constraint listing_access_codes_code_sealed');
        let refusedWifi = false, refusedBooking = false;
        try { await db.insert('listing_arrival', [{ listing_id: listing.id, wifi_password: V.wifi }]); } catch (e) { refusedWifi = /23514|_sealed/.test(String(e.message)); }
        try { await db.insert('booking_access_codes', [{ booking_id: b1.id, code: V.booking }]); } catch (e) { refusedBooking = /23514|_sealed/.test(String(e.message)); }
        check('…and a plain wifi password and booking code', refusedWifi && refusedBooking);
        await db.insert('listing_access_codes', [{ listing_id: listing.id, code: sealSecret(V.listing, 'listing_access_codes', listing.id, env) }]);
    }
    const put = (table, id, v) => (locked ? sealSecret(v, table, id, env) : v);
    await db.insert('booking_access_codes', [{ booking_id: b1.id, code: put('booking_access_codes', b1.id, V.booking) }]);
    await db.insert('listing_arrival', [{ listing_id: listing.id, wifi_name: 'SealedWifi', wifi_password: put('listing_arrival', listing.id, V.wifi) }]);

    // Two messages on guest 1's stay, written the old way: a check-in message
    // the system sent with the code and wifi written in, and a chat line the
    // host typed with the code in it, which must stay exactly as typed.
    const checkinText = `Hi! The lockbox code is ${V.booking}. Wifi password: ${V.wifi}. See you soon.`;
    const typedText = `Just in case: the code is ${V.booking}.`;
    const [mCheckin, mTyped] = await db.insert('messages', [
        { booking_id: b1.id, sender_id: host.id, recipient_id: g1.id, body: checkinText, automated: true },
        { booking_id: b1.id, sender_id: host.id, recipient_id: g1.id, body: typedText, automated: false },
    ]);

    // ── 1. Fingerprint every secret on TEST ──────────────────────────────
    const before = await everyRow();
    const prints = new Map(before.map((r) => [r.table + '|' + r.id, r.value.startsWith('v1:') ? null : hash(r.table, r.id, r.value)]));
    const plainBefore = before.filter((r) => !r.value.startsWith('v1:')).length;
    console.log(`TEST holds ${before.length} secrets, ${plainBefore} stored as plain text`);
    const legacyRead = JSON.parse((await as(host.cookie, '/api/listings/access-code?listing=' + listing.id)).text).code;
    check(locked ? 'The editor reads the code' : 'Before sealing: a plain (legacy) code still reads in the editor', legacyRead === V.listing);

    // ── 2. Seal, twice ────────────────────────────────────────────────────
    const first = await cron();
    const sealedNow = first.body.listingCodes?.sealedNow + first.body.bookingCodes?.sealedNow + first.body.wifiPasswords?.sealedNow;
    check('The sealing run converts every plain value', first.status === 200 && first.body.ok && sealedNow >= plainBefore, `HTTP ${first.status}, sealed ${sealedNow}; ${JSON.stringify(first.body)}`);
    const second = await cron();
    const again = second.body.listingCodes?.sealedNow + second.body.bookingCodes?.sealedNow + second.body.wifiPasswords?.sealedNow;
    check('A second run finds nothing to do, and every value opens', second.body.ok && again === 0, JSON.stringify(second.body));

    const [mc] = await db.select('messages', `?id=eq.${mCheckin.id}&select=body,automated`);
    const [mt] = await db.select('messages', `?id=eq.${mTyped.id}&select=body`);
    check('The sent check-in message is stored with placeholders, not the code or wifi password',
        mc.body === 'Hi! The lockbox code is {{gg.door_code}}. Wifi password: {{gg.wifi_password}}. See you soon.' && mc.automated === true, JSON.stringify(first.body.checkinMessages || {}));
    check('A code the host typed into the chat is left exactly as typed', mt.body === typedText);

    // ── 3. At rest: ciphertext only, and each opens to what it was ────────
    const after = await everyRow();
    const leftPlain = after.filter((r) => !r.value.startsWith('v1:'));
    const ours = after.filter((r) => r.id === listing.id || r.id === b1.id);
    check('Every secret on TEST is now ciphertext', leftPlain.length === 0, `${after.length} rows, ${leftPlain.length} plain`);
    check('Our planted values are not readable in the database', ours.length === 3 && ours.every((r) => !Object.values(V).some((v) => r.value.includes(v))));
    let same = 0, differ = 0;
    for (const r of after) {
        const was = prints.get(r.table + '|' + r.id);
        if (!was) continue;
        if (hash(r.table, r.id, openSecret(r.value, r.table, r.id, env)) === was) same++; else differ++;
    }
    check('Every converted value opens to exactly what it was', differ === 0 && same === plainBefore, `${same} identical, ${differ} different`);

    // ── 4. Through the app ────────────────────────────────────────────────
    const ed = JSON.parse((await as(host.cookie, '/api/listings/access-code?listing=' + listing.id)).text);
    const wifi = JSON.parse((await as(host.cookie, '/api/listings/arrival?listing=' + listing.id)).text);
    const bk = JSON.parse((await as(host.cookie, '/api/bookings/access-code?booking=' + b1.id)).text);
    check('Editor: the host sees the listing code, wifi password and booking code', ed.code === V.listing && wifi.arrival?.wifi_password === V.wifi && bk.code === V.booking);
    const resv = await as(host.cookie, '/dashboard/bookings/' + b1.id);
    check('Reservation page (host): the code this guest will use', resv.status === 200 && resv.text.includes(V.booking) && !resv.text.includes('v1:'), `HTTP ${resv.status}`);
    const thread = await as(host.cookie, '/api/messages/threads/' + b1.id);
    const threadMsgs = JSON.parse(thread.text).messages || [];
    const g1Thread = JSON.parse((await as(g1.cookie, '/api/messages/threads/' + b1.id)).text).messages || [];
    const shownTo = (msgs) => (msgs.find((m) => m.id === mCheckin.id) || {}).body;
    const expected = `Hi! The lockbox code is ${V.booking}. Wifi password: ${V.wifi}. See you soon.`;
    check('The check-in message shows the code and wifi to the host and to the guest inside the window', shownTo(threadMsgs) === expected && shownTo(g1Thread) === expected);
    const inbox = JSON.parse((await as(g1.cookie, '/api/messages/threads')).text);
    const preview = JSON.stringify(inbox);
    check('The inbox list never shows the wifi password (only the check-in message held it)', !preview.includes(V.wifi));
    check('Message thread (host): the booking’s own code and the wifi', thread.text.includes(V.booking) && thread.text.includes(V.wifi) && !thread.text.includes('v1:'), `HTTP ${thread.status}`);
    const a1 = await as(g1.cookie, '/arrival/' + b1.id), a2 = await as(g2.cookie, '/arrival/' + b2.id);
    check('Arrival screen, guest 1: their own override code and the wifi', a1.status === 200 && a1.text.includes(V.booking) && a1.text.includes(V.wifi) && !a1.text.includes(V.listing), `HTTP ${a1.status}`);
    check('Arrival screen, guest 2: the listing code and the wifi', a2.status === 200 && a2.text.includes(V.listing) && a2.text.includes(V.wifi) && !a2.text.includes(V.booking), `HTTP ${a2.status}`);
    const none = [await as(outsider.cookie, '/arrival/' + b1.id), await as(outsider.cookie, '/api/messages/threads/' + b1.id), await as(outsider.cookie, '/api/listings/access-code?listing=' + listing.id)];
    check('An outsider gets none of them', none.every((r) => !Object.values(V).some((v) => r.text.includes(v)) && !r.text.includes('v1:')), none.map((r) => r.status).join(', '));
    check('No page or route ever shows ciphertext', ![ed, wifi, bk].some((x) => JSON.stringify(x).includes('v1:')) && !a1.text.includes('v1:') && !a2.text.includes('v1:'));

    // ── 5. Saving through the editor stores ciphertext ────────────────────
    const NEW = { code: 'NEW-' + tag.slice(-5), wifi: 'new-wifi-' + tag.slice(-5) };
    const s1 = await as(host.cookie, '/api/listings/access-code', { method: 'POST', body: JSON.stringify({ listing: listing.id, code: NEW.code }) });
    const s2 = await as(host.cookie, '/api/listings/arrival', { method: 'POST', body: JSON.stringify({ listingId: listing.id, wifi_password: NEW.wifi }) });
    const [rowCode] = await db.select('listing_access_codes', `?listing_id=eq.${listing.id}&select=code`);
    const [rowWifi] = await db.select('listing_arrival', `?listing_id=eq.${listing.id}&select=wifi_password`);
    const back = JSON.parse((await as(host.cookie, '/api/listings/access-code?listing=' + listing.id)).text).code;
    const backWifi = JSON.parse((await as(host.cookie, '/api/listings/arrival?listing=' + listing.id)).text).arrival?.wifi_password;
    check('Saving in the editor stores ciphertext and reads back plain',
        s1.status === 200 && s2.status === 200 && rowCode.code.startsWith('v1:') && !rowCode.code.includes(NEW.code) && rowWifi.wifi_password.startsWith('v1:') && back === NEW.code && backWifi === NEW.wifi);
    const NEWB = 'NEWB-' + tag.slice(-5);
    const s3 = await as(host.cookie, '/api/bookings/access-code', { method: 'POST', body: JSON.stringify({ bookingId: b2.id, code: NEWB }) });
    const [rowB] = await db.select('booking_access_codes', `?booking_id=eq.${b2.id}&select=code`);
    const backB = JSON.parse((await as(host.cookie, '/api/bookings/access-code?booking=' + b2.id)).text).code;
    check('Saving a code for one booking stores ciphertext and reads back plain', s3.status === 200 && rowB && rowB.code.startsWith('v1:') && !rowB.code.includes(NEWB) && backB === NEWB, `HTTP ${s3.status}`);
    const g2Override = await as(g2.cookie, '/arrival/' + b2.id);
    check('…and that guest\u2019s arrival screen shows their new code', g2Override.text.includes(NEWB));
    await as(host.cookie, '/api/bookings/access-code', { method: 'POST', body: JSON.stringify({ bookingId: b2.id, code: '' }) });
    const g2After = await as(g2.cookie, '/arrival/' + b2.id);
    check('…and the guest’s arrival screen shows the new code', g2After.text.includes(NEW.code) && g2After.text.includes(NEW.wifi));
} finally {
    if (fixture && !process.argv.includes('--keep')) {
        if (fixture.listing) {
        await db.remove('booking_access_codes', `?booking_id=in.(${(await db.select('bookings', `?listing_id=eq.${fixture.listing}&select=id`)).map((b) => b.id).join(',') || '00000000-0000-0000-0000-000000000000'})`).catch(() => {});
        await db.remove('bookings', '?listing_id=eq.' + fixture.listing).catch(() => {});
        await db.remove('listing_arrival', '?listing_id=eq.' + fixture.listing).catch(() => {});
        await db.remove('listing_access_codes', '?listing_id=eq.' + fixture.listing).catch(() => {});
        await db.remove('listings', '?id=eq.' + fixture.listing).catch(() => {});
        }
        for (const u of fixture.users) { await db.remove('agreement_acceptances', '?user_id=eq.' + u.id).catch(() => {}); await db.remove('profiles', '?id=eq.' + u.id).catch(() => {}); await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {}); }
    }
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
    if (results.some((r) => !r)) process.exitCode = 1;
}
