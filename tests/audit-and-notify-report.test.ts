// Two silences, both on paths where nothing visible breaks.
//
// lib/adminAudit writes the trail that says who took a listing down and why.
// It caught its own failures into console.error — and worse, it used a bare
// `await insert(...)`, and supabase-js does not throw on a failed write, it
// hands the error back. So the ordinary failure never reached the catch at
// all: the row simply did not appear, and nothing anywhere said so. An audit
// row that silently does not exist is worse than one that loudly fails,
// because the point of a trail is that somebody can look back at it and
// believe what they see.
//
// /api/notify is the route every notification on the site funnels through. It
// answered 200 with { ok: false } whatever happened and wrote one console
// line. Two layers of quiet: nothing thrown, nothing reported, and a status
// code saying it went fine. A guest never told their card failed, a host never
// told they have been paid, a booking confirmation that never arrives — all of
// them look like this from here.
//
// Neither change makes the caller fail. The booking or the moderation has
// already happened by the time these run, and that is deliberate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const code = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

/* ------------------------------------------------------------- adminAudit */

test('a failed audit write is reported', () => {
    const body = code('lib/adminAudit.ts');
    assert.match(body, /logError/);
    assert.match(body, /was NOT recorded in the trail/);
});

test('the audit insert checks the error rather than only catching a throw', () => {
    // The bug underneath the silence: supabase-js hands the error back, so a
    // bare `await insert(...)` inside a try/catch catches nothing.
    const body = code('lib/adminAudit.ts');
    const fn = body.slice(body.indexOf('export async function recordAdminAction'));
    assert.match(fn, /const \{ error \} = await admin\s*\.?\s*\n?\s*\.from\('admin_actions'\)/,
        'the insert must destructure its error');
    assert.match(fn, /if \(error\) throw error;/,
        'and hand it to the catch, or the catch only ever sees exceptions');
});

test('the report carries enough to write the row by hand', () => {
    // The alternative is knowing a moderation decision happened and not what
    // it was.
    const body = code('lib/adminAudit.ts');
    for (const field of ['action', 'admin_id', 'listing_id', 'host_id', 'reason']) {
        assert.match(body, new RegExp(field + ':'), 'the report drops ' + field);
    }
});

test('recording still returns nothing anyone can branch on', () => {
    // The action has already happened. If this starts reporting failure
    // upwards, a moderation decision could be undone by a logging problem.
    const body = code('lib/adminAudit.ts');
    assert.match(body, /export async function recordAdminAction\([\s\S]*?\): Promise<void>/);
});

/* ----------------------------------------------------------------- notify */

test('a failed notification is reported', () => {
    const body = code('app/api/notify/route.ts');
    assert.match(body, /logError/);
    assert.match(body, /a notification was not sent/);
});

test('the report says WHICH notification', () => {
    // "A notification was not sent" without the type or the booking is barely
    // better than silence — you cannot chase it.
    const body = code('app/api/notify/route.ts');
    assert.match(body, /notificationType/);
    assert.match(body, /notificationBookingId/);
    assert.ok(
        body.indexOf('let notificationType') < body.indexOf('try {'),
        'they have to be declared outside the try, or the catch cannot see them'
    );
});

test('notify still answers the browser 200', () => {
    // The booking or message itself already succeeded. Telling a guest their
    // booking failed because an email did not send would be a lie about the
    // money.
    const body = code('app/api/notify/route.ts');
    const tail = body.slice(body.lastIndexOf('} catch'));
    assert.match(tail, /status:\s*200/);
    assert.ok(!/status:\s*500/.test(tail));
});
