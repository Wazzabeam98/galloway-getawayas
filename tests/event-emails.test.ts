// The four events that used to tell nobody: a chargeback against a host's
// booking, a guest declining a money request, an experience request or date
// change lapsing, and an account deactivated or suspended. Each is recorded by
// a trigger, emailed by the push job (lib/eventEmails), and the email carries
// its push through the shared layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, clearModule } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const sent: { to: string; subject: string; html: string }[] = [];
const realEmail = require('../lib/email');
stubModule('@/lib/email', { ...realEmail, sendEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return true; } });
clearModule('@/lib/eventEmails');
const ev = require('../lib/eventEmails');
const { pushForEmail } = require('../lib/pushRules');

function db(tables: Record<string, any[]>, emails: Record<string, string>) {
    const from = (t: string) => {
        const f: ((r: any) => boolean)[] = [];
        const b: any = {
            select: () => b,
            eq: (c: string, v: any) => { f.push((r) => r[c] === v); return b; },
            maybeSingle: () => b,
            then: (res: any) => res({ data: (tables[t] || []).find((r) => f.every((x) => x(r))) || null, error: null }),
        };
        return b;
    };
    return { from, auth: { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null } }) } } };
}

const BOOKING = '11111111-1111-4111-8111-111111111111';
const world = () => db({
    disputes: [{ id: 'd1', booking_id: BOOKING, amount: 240, status: 'needs_response' }, { id: 'd2', booking_id: BOOKING, amount: 240, status: 'lost' }, { id: 'd3', booking_id: null, amount: 1 }],
    bookings: [{ id: BOOKING, host_id: 'host', listing_id: 'l1' }],
    listings: [{ id: 'l1', title: 'Rowan Cottage' }],
    booking_resolutions: [{ id: 'r1', booking_id: BOOKING, host_id: 'host', amount: 45 }],
    service_orders: [{ id: 'o1', guest_id: 'guest', guest_email: 'guest@example.com', provider_id: 'p1', item_name: 'Sea kayaking', service_date: '2026-12-11' }],
    service_providers: [{ id: 'p1', business_name: 'Solway Kayaks', contact_email: 'shop@example.com' }],
    profiles: [{ id: 'guest', first_name: 'Morag' }],
}, { host: 'host@example.com', guest: 'guest@example.com', gone: 'deleted+x@invalid.example' });

const run = async (kind: string, context: any) => { sent.length = 0; return ev.eventMail(world(), { kind, context }); };

test('a chargeback is emailed to the host, with the booking link that lets co-hosts with earnings see it', async () => {
    const out = await run('notify.chargeback', { dispute_id: 'd1', stage: 'opened' });
    assert.equal(out.status, 'sent');
    assert.equal(sent[0].to, 'host@example.com');
    assert.match(sent[0].subject, /disputed a payment — Rowan Cottage$/);
    assert.match(sent[0].html, new RegExp('/dashboard/bookings/' + BOOKING));
    const p = pushForEmail(sent[0].subject, sent[0].html);
    assert.deepEqual([p.title, p.category, p.cohost, p.url], ['Payment disputed', 'payments', 'can_earnings', '/dashboard/bookings/' + BOOKING]);
    await run('notify.chargeback', { dispute_id: 'd2', stage: 'closed' });
    assert.match(sent[0].subject, /went the guest’s way/);
    assert.equal(pushForEmail(sent[0].subject, sent[0].html).cohost, 'can_earnings');
    assert.equal((await run('notify.chargeback', { dispute_id: 'd3', stage: 'opened' })).status, 'skipped', 'no booking, nobody to tell');
});

test('a guest declining a money request is emailed to the host (and pushed to co-hosts with earnings)', async () => {
    await run('notify.money_declined', { resolution_id: 'r1' });
    assert.equal(sent[0].to, 'host@example.com');
    assert.equal(sent[0].subject, 'Your guest declined your request for £45.00');
    const p = pushForEmail(sent[0].subject, sent[0].html);
    assert.deepEqual([p.title, p.cohost], ['Your guest declined £45.00', 'can_earnings']);
});

test('a lapsed experience request tells the guest and the provider', async () => {
    await run('notify.order_lapsed', { order_id: 'o1' });
    assert.deepEqual(sent.map((m) => m.to), ['guest@example.com', 'shop@example.com']);
    assert.match(sent[0].html, /haven’t been charged/);
    assert.match(sent[1].html, /Morag’s request for Sea kayaking on 11\/12\/2026/);
    for (const m of sent) assert.notEqual(pushForEmail(m.subject, m.html).kind, 'email.other', m.subject);
});

test('a lapsed date change tells both, in the words for whoever asked', async () => {
    await run('notify.date_change_lapsed', { order_id: 'o1', asked_by: 'guest', asked_date: '2026-12-12' });
    assert.deepEqual(sent.map((m) => m.subject), ['Your date change request expired', 'A guest’s date change request expired']);
    assert.match(sent[0].html, /stays on 11\/12\/2026/);
    await run('notify.date_change_lapsed', { order_id: 'o1', asked_by: 'provider', asked_date: '2026-12-12' });
    assert.deepEqual(sent.map((m) => m.subject), ['The new date Solway Kayaks suggested has expired', 'Your suggested date expired']);
    for (const m of sent) assert.notEqual(pushForEmail(m.subject, m.html).kind, 'email.other', m.subject);
});

test('deactivated and suspended accounts are told, and an erased one never is', async () => {
    await run('notify.deactivated', { user_id: 'guest', by: 'self' });
    assert.equal(sent[0].subject, 'Your account has been deactivated');
    await run('notify.deactivated', { user_id: 'guest', by: 'suspended' });
    assert.equal(sent[0].subject, 'Your account has been suspended');
    assert.equal(pushForEmail(sent[0].subject, sent[0].html).category, 'account', 'always on');
    assert.equal((await run('notify.deactivated', { user_id: 'gone', by: 'self' })).status, 'skipped');
    assert.equal(sent.length, 0);
});

test('only notify rows are handled here', async () => {
    assert.equal(await ev.eventMail(world(), { kind: 'message.new', context: {} }), null);
});

test('the triggers record only, swallow their own errors, and catch exactly the right moments', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261019174205_events_for_chargebacks_declines_lapses_and_deactivation.sql'), 'utf8');
    const body = sql.replace(/--.*$/gm, '');
    const fns = body.split('create or replace function').slice(1);
    assert.equal(fns.length, 4);
    for (const f of fns) {
        assert.match(f, /exception when others then\s+null;/);
        assert.doesNotMatch(f, /net\.http|pg_net|http_post/, 'a trigger never sends');
    }
    assert.match(body, /old\.status = 'pending' and new\.status = 'escalated'\s+and new\.responded_at is not null/, 'the guest declining, not the 72-hour sweep');
    assert.match(body, /old\.status = 'authorised' and new\.status = 'expired'/);
    assert.match(body, /old\.pending_change_expires_at < now\(\)\s+and new\.service_date is not distinct from old\.service_date/, 'lapsed, not answered');
    assert.match(body, /when auth\.uid\(\) = new\.id then 'self' else 'suspended'/);
});

test('nothing in payment, payout or settlement code was touched to do this', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/scenario-report.cjs'), 'utf8');
    const block = src.slice(src.indexOf('const WATCHED = ['), src.indexOf('];', src.indexOf('const WATCHED = [')));
    for (const m of block.matchAll(/'([^']+\.ts)'/g)) {
        const full = path.join(ROOT, m[1]);
        if (fs.existsSync(full)) assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /eventEmails|notify\.chargeback|notify\.money_declined/, m[1]);
    }
});
