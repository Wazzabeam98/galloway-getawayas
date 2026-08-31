// The other half of scripts/write-side-rls.mjs: what must STILL WORK.
//
// Narrowing a grant is the easy part. The risk is that it narrows one column
// too far and the site stops working — a guest who cannot book, a host who
// cannot accept, an account page that fails on save. Those failures do not
// announce themselves as security work going wrong; they look like the site
// being broken, and on a booking form they cost money quietly.
//
// A refusal script alone cannot see any of that. It is built to celebrate
// things not working, so a database that refused EVERYTHING would give it a
// perfect score. This is the negative control for the whole exercise, and it
// runs against production for the same reason the refusal probe does: test and
// production have diverged on grants, so a pass on test proves nothing about
// what a real guest can do tonight.
//
// EVERY WRITE HERE IS COPIED FROM THE DEPLOYED BROWSER CODE, column for column:
//
//   profile        app/account/page.tsx           upsert, six editable fields
//   signup profile components/auth/SignupModel.tsx upsert id/email/name/is_host
//   booking        components/BookingWidget.tsx    insert, twelve columns
//   host accept    components/BookingActions.tsx   update status, confirmed_at
//   review         components/LeaveReviewForm.tsx  insert, thirteen columns
//   host reply     components/HostReplyBox.tsx     update host_reply, _at
//
// If any of these is refused, a migration has gone too far and the site is
// broken for real users right now.
//
// Everything is done on canary rows and removed afterwards.
//
// Usage:
//   node scripts/write-side-allowed.mjs --target prod

import { loadEnv } from './seed-lib.mjs';

const PROD_REF = 'hviwjxigqivjfhmhpjiy';
const TEST_REF = 'yefoqcabuijcowoqewtc';

const args = process.argv.slice(2);
const targetName = (args.includes('--target') && args[args.indexOf('--target') + 1]) || 'test';
const ENV_FILE = { prod: '.env.production.local', test: '.env.local' }[targetName];
if (!ENV_FILE) { console.error('unknown --target'); process.exit(1); }

const env = loadEnv(ENV_FILE);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const wantRef = targetName === 'prod' ? PROD_REF : TEST_REF;
const otherRef = targetName === 'prod' ? TEST_REF : PROD_REF;
if (!URL_BASE || URL_BASE.includes(otherRef) || !URL_BASE.includes(wantRef)) {
    console.error('refusing to run: ' + ENV_FILE + ' does not point at ' + targetName);
    process.exit(1);
}

const TAG = 'gg-allowed-audit';
const CANARY_TITLE = 'CANARY — allowed-path check, not a real cottage';

let passed = 0, failed = 0;
const ok = (n, d) => { passed++; console.log('  ✓ ' + n + (d ? '  (' + d + ')' : '')); };
const bad = (n, d) => { failed++; console.log('  ✗ ' + n + '\n      ' + d); };

async function asUser(token, method, path, body, prefer) {
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers: {
            apikey: ANON,
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Prefer: prefer || 'return=minimal',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

async function svcRest(method, path, body) {
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers: {
            apikey: SERVICE, Authorization: 'Bearer ' + SERVICE,
            'Content-Type': 'application/json', Prefer: 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}

async function adminAuth(method, endpoint, body) {
    const res = await fetch(URL_BASE + '/auth/v1' + endpoint, {
        method,
        headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(method + ' ' + endpoint + ': ' + text.slice(0, 250));
    return text ? JSON.parse(text) : null;
}

const dayOffset = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
};

const state = { guest: null, host: null, listing: null, booking: null, review: null, users: [] };

async function makeUser(email) {
    const existing = await adminAuth('GET', '/admin/users?page=1&per_page=200');
    for (const u of (existing.users || [])) {
        if (u.email === email) await adminAuth('DELETE', '/admin/users/' + u.id);
    }
    const made = await adminAuth('POST', '/admin/users', {
        email, password: 'canary-' + TAG + '-Aa1!', email_confirm: true,
    });
    state.users.push(made.id);
    const si = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'canary-' + TAG + '-Aa1!' }),
    });
    const sj = await si.json();
    if (!sj.access_token) throw new Error('could not sign in as ' + email);
    return { id: made.id, token: sj.access_token, email };
}

async function plant() {
    state.guest = await makeUser('guest@' + TAG + '.test');
    state.host = await makeUser('host@' + TAG + '.test');

    const l = await svcRest('POST', '/listings', [{
        host_id: state.host.id, title: CANARY_TITLE,
        location: 'Nowhere, Dumfries and Galloway',
        price_per_night: 100, status: 'draft',
    }]);
    if (!l.ok) throw new Error('could not plant listing: ' + JSON.stringify(l.body).slice(0, 200));
    state.listing = l.body[0].id;
}

async function cleanup() {
    if (state.booking) await svcRest('DELETE', '/reviews?booking_id=eq.' + state.booking);
    if (state.listing) {
        await svcRest('DELETE', '/bookings?listing_id=eq.' + state.listing);
        await svcRest('DELETE', '/listings?id=eq.' + state.listing);
    }
    for (const id of state.users) {
        try { await adminAuth('DELETE', '/admin/users/' + id); } catch { /* cascade */ }
    }
}

async function run() {
    console.log('\n  THE ALLOWED PATHS — against '
        + (targetName === 'prod' ? 'PRODUCTION' : 'test') + '\n');
    console.log('  every write below is copied from the deployed browser code.');
    console.log('  a failure here means the site is broken for real users.\n');

    await plant();

    /* ---- the account page ------------------------------------------------ */
    console.log('  app/account/page.tsx — the six editable fields');

    for (const [col, value] of [
        ['full_name', 'Canary Guest'],
        ['preferred_name', 'Can'],
        ['phone', '07700 900123'],
        ['residential_address', '2 Canary Cottage, Kirkcudbright'],
        ['avatar_url', 'avatars/canary.png'],
        ['show_full_name', true],
    ]) {
        // update().eq('id', uid), exactly as the page does it since the
        // upsert was removed. The row always exists — add_profile_for_new_user
        // makes it — and an update needs only UPDATE on the one column, where
        // the upsert also needed SELECT on email and so could not work at all
        // once 20260828234003 revoked it.
        const r = await asUser(state.guest.token, 'PATCH',
            '/profiles?id=eq.' + state.guest.id, { [col]: value });

        const back = await svcRest('GET', '/profiles?id=eq.' + state.guest.id + '&select=' + col);
        const stored = back.ok && back.body.length ? back.body[0][col] : undefined;

        if (r.ok && String(stored) === String(value)) ok('a user can set their own ' + col);
        else bad('a user can set their own ' + col,
            'HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 150)
            + ' | stored=' + JSON.stringify(stored));
    }

    // The signup modal's shape after the fix: the name, and nothing else.
    const signup = await asUser(state.guest.token, 'PATCH',
        '/profiles?id=eq.' + state.guest.id, { full_name: 'Canary Guest' });
    if (signup.ok) ok('the signup modal can still write a profile');
    else bad('the signup modal can still write a profile',
        'HTTP ' + signup.status + ' ' + JSON.stringify(signup.body).slice(0, 180));

    /* ---- the booking widget ---------------------------------------------- */
    console.log('\n  components/BookingWidget.tsx — a guest creates a booking');

    const created = await asUser(state.guest.token, 'POST', '/bookings', [{
        listing_id: state.listing,
        guest_id: state.guest.id,
        host_id: state.host.id,
        check_in: dayOffset(400),
        check_out: dayOffset(403),
        guests: 2,
        adults: 2,
        children: 0,
        pets: 0,
        total_price: 300,
        status: 'pending_payment',
        confirmed_at: null,
    }], 'return=representation');

    if (created.ok && Array.isArray(created.body) && created.body.length) {
        state.booking = created.body[0].id;
        ok('a guest can still create a booking', 'all twelve columns accepted');
    } else {
        // Fall back to a sweep: the row may exist even if it cannot be read back.
        const sweep = await svcRest('GET', '/bookings?listing_id=eq.' + state.listing + '&select=id');
        if (sweep.ok && sweep.body.length) {
            state.booking = sweep.body[0].id;
            ok('a guest can still create a booking', 'row landed; representation withheld');
        } else {
            bad('a guest can still create a booking',
                'THE BOOKING FORM IS BROKEN — HTTP ' + created.status + ' '
                + JSON.stringify(created.body).slice(0, 220));
        }
    }

    /* ---- the host accepting ---------------------------------------------- */
    console.log('\n  components/BookingActions.tsx — the host accepts');

    if (!state.booking) {
        bad('a host can accept a booking', 'no booking to accept — the insert above failed');
    } else {
        const accepted = await asUser(state.host.token, 'PATCH', '/bookings?id=eq.' + state.booking, {
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
        });
        const back = await svcRest('GET', '/bookings?id=eq.' + state.booking + '&select=status');
        const now = back.ok && back.body.length ? back.body[0].status : null;

        if (now === 'confirmed') ok('a host can accept a booking on their own listing');
        else bad('a host can accept a booking on their own listing',
            'HTTP ' + accepted.status + ' ' + JSON.stringify(accepted.body).slice(0, 180)
            + ' | status is still ' + now);
    }

    /* ---- leaving a review ------------------------------------------------ */
    console.log('\n  components/LeaveReviewForm.tsx — a guest reviews their own stay');

    // The stay has to be finished and confirmed for the strict policies and the
    // reviews_check_window trigger to admit it. Moved back with the service
    // role, which is what the passage of time would otherwise do.
    if (state.booking) {
        await svcRest('PATCH', '/bookings?id=eq.' + state.booking, {
            check_in: dayOffset(-6), check_out: dayOffset(-3), status: 'confirmed',
        });

        const review = await asUser(state.guest.token, 'POST', '/reviews', [{
            booking_id: state.booking,
            listing_id: state.listing,
            reviewer_id: state.guest.id,
            reviewee_id: state.host.id,
            review_type: 'guest_to_host',
            rating: 5,
            comment: 'CANARY — allowed-path check. A genuine review by the actual guest.',
            cleanliness_rating: 5, accuracy_rating: 5, checkin_rating: 5,
            communication_rating: 5, location_rating: 5, value_rating: 5,
        }], 'return=representation');

        const sweep = await svcRest('GET', '/reviews?booking_id=eq.' + state.booking + '&select=id');
        const landed = sweep.ok && Array.isArray(sweep.body) ? sweep.body : [];

        if (landed.length) {
            state.review = landed[0].id;
            ok('the actual guest can still review their own stay', 'all thirteen columns accepted');
        } else {
            bad('the actual guest can still review their own stay',
                'REVIEWING IS BROKEN — HTTP ' + review.status + ' '
                + JSON.stringify(review.body).slice(0, 220));
        }
    }

    /* ---- the host replying ----------------------------------------------- */
    console.log('\n  components/HostReplyBox.tsx — the host replies');

    if (!state.review) {
        bad('a host can reply to a review about them', 'no review to reply to');
    } else {
        const reply = await asUser(state.host.token, 'PATCH', '/reviews?id=eq.' + state.review, {
            host_reply: 'Thank you — a canary reply.',
            host_reply_at: new Date().toISOString(),
        });
        const back = await svcRest('GET', '/reviews?id=eq.' + state.review + '&select=host_reply');
        const stored = back.ok && back.body.length ? back.body[0].host_reply : null;

        if (stored && stored.indexOf('canary reply') !== -1) {
            ok('a host can reply to a review about them');
        } else {
            bad('a host can reply to a review about them',
                'HTTP ' + reply.status + ' ' + JSON.stringify(reply.body).slice(0, 180));
        }
    }

    console.log('\n  ' + passed + ' still work, ' + failed + ' BROKEN\n');
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
    console.log('  canary removed\n');
}
process.exit(code ? 1 : 0);
