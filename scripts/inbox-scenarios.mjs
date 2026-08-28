// Per-conversation actions in the inbox: mark as unread, star, archive.
//
// Drives the real routes over HTTP with a real session cookie, the same way
// the payment runners do, and writes conversation_prefs the way the browser
// does — as the signed-in user with their own access token, so row-level
// security is part of what is being tested rather than something bypassed.
//
// Needs `npm run dev`. Test project only; it refuses to run anywhere else.
//
// Its people live on @gallowayinbox.test, deliberately NOT the payment
// seeder's domain, so `seed-payments.mjs --reset` never touches them and this
// never disturbs a payment run. It cleans up after itself at the end, and
// `--reset` on its own clears anything an interrupted run left behind.

import {
    loadEnv,
    supabaseClient,
    signIn,
    dayOffset,
    TEST_PROJECT_REF,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
const db = supabaseClient(env);
// Checked before anything is written: never production, never the production
// database, never a build behind master. See scripts/target.mjs.
const BASE = await resolveTarget({
    runner: 'scripts/inbox-scenarios.mjs',
    envNames: ['BASE_URL', 'SITE_URL'],
    fallback: LOCAL_URL,
});

const DOMAIN = 'gallowayinbox.test';
const PASSWORD = 'inbox-password-';

// The payment seeder's guard checks the Stripe key too. Nothing here touches
// Stripe, so this checks the one thing that matters: which database.
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    throw new Error('refusing to run: not the test project (' + TEST_PROJECT_REF + ')');
}

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
    if (ok) {
        passed++;
        console.log('  ✓ ' + name);
    } else {
        failed++;
        console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
    }
}

/* ------------------------------------------------- talking to the routes */

async function get(path, cookie) {
    const res = await fetch(BASE + path, { headers: { cookie } });
    const text = await res.text();
    try {
        return { status: res.status, body: JSON.parse(text) };
    } catch {
        return { status: res.status, body: text };
    }
}

async function post(path, cookie, body) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
        return { status: res.status, body: JSON.parse(text) };
    } catch {
        return { status: res.status, body: text };
    }
}

// A write made exactly as the browser makes it: the user's own access token
// against PostgREST, with row-level security in force.
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
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: res.status, ok: res.ok, data };
}

const setPref = (token, userId, bookingId, patch) =>
    asUser(
        token,
        'POST',
        '/conversation_prefs?on_conflict=user_id,booking_id',
        { user_id: userId, booking_id: bookingId, ...patch },
        'resolution=merge-duplicates,return=representation'
    );

/* -------------------------------------------------------------- fixtures */

async function createUser(label, fullName) {
    const email = label + '@' + DOMAIN;
    const user = await db.auth('POST', '/admin/users', {
        email,
        password: PASSWORD + label,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });
    const existing = await db.select('profiles', '?select=id&id=eq.' + user.id);
    if (!existing.length) {
        await db.insert('profiles', { id: user.id, email, full_name: fullName });
    }
    return { id: user.id, email, label };
}

async function say(bookingId, from, to, body, read) {
    const [row] = await db.insert('messages', {
        booking_id: bookingId,
        sender_id: from.id,
        recipient_id: to.id,
        body,
        read_at: read ? new Date().toISOString() : null,
    });
    return row;
}

const messageById = async (id) =>
    (await db.select('messages', '?select=id,read_at,body&id=eq.' + id))[0];

async function reset() {
    const users = await db.auth('GET', '/admin/users?per_page=200');
    const mine = (users.users || []).filter((u) => (u.email || '').endsWith('@' + DOMAIN));

    for (const u of mine) {
        const listings = await db.select('listings', '?select=id&host_id=eq.' + u.id);
        for (const l of listings) {
            const bookings = await db.select('bookings', '?select=id&listing_id=eq.' + l.id);
            for (const b of bookings) {
                await db.remove('messages', '?booking_id=eq.' + b.id);
                await db.remove('conversation_prefs', '?booking_id=eq.' + b.id);
                await db.remove('bookings', '?id=eq.' + b.id);
            }
            await db.remove('listings', '?id=eq.' + l.id);
        }
    }
    for (const u of mine) {
        await db.remove('conversation_prefs', '?user_id=eq.' + u.id);
        await db.remove('profiles', '?id=eq.' + u.id);
        await db.auth('DELETE', '/admin/users/' + u.id);
    }

    console.log('cleaned up ' + mine.length + ' @' + DOMAIN + ' user(s)');
}

/* ------------------------------------------------------------------ main */

async function main() {
    if (process.argv.includes('--reset')) {
        await reset();
        return;
    }

    await reset();

    console.log('\nsetting up…');
    const host = await createUser('host', 'Inbox Host');
    const guest = await createUser('guest', 'Inbox Guest');

    const [listing] = await db.insert('listings', {
        host_id: host.id,
        title: 'SEED — Inbox Cottage',
        description: 'Seeded for inbox testing.',
        location: 'Dumfries & Galloway',
        price_per_night: 100,
        max_guests: 4,
        status: 'published',
        cancellation_policy: 'Moderate',
    });

    const [booking] = await db.insert('bookings', {
        listing_id: listing.id,
        guest_id: guest.id,
        host_id: host.id,
        check_in: dayOffset(14),
        check_out: dayOffset(18),
        guests: 2,
        adults: 2,
        total_price: 400,
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: 400,
        commission_rate: 10,
        paid_at: new Date().toISOString(),
    });

    // The guest asks, the host answers. So the last message in the thread is
    // the host's own reply, and the last message TO the host is the question.
    const question = await say(booking.id, guest, host, 'Is there parking at the cottage?', true);
    const reply = await say(booking.id, host, guest, 'Yes, two spaces right outside.', true);

    const hostAuth = await signIn(env, host.email, PASSWORD + 'host');
    const guestAuth = await signIn(env, guest.email, PASSWORD + 'guest');
    const hostCookie = hostAuth.cookie;
    const guestCookie = guestAuth.cookie;
    const hostToken = hostAuth.session.access_token;
    const guestToken = guestAuth.session.access_token;

    const mine = (r) => (r.body.conversations || []).find((c) => c.bookingId === booking.id);

    /* -- 1. mark as unread lands on the guest's question ------------------ */
    console.log('\n1. mark as unread picks the last message TO you');
    {
        const r = await post('/api/messages/mark-unread', hostCookie, { bookingId: booking.id });
        check('route succeeded and marked something', r.status === 200 && r.body.marked === true,
            JSON.stringify(r.body));

        const q = await messageById(question.id);
        const rp = await messageById(reply.id);
        check("the guest's question came back unread", q.read_at === null, 'read_at=' + q.read_at);
        check("the host's own reply was left alone", rp.read_at !== null, 'read_at=' + rp.read_at);

        const t = await get('/api/messages/threads', hostCookie);
        check('the list shows it as unread', mine(t).unread === 1, 'unread=' + mine(t).unread);
    }

    /* -- 2. archiving is per person --------------------------------------- */
    console.log('\n2. archiving is one person’s own');
    {
        const w = await setPref(hostToken, host.id, booking.id, {
            archived_at: new Date().toISOString(),
        });
        check('the host could write their own row', w.ok, w.status + ' ' + JSON.stringify(w.data));

        const h = await get('/api/messages/threads', hostCookie);
        const g = await get('/api/messages/threads', guestCookie);
        check('archived for the host', mine(h).archived === true);
        check('still in the inbox for the guest', mine(g).archived === false);
        check('the guest can still see the conversation at all', !!mine(g));
    }

    /* -- 3. archived is out of the counts, and the dot agrees ------------- */
    console.log('\n3. an archived conversation stops counting');
    {
        const t = await get('/api/messages/threads', hostCookie);
        check('kept out of the list total', t.body.totalUnread === 0,
            'totalUnread=' + t.body.totalUnread);

        const c = await get('/api/messages/unread-count', hostCookie);
        check('the menu dot agrees with the list', c.body.unread === t.body.totalUnread,
            'dot=' + c.body.unread + ' list=' + t.body.totalUnread);
    }

    /* -- 4. a new message brings it back ---------------------------------- */
    console.log('\n4. a message arriving un-archives it');
    {
        await say(booking.id, guest, host, 'Sorry, one more — can we arrive early?', false);

        const t = await get('/api/messages/threads', hostCookie);
        check('back in the inbox', mine(t).archived === false);
        check('and counting as unread again', mine(t).unread === 2, 'unread=' + mine(t).unread);

        const c = await get('/api/messages/unread-count', hostCookie);
        check('the menu dot agrees with the list', c.body.unread === t.body.totalUnread,
            'dot=' + c.body.unread + ' list=' + t.body.totalUnread);

        const g = await get('/api/messages/threads', guestCookie);
        check("the guest's own view is untouched", mine(g).archived === false);
    }

    /* -- 5. a READ message after archiving also brings it back ------------ */
    console.log('\n5. a message that arrived and was read still un-archives it');
    {
        await post('/api/messages/mark-read', hostCookie, { bookingId: booking.id });
        await setPref(hostToken, host.id, booking.id, { archived_at: new Date().toISOString() });

        // Arrived after the archive and has already been read, so it adds no
        // unread of its own — but it does bring the conversation back, and an
        // older unread message then has to be counted again.
        await say(booking.id, guest, host, 'Never mind, found it in the listing.', true);
        await db.update('messages', '?id=eq.' + question.id, { read_at: null });

        const t = await get('/api/messages/threads', hostCookie);
        check('back in the inbox', mine(t).archived === false);
        check('the older unread message counts again', mine(t).unread === 1,
            'unread=' + mine(t).unread);

        const c = await get('/api/messages/unread-count', hostCookie);
        check('the menu dot agrees with the list', c.body.unread === t.body.totalUnread,
            'dot=' + c.body.unread + ' list=' + t.body.totalUnread);
    }

    /* -- 6. moving it back to the inbox by hand --------------------------- */
    console.log('\n6. move to inbox clears it for good');
    {
        await setPref(hostToken, host.id, booking.id, { archived_at: new Date().toISOString() });
        let t = await get('/api/messages/threads', hostCookie);
        check('archived again', mine(t).archived === true);

        await setPref(hostToken, host.id, booking.id, { archived_at: null });
        t = await get('/api/messages/threads', hostCookie);
        check('and back in the inbox with nothing new arriving', mine(t).archived === false);
    }

    /* -- 7. starring ------------------------------------------------------ */
    console.log('\n7. starring is a flag, and one row per person');
    {
        await setPref(hostToken, host.id, booking.id, { starred_at: new Date().toISOString() });
        await setPref(hostToken, host.id, booking.id, { starred_at: new Date().toISOString() });

        const rows = await db.select(
            'conversation_prefs',
            '?select=user_id&user_id=eq.' + host.id + '&booking_id=eq.' + booking.id
        );
        check('starring twice leaves one row, not two', rows.length === 1, 'rows=' + rows.length);

        const h = await get('/api/messages/threads', hostCookie);
        const g = await get('/api/messages/threads', guestCookie);
        check('starred for the host', mine(h).starred === true);
        check('not starred for the guest', mine(g).starred === false);

        await setPref(hostToken, host.id, booking.id, { starred_at: null });
        const h2 = await get('/api/messages/threads', hostCookie);
        check('and it comes off again', mine(h2).starred === false);
    }

    /* -- 8. nobody can write anybody else's row --------------------------- */
    console.log('\n8. row-level security holds');
    {
        const w = await setPref(guestToken, host.id, booking.id, {
            archived_at: new Date().toISOString(),
        });
        check(
            "the guest cannot archive on the host's behalf",
            !w.ok && (w.status === 401 || w.status === 403),
            w.status + ' ' + JSON.stringify(w.data)
        );

        const r = await asUser(guestToken, 'GET', '/conversation_prefs?select=user_id');
        const leaked = (Array.isArray(r.data) ? r.data : []).filter((x) => x.user_id !== guest.id);
        check("and cannot read the host's rows", leaked.length === 0, 'leaked=' + leaked.length);
    }

    /* -- 9. nothing to mark unread ---------------------------------------- */
    console.log('\n9. a conversation with nothing addressed to you');
    {
        // The guest has received the host's reply, so use a fresh booking
        // where only the host has ever been written to.
        const [b2] = await db.insert('bookings', {
            listing_id: listing.id,
            guest_id: guest.id,
            host_id: host.id,
            check_in: dayOffset(40),
            check_out: dayOffset(43),
            guests: 2,
            adults: 2,
            total_price: 300,
            status: 'confirmed',
            payment_status: 'paid',
            amount_paid: 300,
            commission_rate: 10,
            paid_at: new Date().toISOString(),
        });
        await say(b2.id, guest, host, 'Hello, first message.', true);

        const r = await post('/api/messages/mark-unread', guestCookie, { bookingId: b2.id });
        check(
            'says so rather than reporting a success that changed nothing',
            r.status === 200 && r.body.ok === true && r.body.marked === false,
            JSON.stringify(r.body)
        );
    }

    /* -- 10. the database stamps the time, not the browser ---------------- */
    console.log('\n10. the server clock wins over the client\'s');
    {
        // Deliberately an hour out, which is far larger than any real skew.
        // If what comes back is an hour old, the browser's clock is being
        // stored and archiving is one slow laptop away from looking broken.
        const wrong = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await setPref(hostToken, host.id, booking.id, { archived_at: wrong });

        const [row] = await db.select(
            'conversation_prefs',
            '?select=archived_at,starred_at&user_id=eq.' + host.id + '&booking_id=eq.' + booking.id
        );
        const ageMs = Date.now() - new Date(row.archived_at).getTime();
        check(
            'a wildly wrong client timestamp is replaced with server time',
            ageMs < 60 * 1000,
            'stored value is ' + Math.round(ageMs / 1000) + 's old'
        );

        // The trigger has to tell a value that was just set apart from one
        // carried along unchanged. Getting this wrong meant starring a
        // conversation silently re-archived it.
        const archivedBefore = row.archived_at;
        await setPref(hostToken, host.id, booking.id, { starred_at: new Date().toISOString() });
        const [after] = await db.select(
            'conversation_prefs',
            '?select=archived_at,starred_at&user_id=eq.' + host.id + '&booking_id=eq.' + booking.id
        );
        check(
            'starring does not move the archive',
            after.archived_at === archivedBefore,
            'was ' + archivedBefore + ' now ' + after.archived_at
        );

        await setPref(hostToken, host.id, booking.id, { archived_at: null, starred_at: null });
    }

    console.log('\ncleaning up…');
    await reset();

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
    console.error('\nrunner failed:', err.message);
    process.exitCode = 1;
});
