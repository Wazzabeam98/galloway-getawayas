// Web push (lib/push, lib/pushMessages) and where it may be sent from.
//
// What matters: a push can never break the email or the booking it rides with
// (pushToUser never throws and gives up on a dead device quietly), it only ever
// talks to real browser push services, it never sends anyone off-site, and no
// payment, payout or settlement code sends one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { cleanSubscription, isPushEndpoint, pushPayload, pushToUser } = require('../lib/push');
const { hostNewBookingPush, guestConfirmedPush, newMessagePush } = require('../lib/pushMessages');

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

test('only real browser push services are accepted', () => {
    assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
    assert.ok(isPushEndpoint('https://web.push.apple.com/QGx'));
    assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
    assert.ok(!isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), 'https only');
    assert.ok(!isPushEndpoint('https://evil.example/fcm.googleapis.com'), 'host, not path');
    assert.ok(!isPushEndpoint('https://fcm.googleapis.com.evil.example/x'), 'suffix match on the real host');
    assert.ok(!isPushEndpoint('https://169.254.169.254/latest'), 'never an internal address');
    assert.ok(!isPushEndpoint(42));
});

test('a subscription needs an endpoint and both keys', () => {
    assert.deepEqual(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: KEYS }),
        { endpoint: 'https://fcm.googleapis.com/x', p256dh: KEYS.p256dh, auth: KEYS.auth });
    assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: KEYS.p256dh } }), null);
    assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...KEYS, auth: '<script>' } }), null);
    assert.equal(cleanSubscription(null), null);
});

test('a tap only ever opens a page on this site', () => {
    assert.equal(JSON.parse(pushPayload({ title: 't', body: 'b', url: '/trips' })).url, '/trips');
    assert.equal(JSON.parse(pushPayload({ title: 't', body: 'b', url: 'https://evil.example' })).url, '/');
    assert.equal(JSON.parse(pushPayload({ title: 't', body: 'b', url: '//evil.example' })).url, '/');
    const long = JSON.parse(pushPayload({ title: 't', body: 'x'.repeat(500), url: '/' })).body;
    assert.ok(long.length <= 160, 'body is clipped for a lock screen');
});

test('the words: who, where, when — dates DD/MM/YYYY, no prices', () => {
    const host = hostNewBookingPush({ bookingId: 'b1', guestFirst: 'Alex', listingTitle: 'Millburn Cottage', checkIn: '2026-11-26', checkOut: '2026-11-29', instant: true });
    assert.equal(host.title, 'New booking');
    assert.equal(host.body, 'Alex booked Millburn Cottage, 26/11/2026 – 29/11/2026');
    assert.equal(host.url, '/dashboard/bookings/b1');
    const req = hostNewBookingPush({ bookingId: 'b1', guestFirst: 'Alex', listingTitle: 'Millburn Cottage', checkIn: '2026-11-26', checkOut: '2026-11-29', instant: false });
    assert.equal(req.title, 'New booking request');
    const guest = guestConfirmedPush({ bookingId: 'b1', listingTitle: 'Millburn Cottage', checkIn: '2026-11-26', checkOut: '2026-11-29' });
    assert.match(guest.body, /Millburn Cottage is confirmed, 26\/11\/2026/);
    assert.equal(guest.url, '/trips');
    const msg = newMessagePush({ bookingId: 'b1', senderFirst: 'Sam', preview: 'See you Friday' });
    assert.deepEqual([msg.title, msg.body, msg.url], ['Sam', 'See you Friday', '/messages/b1']);
    for (const m of [host, req, guest]) assert.doesNotMatch(m.body, /£|&pound;/);
});

function fakeAdmin(subs: any[]) {
    const deleted: string[] = [];
    const admin = {
        from: (_t: string) => ({
            select: () => ({ eq: async () => ({ data: subs, error: null }) }),
            delete: () => ({ eq: async (_c: string, v: string) => { deleted.push(v); return { error: null }; } }),
            insert: async () => ({ error: null }),
        }),
    };
    return { admin, deleted };
}

test('a gone device is forgotten; a live one is counted', async () => {
    const { admin, deleted } = fakeAdmin([
        { endpoint: 'https://fcm.googleapis.com/live', p256dh: 'a', auth: 'b' },
        { endpoint: 'https://fcm.googleapis.com/gone', p256dh: 'a', auth: 'b' },
    ]);
    const n = await pushToUser(admin, 'u1', { title: 't', body: 'b', url: '/' }, async (sub: any) => {
        if (sub.endpoint.endsWith('gone')) { const e: any = new Error('Gone'); e.statusCode = 410; throw e; }
    });
    assert.equal(n, 1);
    assert.deepEqual(deleted, ['https://fcm.googleapis.com/gone']);
});

test('pushToUser never throws — not on a failing service, not on a broken database', async () => {
    const { admin } = fakeAdmin([{ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'a', auth: 'b' }]);
    const n = await pushToUser(admin, 'u1', { title: 't', body: 'b', url: '/' }, async () => { throw new Error('boom'); });
    assert.equal(n, 0);
    const broken = { from: () => { throw new Error('db down'); } };
    assert.equal(await pushToUser(broken, 'u1', { title: 't', body: 'b', url: '/' }, async () => {}), 0);
    assert.equal(await pushToUser(broken, null, { title: 't', body: 'b', url: '/' }), 0);
});

test('with no VAPID keys, pushing is simply off', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    let touched = false;
    const admin = { from: () => { touched = true; throw new Error('should not be read'); } };
    assert.equal(await pushToUser(admin, 'u1', { title: 't', body: 'b', url: '/' }), 0);
    assert.equal(touched, false);
});

test('no payment, payout or settlement code sends a push', () => {
    // The WATCHED money-path list is the definition of that code.
    const src = fs.readFileSync(path.join(ROOT, 'scripts/scenario-report.cjs'), 'utf8');
    const block = src.slice(src.indexOf('const WATCHED = ['), src.indexOf('];', src.indexOf('const WATCHED = [')));
    const files = Array.from(block.matchAll(/'([^']+\.ts)'/g), (m: any) => m[1]);
    assert.ok(files.length > 10, 'read the WATCHED list');
    for (const f of files) {
        const full = path.join(ROOT, f);
        if (!fs.existsSync(full)) continue;
        const body = fs.readFileSync(full, 'utf8');
        assert.doesNotMatch(body, /lib\/push(Messages)?['"]|pushToUser/, f + ' must not send a push');
    }
});

test('the notification route pushes only after the email it goes with', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/notify/route.ts'), 'utf8');
    const confirmed = src.slice(src.indexOf('const mail = guestBookedEmail('));
    assert.ok(confirmed.indexOf('sendEmail(') < confirmed.indexOf('pushToUser('), 'confirmation: email first');
    const message = src.slice(src.indexOf("type === 'new_message'"));
    assert.ok(message.indexOf("sendEmail(to, 'New message from") < message.lastIndexOf('await pushIt()'), 'message: email first');
});

/* ------------------------------------------------ admin test notifications */

test('the three test pushes use the real wording, say TEST, and open the admin page', () => {
    const { testPush, TEST_PUSH_KINDS } = require('../lib/pushTest');
    assert.deepEqual([...TEST_PUSH_KINDS], ['new_booking', 'new_message', 'booking_confirmed']);
    const booking = testPush('new_booking');
    assert.equal(booking.title, 'TEST New booking');
    assert.match(booking.body, /^Morag booked Rowan Cottage \(test\), 11\/12\/2026 – 14\/12\/2026$/);
    assert.equal(testPush('new_message').title, 'TEST Callum');
    assert.equal(testPush('booking_confirmed').title, 'TEST You’re booked');
    for (const k of TEST_PUSH_KINDS) {
        const m = testPush(k);
        assert.equal(m.url, '/admin/notifications');
        assert.equal(m.tag, 'test-' + k, 'separate tags, so the three stack rather than replace each other');
    }
});

test('the report says what each device did', async () => {
    const { pushToUserReport } = require('../lib/push');
    const { admin, deleted } = fakeAdmin([
        { endpoint: 'https://web.push.apple.com/ok', p256dh: 'a', auth: 'b' },
        { endpoint: 'https://web.push.apple.com/gone', p256dh: 'a', auth: 'b' },
        { endpoint: 'https://web.push.apple.com/bad', p256dh: 'a', auth: 'b' },
    ]);
    const r = await pushToUserReport(admin, 'u1', { title: 't', body: 'b', url: '/' }, async (sub: any) => {
        if (sub.endpoint.endsWith('gone')) { const e: any = new Error('Gone'); e.statusCode = 410; throw e; }
        if (sub.endpoint.endsWith('bad')) { const e: any = new Error('x'); e.statusCode = 403; e.body = 'BadJwtToken'; throw e; }
    });
    assert.deepEqual([r.devices, r.accepted, r.gone, r.failed], [3, 1, 1, 1]);
    assert.match(r.errors[0], /403 BadJwtToken/);
    assert.deepEqual(deleted, ['https://web.push.apple.com/gone']);
});

test('the test route is admins only, pushes only to the caller, and touches no booking, message or payment data', () => {
    const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const route = strip(fs.readFileSync(path.join(ROOT, 'app/api/admin/push-test/route.ts'), 'utf8'));
    assert.match(route, /getUser\(\)/);
    assert.match(route, /isAdmin\(user\.id\)/);
    assert.match(route, /pushToUserReport\(adminClient\(\), user\.id,/, 'the recipient is the verified caller');
    assert.doesNotMatch(route, /body\.(userId|user_id)/, 'never a recipient from the request');
    const page = strip(fs.readFileSync(path.join(ROOT, 'app/admin/notifications/page.tsx'), 'utf8'));
    assert.match(page, /requireAdmin\(\)/);
    for (const f of ['app/api/admin/push-test/route.ts', 'lib/pushTest.ts', 'app/admin/notifications/PushTestButton.tsx']) {
        const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        assert.doesNotMatch(src, /from\(\s*'(bookings|messages|payments|payouts|service_orders)'/, f);
    }
});
