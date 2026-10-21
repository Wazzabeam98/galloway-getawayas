// A chargeback on an EXPERIENCE tells the provider, the way one on a stay tells
// the host (GG-PARITY-AUDIT gap 10). Before this the webhook could only tie a
// dispute to a holiday-let booking, so an experience's dispute was stored with
// no booking and the provider heard nothing while their payout was held.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, clearModule } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sent: { to: string; subject: string; html: string }[] = [];
const realEmail = require('../lib/email');
stubModule('@/lib/email', { ...realEmail, sendEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return true; } });
clearModule('@/lib/eventEmails');
const ev = require('../lib/eventEmails');
const { pushForEmail } = require('../lib/pushRules');

function db(tables: Record<string, any[]>) {
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
    return { from, auth: { admin: { getUserById: async () => ({ data: { user: null } }) } } };
}

const world = () => db({
    disputes: [
        { id: 'od1', booking_id: null, order_id: 'o1', amount: 76, status: 'needs_response' },
        { id: 'od2', booking_id: null, order_id: 'o1', amount: 76, status: 'won' },
        { id: 'od3', booking_id: null, order_id: null, amount: 5 },
    ],
    service_orders: [{ id: 'o1', guest_id: 'guest', provider_id: 'p1', item_name: 'Smokehouse tasting', service_date: '2026-12-11' }],
    service_providers: [{ id: 'p1', business_name: 'Smoked on the Solway', contact_email: 'hello@kippfordsmokehouse.co.uk' }],
    profiles: [{ id: 'guest', first_name: 'Ailsa' }],
});
const run = async (context: any) => { sent.length = 0; return ev.eventMail(world(), { kind: 'notify.chargeback', context }); };

test('an experience chargeback is emailed to the provider, linking their earnings', async () => {
    const out = await run({ dispute_id: 'od1', stage: 'opened' });
    assert.equal(out.status, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'hello@kippfordsmokehouse.co.uk', 'their contact address, as every provider email');
    assert.equal(sent[0].subject, 'A guest’s bank has disputed a payment for Smokehouse tasting');
    assert.match(sent[0].html, /£76/);
    assert.match(sent[0].html, /11\/12\/2026/);
    assert.match(sent[0].html, /\/services\/dashboard\/earnings/);
    const p = pushForEmail(sent[0].subject, sent[0].html);
    assert.deepEqual([p.kind, p.category, p.team], ['exp.chargeback.provider', 'payments', 'can_earnings'], 'co-hosts with earnings get it, as a host\'s co-hosts do');
});

test('and again when it closes, with the outcome', async () => {
    await run({ dispute_id: 'od2', stage: 'closed' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, 'The payment dispute for Smokehouse tasting has closed');
    assert.match(sent[0].html, /in our favour/);
    assert.equal(pushForEmail(sent[0].subject, sent[0].html).kind, 'exp.chargeback_closed.provider');
});

test('a dispute tied to nothing still tells nobody', async () => {
    const out = await run({ dispute_id: 'od3', stage: 'opened' });
    assert.equal(out.status, 'skipped');
    assert.equal(sent.length, 0);
});

test('the webhook ties an unmatched dispute to the experience order by its payment intent — and tells nobody itself', () => {
    const hook = read('app/api/stripe/webhook/route.ts');
    assert.match(hook, /if \(!bookingId && d\.payment_intent\)[\s\S]{0,200}\.from\('service_orders'\)[\s\S]{0,120}\.eq\('stripe_payment_intent_id', d\.payment_intent\)/);
    assert.match(hook, /order_id: orderId,/);
    assert.doesNotMatch(hook, /eventEmails|notify\.chargeback/, 'payment code never sends a notification');
});

test('the trigger records a notice for a dispute with a booking OR an order, and only records', () => {
    const sql = read('supabase/migrations/20261021132115_chargebacks_on_experience_orders.sql').replace(/--.*$/gm, '');
    assert.match(sql, /add column if not exists order_id uuid references public\.service_orders \(id\) on delete set null/);
    assert.match(sql, /anchored boolean := \(new\.booking_id is not null or new\.order_id is not null\)/);
    assert.match(sql, /after insert or update of booking_id, order_id, closed_at on public\.disputes/);
    assert.match(sql, /exception when others then\s+null;/, 'a notice never stops a chargeback being recorded');
    assert.doesNotMatch(sql, /net\.http|pg_net|http_post/, 'a trigger never sends');
});
