// Push notifications for every event: the rules that turn an email into a
// push, the outbox, the job that sends each one exactly once, the switches,
// and the lines nothing may cross (no codes, wifi, addresses, cards or message
// text on a lock screen; no push sent from payment code; a failed push never
// blocks anything).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { RULES, pushForEmail, scrubPushText, emailLink, cleanSubject, categoryForPath } = require('../lib/pushRules');
const { CATALOGUE, cataloguePush } = require('../lib/pushCatalogue');
const { pushAllowed, PUSH_CATEGORY_INFO } = require('../lib/pushCategories');
const { outboxRow, recordEmailPush, queuePush } = require('../lib/pushOutbox');
const { recipientsFor, deliverRow, drainOutbox, adminAlertAddresses } = require('../lib/pushDispatch');
const { messagePush } = require('../lib/pushMessages');
const { destinationFingerprint, payoutCheck } = require('../lib/pushPayoutCheck');

/* ------------------------------------------------------------ a tiny database */

function fakeDb(tables: Record<string, any[]>) {
    const log: string[] = [];
    function from(table: string) {
        const rows = (tables[table] = tables[table] || []);
        const filters: ((r: any) => boolean)[] = [];
        let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
        let patch: any = null;
        let limit = Infinity;
        let single = false;
        let upsertOpts: any = {};
        const b: any = {
            select() { return b; },
            eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
            ilike(c: string, v: string) { const want = String(v).replace(/\\([\\%_])/g, '$1').toLowerCase(); filters.push((r) => String(r[c] || '').toLowerCase() === want); return b; },
            in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
            lt(c: string, v: any) { filters.push((r) => r[c] < v); return b; },
            gt(c: string, v: any) { filters.push((r) => r[c] > v); return b; },
            is(c: string, v: any) { filters.push((r) => (r[c] ?? null) === v); return b; },
            order() { return b; },
            limit(n: number) { limit = n; return b; },
            maybeSingle() { single = true; return b; },
            update(p: any) { op = 'update'; patch = p; return b; },
            delete() { op = 'delete'; return b; },
            upsert(p: any, o: any) { op = 'upsert'; patch = p; upsertOpts = o || {}; return b; },
            insert(p: any) { op = 'upsert'; patch = p; return b; },
            then(resolve: any, reject: any) {
                try {
                    log.push(table + ':' + op);
                    if (op === 'upsert') {
                        const key = upsertOpts.onConflict;
                        const existing = key ? rows.find((r) => r[key] === patch[key]) : null;
                        if (existing && upsertOpts.ignoreDuplicates) return resolve({ data: null, error: null });
                        if (existing) Object.assign(existing, patch);
                        else rows.push({ id: 'id' + (rows.length + 1), status: 'pending', created_at: new Date().toISOString(), ...patch });
                        return resolve({ data: null, error: null });
                    }
                    const hit = rows.filter((r) => filters.every((f) => f(r)));
                    if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: hit.map((r) => ({ ...r })), error: null }); }
                    if (op === 'delete') { hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return resolve({ data: null, error: null }); }
                    const out = hit.slice(0, limit).map((r) => ({ ...r }));
                    return resolve({ data: single ? (out[0] || null) : out, error: null });
                } catch (e) { return reject(e); }
            },
        };
        return b;
    }
    return { from, tables, log };
}

/* ------------------------------------------------------------ rules */

test('every rule has a real sample in the catalogue, and every email sample finds a rule', () => {
    const emails = CATALOGUE.filter((e: any) => e.subject);
    const usedKinds = new Set(emails.map((e: any) => pushForEmail(e.subject, '').kind));
    for (const e of emails) {
        const p = pushForEmail(e.subject, '');
        assert.notEqual(p.kind, 'email.other', 'no rule for: ' + e.subject);
    }
    for (const r of RULES) {
        assert.ok(usedKinds.has(r.kind), 'rule ' + r.kind + ' (' + r.match + ') has no sample in lib/pushCatalogue');
    }
});

test('the words are short, and every catalogue push opens a page on this site', () => {
    for (const e of CATALOGUE) {
        const p = cataloguePush(e);
        assert.ok(p, e.event);
        assert.ok(p.title.length > 0 && p.title.length <= 60, 'title too long: ' + p.title);
        assert.ok(p.body.length > 0 && p.body.length <= 140, 'body too long: ' + p.body);
        assert.ok(p.url.startsWith('/') && !p.url.startsWith('//'), p.url);
        assert.ok(!/Galloway Getaways$/.test(p.title), 'site name trimmed: ' + p.title);
    }
});

test('a few real subjects become the pushes you would expect', () => {
    const host = pushForEmail('New booking request — Rowan Cottage', '<a href="https://gallowaygetaways.co.uk/dashboard/bookings/b1">x</a>');
    assert.deepEqual([host.title, host.body, host.url, host.category, host.cohost],
        ['New booking request', 'Rowan Cottage. Accept or decline it soon.', '/dashboard/bookings/b1', 'reservations', 'can_bookings']);
    const paid = pushForEmail('You’ve been paid £420.00', '');
    assert.equal(paid.title, 'You’ve been paid £420.00');
    assert.equal(paid.category, 'payments');
    const ent = pushForEmail('Solway &amp; Sons proposed a new date for your booking', '');
    assert.equal(ent.body, 'Solway & Sons suggested a new date. Accept or decline.', 'entities decoded');
});

test('a brand-new email with no rule still pushes: its subject, a plain body, the page its button opens', () => {
    const p = pushForEmail('Your welcome pack is ready — Galloway Getaways', '<a href="https://gallowaygetaways.co.uk/unsubscribe?x=1">u</a><a href="https://gallowaygetaways.co.uk/trips">Open</a>');
    assert.deepEqual([p.kind, p.title, p.body, p.url], ['email.other', 'Your welcome pack is ready', 'Tap to see the details.', '/trips']);
    assert.equal(categoryForPath('/messages/x'), 'messages');
    assert.equal(categoryForPath('/dashboard/earnings'), 'payments');
    assert.equal(categoryForPath('/admin/errors'), 'admin');
    assert.equal(emailLink('<a href="https://evil.example/x">x</a>'), '/');
    assert.equal(cleanSubject('Hello — Galloway Getaways'), 'Hello');
});

/* ------------------------------------------------------------ what never goes on a lock screen */

test('door codes, wifi, postcodes and card numbers are scrubbed', () => {
    const cases = [
        'Door code 4821 for Rowan Cottage',
        'The lockbox: 0042',
        'Key safe code is 7731',
        'Wifi password Galloway2026x',
        'Arrive at DG7 1AB',
        'Card 4242 4242 4242 4242',
    ];
    for (const c of cases) {
        const out = scrubPushText(c, 160);
        assert.doesNotMatch(out, /4821|0042|7731|Galloway2026x|DG7 1AB|4242 4242/, c + ' → ' + out);
    }
    assert.equal(scrubPushText('Rowan Cottage, 11/12/2026', 160), 'Rowan Cottage, 11/12/2026', 'ordinary words and dates survive');
});

test('a message push never carries the message', () => {
    const m = messagePush({ bookingId: 'b1', recipientId: 'u2', senderFirst: 'Callum', senderRole: 'host' });
    assert.deepEqual([m.title, m.body, m.url, m.category], ['Callum', 'New message from your host', '/messages/b1', 'messages']);
    for (const e of CATALOGUE.filter((x: any) => x.event.toLowerCase().includes('message'))) {
        const p = cataloguePush(e);
        assert.match(p.body, /^(New message from your|About |Tap to |Reply soon)/, e.event + ': ' + p.body);
    }
});

test('message emails never push themselves: the messages table records one push per message', () => {
    assert.equal(pushForEmail('New message from Sam \u2014 Galloway Getaways', ''), null);
    assert.equal(pushForEmail('New message about your booking', ''), null);
    assert.equal(pushForEmail('New message about GG-1234', ''), null);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261019172656_message_push_trigger.sql'), 'utf8');
    assert.match(sql, /'message:' \|\| new\.id/, 'one push per message, by its id');
    assert.match(sql, /'New message from your ' \|\| sender_role/, 'the role, never the body');
    assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /new\.body/, 'the text of a message is never read');
    assert.match(sql, /exception when others then[\s\S]{0,90}?null;/);
});

test('the outbox row is cleaned on the way in', () => {
    const row = outboxRow({ dedupeKey: 'k', kind: 'x', category: 'messages', title: 'Code 1234', body: 'b', url: '//evil.example' });
    assert.equal(row.url, '/');
    assert.doesNotMatch(row.title, /1234/);
    assert.equal(outboxRow({ dedupeKey: 'k', kind: 'x', category: 'nonsense', title: 't', body: 'b', url: '/' }).category, 'reservations');
});

/* ------------------------------------------------------------ recording */

test('every email records one push; the same email twice records it once', async () => {
    const db = fakeDb({ push_outbox: [] });
    const html = '<a href="https://gallowaygetaways.co.uk/trips">Open</a>';
    await recordEmailPush('guest@example.com', 'You’re booked — Galloway Getaways', html, undefined, db);
    await recordEmailPush('guest@example.com', 'You’re booked — Galloway Getaways', html, undefined, db);
    assert.equal(db.tables.push_outbox.length, 1);
    const row = db.tables.push_outbox[0];
    assert.equal(row.to_email, 'guest@example.com');
    assert.equal(row.title, 'You’re booked!');
    assert.equal(row.status, 'pending');
    assert.equal(await recordEmailPush('x@example.com', 'Hi', html, false, db), null, 'false means the caller recorded its own');
    assert.equal(await recordEmailPush('seed@gallowayseed.test', 'Hi', html, undefined, db), null, 'reserved test addresses never push');
});

test('recording never throws, even with the database gone', async () => {
    const broken = { from: () => { throw new Error('down'); } };
    assert.equal(await recordEmailPush('a@example.com', 'Hello', '', undefined, broken), null);
    assert.equal(await queuePush({ dedupeKey: 'k', kind: 'k', category: 'messages', title: 't', body: 'b', url: '/' }, broken), null);
});

/* ------------------------------------------------------------ who gets it */

const ENV = { DISPUTES_ALERT_EMAIL: 'alerts@example.com, other@example.com', SERVICES_ALERT_EMAIL: 'svc@example.com' };

function world() {
    return fakeDb({
        profiles: [
            { id: 'host', email: 'host@example.com' },
            { id: 'guest', email: 'guest@example.com' },
            { id: 'a1', email: 'liam@example.com', is_admin: true },
            { id: 'a2', email: 'jamie@example.com', is_admin: true },
            { id: 'co1', email: 'co1@example.com' },
            { id: 'co2', email: 'co2@example.com' },
            { id: 'prov', email: 'owner@example.com' },
        ],
        service_providers: [{ id: 'sp1', owner_id: 'prov', contact_email: 'shop@example.com' }],
        bookings: [{ id: '11111111-1111-4111-8111-111111111111', listing_id: 'l1', host_id: 'host' }],
        listings: [{ id: 'l1', host_id: 'host' }],
        listing_access: [
            { listing_id: 'l1', user_id: 'co1', status: 'active', can_bookings: true, can_messages: false, can_earnings: false },
            { listing_id: 'l1', user_id: 'co2', status: 'active', can_bookings: false, can_messages: true, can_earnings: false },
            { listing_id: 'l1', user_id: 'gone', status: 'revoked', can_bookings: true },
        ],
        notification_preferences: [],
        push_subscriptions: [],
        push_outbox: [],
    });
}

const ids = (rs: any[]) => rs.map((r) => r.userId).sort();

test('an email resolves to its account; a provider contact address to the provider’s owner', async () => {
    const db = world();
    assert.deepEqual(ids(await recipientsFor(db, { to_email: 'GUEST@example.com', category: 'reservations', context: {} }, ENV)), ['guest']);
    assert.deepEqual(ids(await recipientsFor(db, { to_email: 'shop@example.com', category: 'reservations', context: {} }, ENV)), ['prov']);
    assert.deepEqual(ids(await recipientsFor(db, { to_email: 'stranger@example.com', category: 'reservations', context: {} }, ENV)), []);
});

test('an owner alert address goes to every admin, filed under owner alerts', async () => {
    const db = world();
    assert.deepEqual([...adminAlertAddresses(ENV)].sort(), ['alerts@example.com', 'other@example.com', 'svc@example.com']);
    const r = await recipientsFor(db, { to_email: 'svc@example.com', category: 'reservations', context: {} }, ENV);
    assert.deepEqual(ids(r), ['a1', 'a2']);
    assert.ok(r.every((x: any) => x.category === 'admin'));
    assert.deepEqual(ids(await recipientsFor(db, { context: { admins: true }, category: 'admin' }, ENV)), ['a1', 'a2']);
});

test('co-hosts get only what their permissions cover, and only on pushes to the listing’s owner', async () => {
    const db = world();
    const B = '/dashboard/bookings/11111111-1111-4111-8111-111111111111';
    const booking = await recipientsFor(db, { user_id: 'host', url: B, category: 'reservations', context: { cohost: 'can_bookings' } }, ENV);
    assert.deepEqual(ids(booking), ['co1', 'host'], 'bookings permission: co1, not co2, not the revoked one');
    const msg = await recipientsFor(db, { user_id: 'host', url: B, category: 'messages', context: { cohost: 'can_messages' } }, ENV);
    assert.deepEqual(ids(msg), ['co2', 'host']);
    const money = await recipientsFor(db, { user_id: 'host', url: B, category: 'payments', context: { cohost: 'can_earnings' } }, ENV);
    assert.deepEqual(ids(money), ['host'], 'nobody holds earnings');
    const none = await recipientsFor(db, { user_id: 'host', url: B, category: 'listings', context: {} }, ENV);
    assert.deepEqual(ids(none), ['host'], 'no permission named (payout set-up, security): owner only');
    const guest = await recipientsFor(db, { user_id: 'guest', url: B, category: 'reservations', context: { cohost: 'can_bookings' } }, ENV);
    assert.deepEqual(ids(guest), ['guest'], 'a push to the guest never fans out to co-hosts');
});

/* ------------------------------------------------------------ switches */

test('everything is on by default except tips and offers; security can’t be switched off', () => {
    for (const c of Object.keys(PUSH_CATEGORY_INFO)) {
        assert.equal(pushAllowed(null, c), c !== 'marketing', c);
    }
    assert.equal(pushAllowed({ messages: false }, 'messages'), false);
    assert.equal(pushAllowed({ marketing: true }, 'marketing'), true);
    assert.equal(pushAllowed({ account: false }, 'account'), true, 'security alerts always send');
});

test('a switched-off category is skipped; security still goes', async () => {
    const db = world();
    db.tables.notification_preferences.push({ user_id: 'guest', push: { reservations: false, account: false } });
    db.tables.push_subscriptions.push({ user_id: 'guest', endpoint: 'https://web.push.apple.com/x', p256dh: 'a', auth: 'b' });
    const sent: string[] = [];
    const send = async (_s: any, payload: string) => { sent.push(JSON.parse(payload).title); };
    const off = await deliverRow(db, { id: 'r1', user_id: 'guest', category: 'reservations', title: 'Booking', body: 'b', url: '/trips', kind: 'k', context: {} }, send, ENV);
    assert.equal(off.status, 'skipped');
    const sec = await deliverRow(db, { id: 'r2', user_id: 'guest', category: 'account', title: 'New sign-in', body: 'b', url: '/account', kind: 'k', context: {} }, send, ENV);
    assert.equal(sec.status, 'sent');
    assert.deepEqual(sent, ['New sign-in']);
});

/* ------------------------------------------------------------ exactly once */

test('the job sends each row once, however many times it runs', async () => {
    const db = world();
    db.tables.push_subscriptions.push({ user_id: 'guest', endpoint: 'https://web.push.apple.com/x', p256dh: 'a', auth: 'b' });
    await queuePush({ dedupeKey: 'e1', kind: 'k', category: 'reservations', title: 'One', body: 'b', url: '/', userId: 'guest' }, db);
    await queuePush({ dedupeKey: 'e1', kind: 'k', category: 'reservations', title: 'One', body: 'b', url: '/', userId: 'guest' }, db);
    let n = 0;
    const send = async () => { n++; };
    await Promise.all([drainOutbox(db, { send }), drainOutbox(db, { send })]);
    await drainOutbox(db, { send });
    assert.equal(n, 1);
    assert.equal(db.tables.push_outbox[0].status, 'sent');
});

test('a failing push service marks the row failed and throws nothing', async () => {
    const db = world();
    db.tables.push_subscriptions.push({ user_id: 'guest', endpoint: 'https://web.push.apple.com/x', p256dh: 'a', auth: 'b' });
    await queuePush({ dedupeKey: 'e2', kind: 'k', category: 'reservations', title: 'Two', body: 'b', url: '/', userId: 'guest' }, db);
    const t = await drainOutbox(db, { send: async () => { const e: any = new Error('x'); e.statusCode = 500; throw e; } });
    assert.equal(t.failed, 1);
    const broken = { from: () => { throw new Error('down'); } };
    assert.deepEqual(await drainOutbox(broken, {}), { claimed: 0, sent: 0, skipped: 0, failed: 0 });
});

/* ------------------------------------------------------------ payout details */

test('payout details: first sighting is the baseline, a change pushes, the same does not', async () => {
    assert.equal(destinationFingerprint({ external_accounts: { data: [{ object: 'bank_account', fingerprint: 'F1', last4: '1234', default_for_currency: true }] } }), 'bank_account:F1:1234:');
    const db = world();
    db.tables.payout_destinations_seen = [];
    db.tables.push_subscriptions.push({ user_id: 'host', endpoint: 'https://web.push.apple.com/x', p256dh: 'a', auth: 'b' });
    const row = { id: 'r', kind: 'security.payout_check', user_id: 'host', category: 'account', context: { stripe_account_id: 'acct_1' }, url: '/' };
    const acct = (fp: string) => async () => ({ external_accounts: { data: [{ object: 'bank_account', fingerprint: fp, last4: '1234' }] } });
    assert.equal((await payoutCheck(db, row, acct('F1'))).result.reason, 'baseline recorded');
    assert.equal((await payoutCheck(db, row, acct('F1'))).result.reason, 'unchanged');
    assert.equal((await payoutCheck(db, row, acct('F2'), async () => {})).status, 'sent');
    assert.equal(await payoutCheck(db, { ...row, kind: 'other' }, acct('F3')), null, 'other rows are left to the normal path');
});

/* ------------------------------------------------------------ the lines nothing crosses */

test('no payment, payout or settlement file records or sends a push itself', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/scenario-report.cjs'), 'utf8');
    const block = src.slice(src.indexOf('const WATCHED = ['), src.indexOf('];', src.indexOf('const WATCHED = [')));
    const files = Array.from(block.matchAll(/'([^']+\.ts)'/g), (m: any) => m[1]);
    for (const f of files) {
        const full = path.join(ROOT, f);
        if (!fs.existsSync(full)) continue;
        assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /pushOutbox|pushDispatch|pushToUser|queuePush|drainOutbox/, f);
    }
});

test('the email layer sends first, records second, and only records', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/email.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function sendEmail('), src.indexOf('async function sendEmailOnly('));
    assert.ok(fn.indexOf('sendEmailOnly(') < fn.indexOf('recordEmailPush('), 'email first');
    assert.doesNotMatch(fn, /pushToUser|drainOutbox/, 'never sends a push from here');
});

test('every database trigger that records a push swallows its own errors', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261019170805_push_outbox_and_push_preferences.sql'), 'utf8');
    const fns = sql.split('create or replace function').slice(1);
    assert.ok(fns.length >= 6, "found " + fns.length);
    for (const f of fns) {
        assert.match(f, /exception when others then[\s\S]{0,90}?null;/, 'a trigger must never stop a sign-in or a save: ' + f.slice(0, 60));
        assert.match(f, /security definer/);
    }
    assert.match(sql, /new\.email like 'deleted\+%@invalid\.example'/, 'an erased account queues nothing');
});
