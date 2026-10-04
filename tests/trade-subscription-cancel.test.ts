// Tradesperson Agreement 3.4: "You may cancel at any time. Your listing stays up
// until the end of the period you have paid for. We do not refund part months."
// These hold the cancel to Stripe's cancel_at_period_end (never an immediate
// cancel), the date the trade is shown, the undo, and the webhook clearing the
// dead id only when the end was the trade's own cancellation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const calls: any[] = [];
stubModule('@/lib/stripe', {
    stripeRequest: async (method: string, p: string, body?: any) => {
        calls.push({ method, path: p, body });
        const cancel = body && body.cancel_at_period_end === 'true';
        return { id: 'sub_1', status: 'active', current_period_end: 1767225600, cancel_at_period_end: cancel, cancel_at: cancel ? 1767225600 : null };
    },
});

const { subscriptionState, isLive, setCancelAtPeriodEnd, endedByOwnCancellation } = require('../lib/subscriptionCancel');

test('the agreement still says what this implements', () => {
    assert.match(read('components/legal/agreements/text/tradesperson.ts'),
        /3\.4 You may cancel at any time\. Your listing stays up until the end of the period you have paid for\. We do not refund part months\./);
});

test('cancelling sets cancel_at_period_end — never an immediate cancel — and undo clears it', async () => {
    calls.length = 0;
    const after = await setCancelAtPeriodEnd('sub_1', true);
    assert.equal(calls[0].method, 'POST', 'not DELETE: a DELETE would end it today');
    assert.deepEqual(calls[0].body, { cancel_at_period_end: 'true' });
    assert.equal(after.cancelAtPeriodEnd, true);
    assert.equal(after.endsAt, 1767225600 * 1000, 'ends at the end of the paid period');

    const undone = await setCancelAtPeriodEnd('sub_1', false);
    assert.deepEqual(calls[1].body, { cancel_at_period_end: 'false' });
    assert.equal(undone.cancelAtPeriodEnd, false);
    assert.equal(undone.endsAt, null);
});

test('the route cancels at period end and never calls the immediate cancel', () => {
    const src = read('app/api/services/subscription/route.ts');
    assert.match(src, /setCancelAtPeriodEnd\(p\.stripe_subscription_id, action === 'cancel'\)/);
    assert.doesNotMatch(src, /cancelProviderSubscription|'DELETE'/);
    assert.match(src, /p\.owner_id !== user\.id/, 'owner-checked');
});

test('the date shown is the period end; a scheduled cancel shows when it ends', () => {
    const live = subscriptionState({ status: 'active', current_period_end: 1767225600, cancel_at_period_end: false });
    assert.equal(live.periodEnd, 1767225600000);
    assert.equal(live.endsAt, null);
    const ending = subscriptionState({ status: 'active', current_period_end: 1767225600, cancel_at_period_end: true, cancel_at: 1767225600 });
    assert.equal(ending.endsAt, 1767225600000);
    assert.equal(isLive(ending), true, 'still live, so it can be undone');
    assert.equal(isLive(subscriptionState({ status: 'canceled' })), false, 'an ended one cannot be undone');
});

test('only the trade’s own cancellation clears the dead id on deletion', () => {
    assert.equal(endedByOwnCancellation({ cancel_at_period_end: true }), true);
    assert.equal(endedByOwnCancellation({ cancellation_details: { reason: 'cancellation_requested' } }), true);
    assert.equal(endedByOwnCancellation({ cancel_at_period_end: false, cancellation_details: { reason: 'payment_failed' } }), false);
    const hook = read('app/api/stripe/webhook/route.ts');
    assert.match(hook, /customer\.subscription\.deleted' && endedByOwnCancellation\(sub\)[\s\S]{0,80}stripe_subscription_id = null/);
});

test('the billing page no longer sends trades to email us to cancel', () => {
    const page = read('app/services/billing/[token]/page.tsx');
    assert.doesNotMatch(page, /Reply to any of our emails to change or\s+cancel/);
    assert.match(page, /stays up until the end of the month you’ve paid for/);
});
