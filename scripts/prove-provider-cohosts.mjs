// Proves co-hosts on a business (an experience or a trade) can do every save
// their permissions cover, and nothing more — signed in as REAL co-host accounts
// on TEST, against a running copy of the app. The holiday-let rule (CLAUDE.md):
// a page that opens for a new kind of user proves nothing; test the SAVES as them.
//
//   node scripts/seed-provider-cohosts.mjs       # the two co-host accounts
//   SITE=<local dev server> node scripts/prove-provider-cohosts.mjs
//
// What it does, in order:
//   1. the owners invite through the real route; the co-hosts accept through the
//      real route (Jamie: full access on the sauna, the chef and the plumber;
//      Rowan: calendar only on the sauna)
//   2. every dashboard page opens for Jamie (no bounce to "list your business")
//   3. every route-backed save, as Jamie: 200 (or the route's own business-logic
//      answer, never 403); and as Rowan, where Rowan lacks the permission: 403
//   4. every BROWSER write the business pages make, with Jamie's own token and the
//      anon key — exactly what supabase-js does in the page — so the row
//      policies are what is being tested; and Rowan refused where he should be
//   5. what stays the owner's: payouts, subscription, VAT, minting full access
// Each change it makes is put back. Leaves the grants in place for a browser walk;
// `seed-provider-cohosts.mjs --reset` removes them.
//
// TEST PROJECT ONLY.

import { loadEnv, assertTestEnvironment, supabaseClient, signIn, dayOffset } from './seed-lib.mjs';
import { resolveTarget } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
// Where to point: scripts/target.cjs decides, and refuses production, the
// production database or a stale build. SITE=<url> picks a local server.
const SITE = await resolveTarget({ runner: 'prove-provider-cohosts', envNames: ['SITE'] });
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const FULL = 'cohost-full@gallowaycohost.test';
const CAL = 'cohost-cal@gallowaycohost.test';
const PW = 'cohost-seed-2026';
const EXP_PW = 'experience-seed-2026';
const TRADE_PW = 'walk-the-trade-2026';
const ALL = { can_calendar: true, can_messages: true, can_bookings: true, can_listing: true, can_earnings: true };

let passed = 0;
const failed = [];
function check(label, ok, detail) {
    if (ok) { passed++; console.log('  ✓ ' + label); }
    else { failed.push(label); console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
}

async function api(who, method, path, body) {
    const res = await fetch(SITE + path, {
        method,
        redirect: 'manual',
        headers: { Cookie: who.cookie, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* a page, or empty */ }
    return { status: res.status, data, location: res.headers.get('location') || '' };
}

// The browser's own write: anon key + the person's token, so RLS decides.
async function rls(who, method, pathAndQuery, body, prefer = 'return=representation') {
    const res = await fetch(URL_ + '/rest/v1' + pathAndQuery, {
        method,
        headers: { apikey: ANON, Authorization: 'Bearer ' + who.session.access_token, 'Content-Type': 'application/json', Prefer: prefer },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}
const wrote = (r) => r.status < 300 && Array.isArray(r.data) && r.data.length > 0;

async function session(email, pw) { return signIn(env, email, pw); }

async function providerByName(name) {
    const rows = await db.select('service_providers', '?business_name=eq.' + encodeURIComponent(name) + '&select=id,owner_id,business_name,hourly_rate,description,photos');
    if (!rows || !rows[0]) throw new Error('No ' + name + ' on TEST — run scripts/seed-experiences.mjs / seed-trades-parity.mjs');
    return rows[0];
}

async function grantVia(owner, cohost, provider, perms) {
    // Clear any earlier run's grant, then the real invite + accept.
    await db.remove('provider_access', '?provider_id=eq.' + provider.id + '&email=eq.' + encodeURIComponent(cohost.email));
    const inv = await api(owner, 'POST', '/api/listing-access', { action: 'invite', kind: 'provider', providerId: provider.id, email: cohost.email, ...perms });
    check('owner invites ' + cohost.email.split('@')[0] + ' to ' + provider.business_name, inv.status === 200 && inv.data && inv.data.ok, JSON.stringify(inv.data));
    const pending = await api(cohost, 'GET', '/api/listing-access/pending');
    const mine = ((pending.data && pending.data.invites) || []).find((i) => i.listingId === provider.id);
    check('  …it shows in their pending invitations', !!mine && mine.kind === 'provider');
    const acc = await api(cohost, 'POST', '/api/listing-access/accept', { token: mine && mine.token });
    check('  …and they accept it', acc.status === 200 && acc.data && acc.data.ok && acc.data.home === '/services/dashboard', JSON.stringify(acc.data));
}

async function main() {
    const sauna = await providerByName('Loch Sauna');
    const chef = await providerByName('Solway Table');
    const plumber = await providerByName('Solway Plumbing');

    const jamie = { email: FULL, ...(await session(FULL, PW)) };
    const rowan = { email: CAL, ...(await session(CAL, PW)) };
    const saunaOwner = await session('seed-sauna@gallowayexp.test', EXP_PW);
    const chefOwner = await session('seed-chef@gallowayexp.test', EXP_PW);
    const plumberOwner = await session('seed-plumber@gallowaytrade.test', TRADE_PW);

    console.log('\n1. Invite and accept, the real way');
    await grantVia(saunaOwner, jamie, sauna, ALL);
    await grantVia(saunaOwner, rowan, sauna, { can_calendar: true });
    await grantVia(chefOwner, jamie, chef, ALL);
    await grantVia(plumberOwner, jamie, plumber, ALL);

    console.log('\n2. The dashboard pages open for a co-host');
    for (const p of ['/services/dashboard', '/services/dashboard/calendar', '/services/dashboard/listing', '/services/dashboard/edit', '/services/dashboard/earnings', '/services/dashboard/people', '/messages']) {
        const r = await fetch(SITE + p, { headers: { Cookie: jamie.cookie }, redirect: 'manual' });
        const html = r.status === 200 ? await r.text() : '';
        const bounced = r.status >= 300 && r.status < 400 ? r.headers.get('location') : '';
        check('Jamie opens ' + p, (r.status === 200 && !/No business here yet/.test(html)) || /services\/dashboard/.test(bounced || ''), r.status + ' ' + (bounced || ''));
    }
    {
        // Rowan may run a business of his own (the sign-up walk leaves a draft),
        // so the test is that the sauna's co-hosts are not his to manage.
        const r = await fetch(SITE + '/services/dashboard/people', { headers: { Cookie: rowan.cookie }, redirect: 'manual' });
        const html = r.status === 200 ? await r.text() : '';
        check('Rowan (calendar only) cannot manage the sauna’s co-hosts', !html.includes('Loch Sauna'), String(r.status));
    }

    console.log('\n3. Route-backed saves — the experience (sauna)');
    const future = dayOffset(75);
    {
        // Partial block on the diary, then remove it.
        const add = await api(jamie, 'POST', '/api/services/slots/blocks', { providerId: sauna.id, date: future, start: '06:00', end: '07:00' });
        check('calendar: Jamie blocks part of a day', add.status === 200 && add.data && add.data.ok, JSON.stringify(add.data));
        const id = add.data && (add.data.id || (add.data.block && add.data.block.id));
        if (id) {
            const del = await api(jamie, 'DELETE', '/api/services/slots/blocks', { providerId: sauna.id, id });
            check('calendar: …and unblocks it', del.status === 200, JSON.stringify(del.data));
        }
        const addR = await api(rowan, 'POST', '/api/services/slots/blocks', { providerId: sauna.id, date: future, start: '06:00', end: '07:00' });
        check('calendar: Rowan (calendar) blocks part of a day too', addR.status === 200, JSON.stringify(addR.data));
        const idR = addR.data && (addR.data.id || (addR.data.block && addR.data.block.id));
        if (idR) await api(rowan, 'DELETE', '/api/services/slots/blocks', { providerId: sauna.id, id: idR });
    }
    {
        const dec = await api(jamie, 'POST', '/api/services/slots/sessions/declare', { providerId: sauna.id, dates: [dayOffset(80)], sessions: [{ time: '05:30', durationMinutes: 60, capacity: 4 }] });
        check('calendar: Jamie opens a dated session', dec.status === 200 && dec.data && dec.data.ok !== false, JSON.stringify(dec.data).slice(0, 200));
        const made = await db.select('slot_sessions', '?provider_id=eq.' + sauna.id + '&session_date=eq.' + dayOffset(80) + '&session_time=eq.05:30:00&select=id');
        for (const s of made || []) {
            const del = await api(jamie, 'DELETE', '/api/services/slots/sessions/declare', { providerId: sauna.id, id: s.id });
            check('calendar: …and removes it', del.status === 200, JSON.stringify(del.data));
        }
        const sess = await api(jamie, 'GET', '/api/services/slots/sessions?provider=' + sauna.id);
        check('calendar: Jamie reads the sessions', sess.status === 200);
        const sched = await api(jamie, 'GET', '/api/services/slots/schedule?provider=' + sauna.id);
        check('calendar: Jamie reads the weekly schedule', sched.status === 200);
    }
    {
        const ord = await api(jamie, 'GET', '/api/services/orders?provider=' + sauna.id);
        check('bookings: Jamie lists the orders', ord.status === 200, String(ord.status));
        const ordR = await api(rowan, 'GET', '/api/services/orders?provider=' + sauna.id);
        check('calendar: Rowan (calendar) reads who is booked, for the diary', ordR.status === 200, String(ordR.status));
        const order = (await db.select('service_orders', '?provider_id=eq.' + sauna.id + '&status=eq.confirmed&select=id&limit=1'))[0];
        const note = await api(jamie, 'POST', '/api/services/orders/host-note', { orderId: order.id, note: 'Co-host note (proof)' });
        check('bookings: Jamie saves a private note on a booking', note.status === 200 && note.data && note.data.ok, JSON.stringify(note.data));
        await api(jamie, 'POST', '/api/services/orders/host-note', { orderId: order.id, note: '' });
        const noteR = await api(rowan, 'POST', '/api/services/orders/host-note', { orderId: order.id, note: 'x' });
        check('bookings: Rowan cannot', noteR.status === 403, String(noteR.status));

        const msg = await api(jamie, 'POST', '/api/messages/order/' + order.id, { body: 'Hello from the co-host (automated proof — ignore).' });
        check('messages: Jamie replies on a booking thread', msg.status === 200 && msg.data && msg.data.ok, JSON.stringify(msg.data).slice(0, 200));
        if (msg.data && msg.data.message) await db.remove('messages', '?id=eq.' + msg.data.message.id);
        const thr = await api(jamie, 'GET', '/api/messages/order/' + order.id);
        check('messages: Jamie reads the thread', thr.status === 200);
        const msgR = await api(rowan, 'POST', '/api/messages/order/' + order.id, { body: 'x' });
        check('messages: Rowan (no messages) cannot', msgR.status === 403, String(msgR.status));
    }
    {
        const before = (await db.select('service_providers', '?id=eq.' + sauna.id + '&select=business_name,guest_details'))[0];
        const gd = before.guest_details || {};
        const s1 = await api(jamie, 'POST', '/api/services/listing/save', { providerId: sauna.id, section: 'title', data: { business_name: before.business_name } });
        check('listing: Jamie saves the title', s1.status === 200 && s1.data && s1.data.ok, JSON.stringify(s1.data));
        const s2 = await api(jamie, 'POST', '/api/services/listing/save', { providerId: sauna.id, section: 'about', data: { professional_title: gd.professional_title || null, years_experience: gd.years_experience || null, qualifications: gd.qualifications || null, recognition: gd.recognition || null, headshot: null } });
        check('listing: Jamie saves the host profile', s2.status === 200 && s2.data && s2.data.ok, JSON.stringify(s2.data));
        const sR = await api(rowan, 'POST', '/api/services/listing/save', { providerId: sauna.id, section: 'title', data: { business_name: 'Hijacked' } });
        check('listing: Rowan (no listing) cannot', sR.status === 403, String(sR.status));
        const p1 = await api(jamie, 'POST', '/api/services/listing/pause', { providerId: sauna.id, paused: true });
        const p2 = await api(jamie, 'POST', '/api/services/listing/pause', { providerId: sauna.id, paused: false });
        check('listing: Jamie (full access) takes it down and puts it back', p1.status === 200 && p2.status === 200, JSON.stringify([p1.data, p2.data]));
        const pR = await api(rowan, 'POST', '/api/services/listing/pause', { providerId: sauna.id, paused: true });
        check('listing: Rowan cannot take it down', pR.status === 403, String(pR.status));
    }

    console.log('\n3b. Route-backed saves — the chef (bookings answer) and the plumber (a trade)');
    {
        const auth = (await db.select('service_orders', '?provider_id=eq.' + chef.id + '&status=eq.authorised&select=id&limit=1'))[0];
        if (auth) {
            // accept_date with no date change pending is refused by the route's own
            // rule (409) — past the permission check, without moving any money.
            const r = await api(jamie, 'POST', '/api/services/orders/respond', { orderId: auth.id, decision: 'accept_date' });
            check('bookings: Jamie reaches the chef’s booking answer (past the permission check)', r.status !== 403 && r.status !== 401, r.status + ' ' + JSON.stringify(r.data));
            const rR = await api(rowan, 'POST', '/api/services/orders/respond', { orderId: auth.id, decision: 'accept_date' });
            check('bookings: Rowan (not on the chef) is refused', rR.status === 403, String(rR.status));
        }
        const day = dayOffset(90);
        const tb = await api(jamie, 'POST', '/api/services/trade-blocks', { providerId: plumber.id, day });
        check('calendar: Jamie takes a day off for the plumber', tb.status === 200, JSON.stringify(tb.data));
        const tbd = await api(jamie, 'DELETE', '/api/services/trade-blocks', { providerId: plumber.id, day });
        check('calendar: …and gives it back', tbd.status === 200, JSON.stringify(tbd.data));
        const skillRows = await db.select('service_provider_skills', '?provider_id=eq.' + plumber.id + '&select=service_skills(label)');
        const labels = (skillRows || []).map((r) => r.service_skills && r.service_skills.label).filter(Boolean);
        const sk = await api(jamie, 'POST', '/api/services/skills', { providerId: plumber.id, labels });
        check('listing: Jamie saves the plumber’s skills', sk.status === 200, JSON.stringify(sk.data));
        const enq = (await db.select('service_enquiries', '?provider_id=eq.' + plumber.id + '&status=not.in.(sent,viewed)&select=id&limit=1'))[0];
        if (enq) {
            const er = await api(jamie, 'POST', '/api/services/enquiries/respond-as-owner', { enquiryId: enq.id, decision: 'accept' });
            check('bookings: Jamie reaches an enquiry answer (past the permission check)', er.status !== 403 && er.status !== 401, er.status + ' ' + JSON.stringify(er.data));
        }
        const pages = await fetch(SITE + '/services/dashboard/edit', { headers: { Cookie: jamie.cookie }, redirect: 'manual' });
        check('Jamie opens the business editor', pages.status === 200 || pages.status === 307, String(pages.status));
    }

    console.log('\n4. Browser writes — the row policies, with the co-host’s own token');
    {
        // The experience's imported calendars (ExperienceIcalFeeds).
        const add = await rls(jamie, 'POST', '/provider_ical_feeds', { provider_id: sauna.id, label: 'Co-host proof', url: 'https://example.com/proof.ics' });
        check('calendar: Jamie adds an imported calendar', wrote(add), add.status + ' ' + JSON.stringify(add.data).slice(0, 200));
        const id = wrote(add) && add.data[0].id;
        if (id) {
            const del = await rls(jamie, 'DELETE', '/provider_ical_feeds?id=eq.' + id);
            check('calendar: …and removes it', wrote(del), del.status + ' ' + JSON.stringify(del.data).slice(0, 120));
        }
        const addR = await rls(rowan, 'POST', '/provider_ical_feeds', { provider_id: sauna.id, label: 'Rowan proof', url: 'https://example.com/r.ics' });
        check('calendar: Rowan (calendar) can too', wrote(addR), addR.status + ' ' + JSON.stringify(addR.data).slice(0, 200));
        if (wrote(addR)) await rls(rowan, 'DELETE', '/provider_ical_feeds?id=eq.' + addR.data[0].id);
        const stranger = await rls(rowan, 'POST', '/provider_ical_feeds', { provider_id: chef.id, label: 'x', url: 'https://example.com/x.ics' });
        check('calendar: Rowan cannot touch a business he isn’t on', !wrote(stranger), String(stranger.status));
    }
    {
        // The trade editor (ProviderBusinessEditor) writes straight from the browser.
        const p = plumber;
        // supabase-js .update().eq() sends return=minimal (the row's private
        // columns are not readable back) — so the change is confirmed by reading
        // the row afterwards with the service key, then put back.
        const readRow = async () => (await db.select('service_providers', '?id=eq.' + p.id + '&select=description,hourly_rate,photos'))[0];
        const marker = (p.description || '') + ' ';
        const r1 = await rls(jamie, 'PATCH', '/service_providers?id=eq.' + p.id, { business_name: p.business_name, description: marker }, 'return=minimal');
        check('listing: Jamie saves the trade’s name and description', r1.status < 300 && (await readRow()).description === marker, r1.status + ' ' + JSON.stringify(r1.data).slice(0, 200));
        await db.update('service_providers', '?id=eq.' + p.id, { description: p.description });
        const rate = Number(p.hourly_rate || 50) + 1;
        const r2 = await rls(jamie, 'PATCH', '/service_providers?id=eq.' + p.id, { hourly_rate: rate }, 'return=minimal');
        check('listing: Jamie saves the rates', r2.status < 300 && Number((await readRow()).hourly_rate) === rate, r2.status + ' ' + JSON.stringify(r2.data).slice(0, 200));
        await db.update('service_providers', '?id=eq.' + p.id, { hourly_rate: p.hourly_rate });
        const pics = (p.photos || []).concat(['providers/cohost-proof.jpg']);
        const r3 = await rls(jamie, 'PATCH', '/service_providers?id=eq.' + p.id, { photos: pics }, 'return=minimal');
        check('listing: Jamie saves the photos', r3.status < 300 && ((await readRow()).photos || []).length === pics.length, r3.status + ' ' + JSON.stringify(r3.data).slice(0, 200));
        await db.update('service_providers', '?id=eq.' + p.id, { photos: p.photos || [] });
        const areas = await db.select('service_areas', '?provider_id=eq.' + p.id + '&select=*');
        const d = await rls(jamie, 'DELETE', '/service_areas?provider_id=eq.' + p.id);
        const reinsert = (areas || []).map(({ id, created_at, ...rest }) => rest);
        const i = reinsert.length ? await rls(jamie, 'POST', '/service_areas', reinsert) : { status: 201, data: [1] };
        check('listing: Jamie replaces the coverage areas', d.status < 300 && wrote(i), d.status + '/' + i.status + ' ' + JSON.stringify(i.data).slice(0, 200));
        if (!wrote(i) && reinsert.length) await db.insert('service_areas', reinsert);
        const extras = await db.select('service_provider_extras', '?provider_id=eq.' + p.id + '&select=provider_id,extra_key,offered&limit=1');
        if (extras && extras[0]) {
            const u = await rls(jamie, 'POST', '/service_provider_extras?on_conflict=provider_id,extra_key', extras[0], 'resolution=merge-duplicates,return=representation');
            check('listing: Jamie saves an offered service', u.status < 300, u.status + ' ' + JSON.stringify(u.data).slice(0, 200));
        }
        const regs = await db.select('service_provider_registrations', '?provider_id=eq.' + p.id + '&select=scheme,number&limit=1');
        if (regs && regs[0]) {
            const u = await rls(jamie, 'PATCH', '/service_provider_registrations?provider_id=eq.' + p.id + '&scheme=eq.' + regs[0].scheme, { number: regs[0].number });
            check('listing: Jamie saves a registration number', wrote(u), u.status + ' ' + JSON.stringify(u.data).slice(0, 200));
        }
        const rR = await rls(rowan, 'PATCH', '/service_providers?id=eq.' + sauna.id, { description: 'Hijacked' }, 'return=minimal');
        const after = (await db.select('service_providers', '?id=eq.' + sauna.id + '&select=description'))[0];
        check('listing: Rowan (calendar only) cannot edit the business row', after.description !== 'Hijacked', String(rR.status));
        const seeR = await rls(rowan, 'GET', '/provider_access?select=email');
        check('Rowan sees only his own access rows', Array.isArray(seeR.data) && seeR.data.every((x) => x.email === CAL), JSON.stringify(seeR.data));
    }

    console.log('\n5. What stays the owner’s');
    {
        // C1 (AUDIT 2026-10-31): a listing co-host must NOT be able to seize the
        // business by writing owner_id to themselves. Jamie has FULL access
        // (can_listing) on the sauna — the strongest co-host there is — so this
        // is the exact hole the audit found. Two locks are proved: the column
        // grant (the browser PATCH is refused) and the trigger (even the service
        // role cannot move owner_id).
        const ownerOf = async () => (await db.select('service_providers', '?id=eq.' + sauna.id + '&select=owner_id'))[0].owner_id;
        const beforeOwner = await ownerOf();
        const seize = await rls(jamie, 'PATCH', '/service_providers?id=eq.' + sauna.id, { owner_id: jamie.session.user.id }, 'return=minimal');
        check('ownership: a full-access co-host cannot seize the business from the browser — owner_id is not writable [C1]',
            seize.status >= 400 && (await ownerOf()) === beforeOwner, seize.status + ' ' + JSON.stringify(seize.data).slice(0, 160));
        let svcErr = null;
        try { await db.update('service_providers', '?id=eq.' + sauna.id, { owner_id: jamie.session.user.id }); } catch (e) { svcErr = e; }
        check('ownership: the BEFORE UPDATE trigger refuses an owner_id change even via the service role [C1]',
            (await ownerOf()) === beforeOwner, svcErr ? String(svcErr.message || svcErr).slice(0, 160) : 'no error raised and owner_id moved');

        const c = await api(jamie, 'POST', '/api/services/connect', { providerId: chef.id });
        check('payouts: Jamie cannot set up the chef’s Stripe payouts', c.status === 403, String(c.status));
        const s = await api(jamie, 'POST', '/api/services/subscription', { providerId: plumber.id, action: 'cancel' });
        check('billing: Jamie cannot touch the plumber’s subscription', s.status === 403, String(s.status));
        const v = await api(jamie, 'GET', '/api/account/vat?providerId=' + plumber.id);
        check('VAT: Jamie cannot read the plumber’s VAT details', v.status === 403 || v.status === 404 || (v.data && v.data.ok === false), v.status + ' ' + JSON.stringify(v.data));
        const mint = await api(jamie, 'POST', '/api/listing-access', { action: 'invite', kind: 'provider', providerId: chef.id, email: 'someone@gallowaycohost.test', ...ALL });
        check('Jamie (full access) cannot mint another full-access co-host', mint.status === 403, String(mint.status));
        const help = await api(jamie, 'POST', '/api/listing-access', { action: 'invite', kind: 'provider', providerId: chef.id, email: 'helper@gallowaycohost.test', can_calendar: true });
        check('…but can invite a calendar helper, as on a holiday let', help.status === 200, JSON.stringify(help.data));
        await db.remove('provider_access', '?email=eq.helper%40gallowaycohost.test');
        const rowanInv = await api(rowan, 'POST', '/api/listing-access', { action: 'invite', kind: 'provider', providerId: sauna.id, email: 'x@gallowaycohost.test', can_calendar: true });
        check('Rowan (not full access) cannot invite anyone', rowanInv.status === 403, String(rowanInv.status));
    }

    console.log('\n6. Replying to a review (a temporary one on the sauna’s past booking)');
    {
        const past = (await db.select('service_orders', '?provider_id=eq.' + sauna.id + '&status=eq.confirmed&service_date=lt.' + dayOffset(0) + '&select=id,guest_id&limit=1'))[0];
        if (past) {
            const rev = (await db.insert('reviews', [{ review_type: 'guest_to_provider', provider_id: sauna.id, order_id: past.id, reviewer_id: past.guest_id, reviewee_id: sauna.owner_id, rating: 5, comment: 'Co-host reply proof (automated, removed straight after).', is_published: true }]))[0];
            const reply = (who, text) => rls(who, 'PATCH', '/reviews?id=eq.' + rev.id, { host_reply: text, host_reply_at: new Date().toISOString() }, 'return=minimal');
            const readReply = async () => (await db.select('reviews', '?id=eq.' + rev.id + '&select=host_reply'))[0].host_reply;
            await reply(rowan, 'Rowan');
            check('reviews: Rowan (no messages) cannot reply', (await readReply()) == null);
            await reply(jamie, 'Thanks from the co-host');
            check('reviews: Jamie (messages) replies', (await readReply()) === 'Thanks from the co-host');
            await db.remove('reviews', '?id=eq.' + rev.id);
        }
    }

    console.log('\n  ' + passed + ' passed, ' + failed.length + ' failed');
    if (failed.length) { failed.forEach((f) => console.log('    - ' + f)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
