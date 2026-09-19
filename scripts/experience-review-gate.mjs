// Proof that only a completed experience earns a review.
//
// The migration 20260915141500_reviews_for_guest_experiences.sql claims a guest
// can review a provider ONLY for their own service order that is confirmed
// (paid) and whose date has passed — and that the client cannot forge the
// provider, the publish flag, or leave a review orphaned. RLS is what enforces
// that, and a direct postgres connection bypasses RLS, so this proves it the
// only way that counts: as the guest, through PostgREST, with a real token.
//
// Modelled on scripts/write-side-allowed.mjs. Everything is planted on canary
// rows and torn down afterwards, whatever happens.
//
//   node scripts/experience-review-gate.mjs            (test)

import { loadEnv } from './seed-lib.mjs';

const TEST_REF = 'yefoqcabuijcowoqewtc';
const PROD_REF = 'hviwjxigqivjfhmhpjiy';

const env = loadEnv('.env.local');
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || URL_BASE.includes(PROD_REF) || !URL_BASE.includes(TEST_REF)) {
    console.error('refusing to run: .env.local does not point at TEST');
    process.exit(1);
}

const TAG = 'gg-xp-review-gate';
let passed = 0, failed = 0;
const ok  = (n, d) => { passed++; console.log('  ✓ ' + n + (d ? '  (' + d + ')' : '')); };
const bad = (n, d) => { failed++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); };

async function asUser(token, method, path, body, prefer) {
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers: {
            apikey: ANON, Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', Prefer: prefer || 'return=minimal',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
}
async function svcRest(method, path, body, prefer) {
    const res = await fetch(URL_BASE + '/rest/v1' + path, {
        method,
        headers: {
            apikey: SERVICE, Authorization: 'Bearer ' + SERVICE,
            'Content-Type': 'application/json', Prefer: prefer || 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
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
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

const state = { users: [], provider: null, orders: {}, reviewId: null };

async function makeUser(email) {
    const existing = await adminAuth('GET', '/admin/users?page=1&per_page=200');
    for (const u of (existing.users || [])) if (u.email === email) await adminAuth('DELETE', '/admin/users/' + u.id);
    const made = await adminAuth('POST', '/admin/users', { email, password: 'canary-' + TAG + '-Aa1!', email_confirm: true });
    state.users.push(made.id);
    const si = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'canary-' + TAG + '-Aa1!' }),
    });
    const sj = await si.json();
    if (!sj.access_token) throw new Error('could not sign in as ' + email);
    return { id: made.id, token: sj.access_token, email };
}

async function plantOrder(key, { guestId, status, dateOffset }) {
    const r = await svcRest('POST', '/service_orders', [{
        provider_id: state.provider.id, guest_id: guestId, trade: 'chef',
        service_date: dayOffset(dateOffset), price: 120, quantity: 1, status,
        provider_business_name: 'Canary Kitchen', item_name: 'Private dinner',
    }]);
    if (!r.ok) throw new Error('plant order ' + key + ': ' + JSON.stringify(r.body).slice(0, 200));
    state.orders[key] = r.body[0].id;
}

async function run() {
    const guestA = await makeUser('guesta@' + TAG + '.test');
    const guestB = await makeUser('guestb@' + TAG + '.test');
    const owner  = await makeUser('owner@' + TAG + '.test');

    const p = await svcRest('POST', '/service_providers', [{
        owner_id: owner.id, business_name: 'Canary Kitchen', trade: 'chef',
        description: 'Canary provider — not real', audience: 'guest', status: 'approved',
        shape: 'request',
    }]);
    if (!p.ok) throw new Error('plant provider: ' + JSON.stringify(p.body).slice(0, 250));
    state.provider = { id: p.body[0].id };

    // Orders for guest A, in every state that matters.
    await plantOrder('confirmedPast', { guestId: guestA.id, status: 'confirmed',  dateOffset: -3 });
    await plantOrder('confirmedPast2',{ guestId: guestA.id, status: 'confirmed',  dateOffset: -5 });
    await plantOrder('cancelled',     { guestId: guestA.id, status: 'cancelled',  dateOffset: -3 });
    await plantOrder('authorised',    { guestId: guestA.id, status: 'authorised', dateOffset: -3 });
    await plantOrder('refunded',      { guestId: guestA.id, status: 'refunded',   dateOffset: -3 });
    await plantOrder('confirmedFuture', { guestId: guestA.id, status: 'confirmed', dateOffset: +7 });

    const review = (orderId, extra = {}) => ({
        order_id: orderId, reviewer_id: null, review_type: 'guest_to_provider',
        rating: 5, comment: 'Wonderful evening, generous host and superb food.', ...extra,
    });
    const insertAs = (u, orderId, extra) =>
        asUser(u.token, 'POST', '/reviews', { ...review(orderId, extra), reviewer_id: u.id }, 'return=representation');

    console.log('\nTHE GATE — as the guest, through PostgREST (RLS live)\n');

    // 1. The one that must work. A bogus reviewee_id is sent deliberately: the
    // column is grantable, but the trigger must overwrite it with the order's
    // true owner — proven from the stored row below.
    const good = await insertAs(guestA, state.orders.confirmedPast, { reviewee_id: guestB.id });
    if (good.ok && good.body?.[0]?.id) { ok('confirmed + date passed  → ACCEPTED', 'HTTP ' + good.status); state.reviewId = good.body[0].id; }
    else bad('confirmed + date passed should be accepted', 'HTTP ' + good.status + ' ' + JSON.stringify(good.body).slice(0, 200));

    // 2..N the ones that must not. A genuine policy refusal is 403 (RLS/column),
    // 401, or 409 (the one-per-order unique index). A 200 here would be the bug.
    const refuse = async (name, res) => {
        if (!res.ok && [400, 401, 403, 409].includes(res.status)) ok(name + '  → REFUSED', 'HTTP ' + res.status);
        else bad(name + ' should be refused', 'HTTP ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
    };
    await refuse('cancelled order',        await insertAs(guestA, state.orders.cancelled));
    await refuse('unpaid (authorised)',    await insertAs(guestA, state.orders.authorised));
    await refuse('refunded order',         await insertAs(guestA, state.orders.refunded));
    await refuse('confirmed but future',   await insertAs(guestA, state.orders.confirmedFuture));
    await refuse("another guest's order",  await insertAs(guestB, state.orders.confirmedPast));
    await refuse('same order twice',       await insertAs(guestA, state.orders.confirmedPast));

    console.log('\nWHAT THE CLIENT CANNOT FORGE\n');

    // provider_id / is_published are ungranted columns — naming either on insert
    // is refused outright, on a would-be-valid order of the guest's own.
    const forgeProvider = await insertAs(guestA, state.orders.confirmedPast2, { provider_id: state.provider.id });
    if (!forgeProvider.ok && forgeProvider.status === 403) ok('naming provider_id on insert  → REFUSED', 'HTTP ' + forgeProvider.status);
    else bad('client set provider_id', 'HTTP ' + forgeProvider.status);
    const forgePublish = await insertAs(guestA, state.orders.confirmedPast2, { is_published: true });
    if (!forgePublish.ok && forgePublish.status === 403) ok('naming is_published on insert  → REFUSED', 'HTTP ' + forgePublish.status);
    else bad('client set is_published', 'HTTP ' + forgePublish.status);

    // reviewee_id IS grantable, but the trigger overwrites it from the order.
    // The ACCEPTED review was inserted with reviewee_id = guestB (wrong on
    // purpose); confirm it carries the true owner, null cottage anchors, and
    // published-on-submit — none of it client-controlled.
    const stored = await svcRest('GET', '/reviews?id=eq.' + state.reviewId +
        '&select=provider_id,reviewee_id,listing_id,booking_id,is_published,review_type');
    const row = stored.body?.[0];
    if (row && row.provider_id === state.provider.id && row.reviewee_id === owner.id &&
        row.listing_id === null && row.booking_id === null && row.is_published === true) {
        ok('trigger filled provider/reviewee, nulled cottage anchors, published', 'reviewee=owner, listing=null');
    } else bad('stored row not as the trigger should set it', JSON.stringify(row));

    console.log('\nTHE PROVIDER REPLY — one public reply, only from the provider\n');
    // The provider (the owner of the reviewed provider) may set host_reply; the
    // "Providers can reply to reviews about them" policy authorises it on
    // reviewee_id = auth.uid(), which the trigger set to the owner above. This is
    // the exact call the browser ProviderReplyBox makes.
    const replyAsOwner = await asUser(owner.token, 'PATCH', '/reviews?id=eq.' + state.reviewId,
        { host_reply: 'Thank you — it was a pleasure cooking for you.', host_reply_at: new Date().toISOString() },
        'return=representation');
    if (replyAsOwner.ok && Array.isArray(replyAsOwner.body) && replyAsOwner.body.length === 1)
        ok('provider replies to a review about them  → ACCEPTED', 'HTTP ' + replyAsOwner.status);
    else bad('provider should be able to reply', 'HTTP ' + replyAsOwner.status + ' ' + JSON.stringify(replyAsOwner.body).slice(0, 160));

    // Anyone else's reply must not land. The row does not match the policy's
    // reviewee_id = auth.uid() for another user, so nothing updates.
    const replyAsOther = await asUser(guestB.token, 'PATCH', '/reviews?id=eq.' + state.reviewId,
        { host_reply: 'I am not the provider.' }, 'return=representation');
    if ((replyAsOther.ok && Array.isArray(replyAsOther.body) && replyAsOther.body.length === 0)
        || (!replyAsOther.ok && [401, 403].includes(replyAsOther.status)))
        ok('a non-provider replying  → REFUSED', 'no row updated / HTTP ' + replyAsOther.status);
    else bad('a non-provider should not be able to reply', 'HTTP ' + replyAsOther.status + ' ' + JSON.stringify(replyAsOther.body).slice(0, 160));

    // And the reply reads back on the public review, so it shows read-only on the
    // listing under the provider's first name.
    const readReply = await asUser(guestB.token, 'GET', '/reviews?id=eq.' + state.reviewId + '&select=host_reply');
    if (Array.isArray(readReply.body) && String(readReply.body[0]?.host_reply || '').includes('pleasure cooking'))
        ok('the reply reads back on the public review  → shows read-only', 'host_reply present');
    else bad('the reply is not readable on the public review', JSON.stringify(readReply.body).slice(0, 160));

    console.log('\nNEVER ORPHANED — the anchor CHECK\n');
    // Service role bypasses RLS but not the CHECK. Try to strip the order off the
    // accepted review: a guest_to_provider row with no order is exactly what
    // reviews_anchor_matches_type forbids.
    const strip = await svcRest('PATCH', '/reviews?id=eq.' + state.reviewId, { order_id: null });
    if (!strip.ok && String(JSON.stringify(strip.body)).includes('reviews_anchor_matches_type'))
        ok('removing the order from a provider review  → REFUSED by CHECK', 'HTTP ' + strip.status);
    else bad('CHECK did not stop an orphaned review', 'HTTP ' + strip.status + ' ' + JSON.stringify(strip.body).slice(0, 160));

    console.log('\nTHE TAKEDOWN — hidden_at removes it from every reader\n');
    const beforeAnon = await asUser(guestB.token, 'GET', '/reviews?id=eq.' + state.reviewId + '&select=id');
    const seenBefore = Array.isArray(beforeAnon.body) && beforeAnon.body.length === 1;
    await svcRest('PATCH', '/reviews?id=eq.' + state.reviewId, { hidden_at: new Date().toISOString(), hidden_reason: 'canary takedown' });
    const afterAnon = await asUser(guestB.token, 'GET', '/reviews?id=eq.' + state.reviewId + '&select=id');
    const seenAfter = Array.isArray(afterAnon.body) && afterAnon.body.length === 1;
    if (seenBefore && !seenAfter) ok('visible to another user, then hidden_at set → gone', 'before 1 row, after 0 rows');
    else bad('takedown did not remove the review from readers', 'before=' + seenBefore + ' after=' + seenAfter);
}

async function cleanup() {
    try {
        if (state.reviewId) await svcRest('DELETE', '/reviews?id=eq.' + state.reviewId);
        for (const id of Object.values(state.orders)) await svcRest('DELETE', '/service_orders?id=eq.' + id);
        // any reviews left tied to these orders
        if (state.provider) await svcRest('DELETE', '/reviews?provider_id=eq.' + state.provider.id);
        if (state.provider) await svcRest('DELETE', '/service_providers?id=eq.' + state.provider.id);
        for (const uid of state.users) await adminAuth('DELETE', '/admin/users/' + uid);
    } catch (e) { console.error('cleanup warning:', e.message); }
}

run()
    .catch((e) => { failed++; console.error('\nFATAL: ' + e.message); })
    .finally(async () => {
        await cleanup();
        console.log('\n' + '-'.repeat(60));
        console.log(passed + ' passed, ' + failed + ' failed');
        process.exit(failed ? 1 : 0);
    });
