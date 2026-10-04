// Tradesperson Agreement 3.3: "If payment fails, we will tell you". The webhook
// calls notifyPaymentFailed on every invoice.payment_failed, and Stripe sends
// that on every retry and may redeliver — so these hold that one failed invoice
// is one email, that a send that fails gives its claim back for the retry, and
// that seeded/test addresses are never mailed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule } from './helpers/stub';

installAliases();

const sent: Array<{ to: string; subject: string; html: string }> = [];
let sendOk = true;
stubModule('@/lib/email', {
    sendEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return sendOk; },
    emailLayout: (body: string) => body,
    escapeHtml: (s: string) => String(s),
    button: (url: string, label: string) => `[${label}](${url})`,
    detailRows: () => '',
    SITE_URL: 'https://example.test',
    NEUTRAL_SUBTITLE: '',
});
const logged: any[] = [];
stubModule('@/lib/logError', { logError: async (...a: any[]) => { logged.push(a); } });

const { notifyPaymentFailed, paymentFailedKey } = require('../lib/serviceSubscriptionAlert');

// A one-row service_providers table that honours the guarded append the claim
// uses: update ... .not('reminders_sent', 'cs', '{key}') matches nothing once
// the key is present.
function fakeDb(row: any) {
    const db = {
        row,
        from() {
            const ops: any = { filters: [] as any[], update: null as any, select: false };
            const chain: any = {
                select() { ops.select = true; return chain; },
                update(patch: any) { ops.update = patch; return chain; },
                eq(col: string, val: any) { ops.filters.push((r: any) => r[col] === val); return chain; },
                not(col: string, _op: string, val: string) {
                    const key = val.replace(/^\{|\}$/g, '');
                    ops.filters.push((r: any) => !(r[col] || []).includes(key));
                    return chain;
                },
                maybeSingle() { return Promise.resolve({ data: ops.filters.every((f: any) => f(db.row)) ? { ...db.row } : null, error: null }); },
                then(resolve: any) {
                    const match = ops.filters.every((f: any) => f(db.row));
                    if (ops.update && match) db.row = { ...db.row, ...ops.update };
                    resolve({ data: match ? [{ id: db.row.id }] : [], error: null });
                },
            };
            return chain;
        },
    };
    return db;
}

const trade = () => ({
    id: 'p1', business_name: 'Solway Plumbing', contact_email: 'owner@realtrade.co.uk',
    reminders_sent: ['trial_started'], stripe_subscription_id: 'sub_1',
});

test('one failed invoice is one email, however many times Stripe sends it', async () => {
    sent.length = 0; sendOk = true;
    const db = fakeDb(trade());
    const inv = { id: 'in_1', hosted_invoice_url: 'https://invoice.stripe.com/i/abc' };
    assert.equal(await notifyPaymentFailed(db, 'sub_1', inv), 'sent');
    assert.equal(await notifyPaymentFailed(db, 'sub_1', inv), 'already');
    assert.equal(await notifyPaymentFailed(db, 'sub_1', inv), 'already');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@realtrade.co.uk');
    assert.match(sent[0].html, /didn’t go through/);
    assert.match(sent[0].html, /\[Pay now\]\(https:\/\/invoice\.stripe\.com\/i\/abc\)/);
    assert.ok(db.row.reminders_sent.includes(paymentFailedKey('in_1')));
    assert.ok(db.row.reminders_sent.includes('trial_started'), 'the reminder ladder keys are kept');
});

test('a new failed month is a new email', async () => {
    sent.length = 0; sendOk = true;
    const db = fakeDb(trade());
    await notifyPaymentFailed(db, 'sub_1', { id: 'in_1' });
    await notifyPaymentFailed(db, 'sub_1', { id: 'in_2' });
    assert.equal(sent.length, 2);
});

test('a send that fails gives the claim back, so the redelivery tries again', async () => {
    sent.length = 0; sendOk = false;
    const db = fakeDb(trade());
    assert.equal(await notifyPaymentFailed(db, 'sub_1', { id: 'in_9' }), 'failed');
    assert.ok(!db.row.reminders_sent.includes(paymentFailedKey('in_9')), 'claim released');
    assert.ok(db.row.reminders_sent.includes('trial_started'));
    sendOk = true;
    assert.equal(await notifyPaymentFailed(db, 'sub_1', { id: 'in_9' }), 'sent');
});

test('no hosted invoice page: the email still goes, without a dead button', async () => {
    sent.length = 0; sendOk = true;
    await notifyPaymentFailed(fakeDb(trade()), 'sub_1', { id: 'in_3' });
    assert.doesNotMatch(sent[0].html, /Pay now/);
    assert.match(sent[0].html, /reply to this email/);
});

test('a seeded/test address is never mailed', async () => {
    sent.length = 0; sendOk = true;
    const db = fakeDb({ ...trade(), contact_email: 'seed-plumber@gallowaytrade.test' });
    assert.equal(await notifyPaymentFailed(db, 'sub_1', { id: 'in_4' }), 'skipped');
    assert.equal(sent.length, 0);
});

test('no provider for the subscription: nothing sent, nothing thrown', async () => {
    sent.length = 0;
    const db = fakeDb({ ...trade(), stripe_subscription_id: 'sub_other' });
    assert.equal(await notifyPaymentFailed(db, 'sub_1', { id: 'in_5' }), 'no_provider');
    assert.equal(sent.length, 0);
});
