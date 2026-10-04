// Taking a provider's listing down — the owner's pause and an admin's take-down —
// for experiences and trades.
//
// What these hold:
//   * a taken-down provider is off every surface that sells or takes enquiries
//     (the two gate functions, and every route select that feeds them);
//   * a trade's pause stops their £20 billing BEFORE the listing comes down, and
//     restarts it BEFORE it goes back up — and a Stripe refusal changes nothing;
//   * a relist after an admin take-down puts a trade back on the card ladder
//     without firing the whole ladder at them in one morning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, fakeSupabase } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// Stripe and the director alert are stubbed before anything loads them.
const stripeCalls: any[] = [];
let stripeFails = false;
stubModule('@/lib/stripe', {
    stripeRequest: async (method: string, p: string, body?: any) => {
        stripeCalls.push({ method, path: p, body });
        if (stripeFails) { const e: any = new Error('card_declined'); e.stripeStatus = 402; throw e; }
        return { id: 'sub_1' };
    },
});
const moneyAlerts: string[] = [];
stubModule('@/lib/moneyAlert', { logMoneyFailure: async (m: string) => { moneyAlerts.push(m); } });

const { visibleInDirectory } = require('../lib/serviceSubscription');
const { isLiveToGuests } = require('../lib/serviceOrders');
const { setOwnerPaused, adminTakeDown, relistPatch } = require('../lib/providerTakedown');

const live = { status: 'approved', stripe_payouts_enabled: true, subscription_status: 'active' };

test('a paused or admin-hidden trade is out of the directory and takes no new enquiry', () => {
    assert.equal(visibleInDirectory({ ...live }), true);
    assert.equal(visibleInDirectory({ ...live, owner_paused: true }), false);
    assert.equal(visibleInDirectory({ ...live, admin_hidden_at: '2026-10-04T10:00:00Z' }), false);
});

test('a paused or admin-hidden experience is not live to guests', () => {
    assert.equal(isLiveToGuests({ ...live }), true);
    assert.equal(isLiveToGuests({ ...live, owner_paused: true }), false);
    assert.equal(isLiveToGuests({ ...live, admin_hidden_at: '2026-10-04T10:00:00Z' }), false);
});

// The gates read undefined as "not taken down", so a select that forgets the
// columns silently re-opens the shop. Every read that decides whether to SELL or
// take an enquiry must select both. (The order routes once missed owner_paused.)
test('every new-order and directory read selects both take-down columns', () => {
    const files = [
        'app/api/services/order/route.ts',
        'app/api/services/slots/book/route.ts',
        'app/api/services/experiences/route.ts',
        'lib/experiencesData.ts',
        'app/api/services/enquiries/route.ts',
        'app/services/[trade]/[providerId]/page.tsx',
    ];
    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const selects = (src.match(/\.select\('[^']*'\)/g) || [])
            .filter((s: string) => /stripe_payouts_enabled|subscription_status/.test(s));
        assert.ok(selects.length > 0, f + ' has no gate select');
        for (const s of selects) {
            assert.match(s, /owner_paused/, f + ' select misses owner_paused: ' + s.slice(0, 80));
            assert.match(s, /admin_hidden_at/, f + ' select misses admin_hidden_at: ' + s.slice(0, 80));
        }
    }
});

function providerDb(row: any, failWrite = false) {
    const writes: any[] = [];
    const db = fakeSupabase({
        service_providers: (state: any) => {
            const upd = state.ops.find((o: any) => o.op === 'update');
            if (upd) {
                writes.push(upd.args[0]);
                return { data: null, error: failWrite ? { message: 'boom' } : null };
            }
            return { data: row, error: null };
        },
    });
    return { client: db.client, writes };
}

test('pausing a trade pauses billing first, then hides; resuming restarts billing first', async () => {
    stripeCalls.length = 0; stripeFails = false;
    const down = providerDb({ id: 'p1', owner_paused: false, stripe_subscription_id: 'sub_1' });
    const r1 = await setOwnerPaused(down.client, 'p1', true);
    assert.equal(r1.ok, true);
    assert.equal(stripeCalls.length, 1);
    assert.deepEqual(stripeCalls[0].body, { pause_collection: { behavior: 'void' } });
    assert.equal(down.writes[0].owner_paused, true);

    stripeCalls.length = 0;
    const up = providerDb({ id: 'p1', owner_paused: true, stripe_subscription_id: 'sub_1' });
    const r2 = await setOwnerPaused(up.client, 'p1', false);
    assert.equal(r2.ok, true);
    assert.deepEqual(stripeCalls[0].body, { pause_collection: '' });
    assert.equal(up.writes[0].owner_paused, false);
});

test('Stripe refusing the pause leaves the listing exactly as it was', async () => {
    stripeCalls.length = 0; stripeFails = true; moneyAlerts.length = 0;
    const db = providerDb({ id: 'p1', owner_paused: false, stripe_subscription_id: 'sub_1' });
    const r = await setOwnerPaused(db.client, 'p1', true);
    stripeFails = false;
    assert.equal(r.ok, false);
    assert.equal(db.writes.length, 0, 'nothing written when billing could not be paused');
    assert.equal(moneyAlerts.length, 1);
});

test('a failed listing write after pausing puts the billing back', async () => {
    stripeCalls.length = 0; stripeFails = false;
    const db = providerDb({ id: 'p1', owner_paused: false, stripe_subscription_id: 'sub_1' }, true);
    const r = await setOwnerPaused(db.client, 'p1', true);
    assert.equal(r.ok, false);
    assert.equal(stripeCalls.length, 2);
    assert.deepEqual(stripeCalls[1].body, { pause_collection: '' }, 'billing resumed to match the still-live listing');
});

test('an experience (no subscription) pauses without touching Stripe', async () => {
    stripeCalls.length = 0;
    const db = providerDb({ id: 'e1', owner_paused: false, stripe_subscription_id: null });
    const r = await setOwnerPaused(db.client, 'e1', true);
    assert.equal(r.ok, true);
    assert.equal(stripeCalls.length, 0);
    assert.equal(db.writes[0].owner_paused, true);
});

test('an admin take-down of a trade cancels the subscription and clears it off the row', async () => {
    stripeCalls.length = 0; stripeFails = false;
    const r = await adminTakeDown(null, { id: 'p1', stripe_subscription_id: 'sub_1' }, '2026-10-04T10:00:00.000Z');
    assert.equal(r.ok, true);
    assert.equal(stripeCalls[0].method, 'DELETE');
    assert.equal(r.patch.admin_hidden_at, '2026-10-04T10:00:00.000Z');
    assert.equal(r.patch.stripe_subscription_id, null);
    assert.equal(r.patch.subscription_status, 'canceled');
});

test('an admin take-down that Stripe refuses to cancel changes nothing', async () => {
    stripeFails = true;
    const r = await adminTakeDown(null, { id: 'p1', stripe_subscription_id: 'sub_1' }, '2026-10-04T10:00:00.000Z');
    stripeFails = false;
    assert.equal(r.ok, false);
    assert.equal(r.patch, undefined);
});

test('relisting an experience only lifts the take-down', () => {
    const p = relistPatch({ plan: 'commission', admin_hidden_at: 'x' }, new Date('2026-10-04T10:00:00Z'));
    assert.deepEqual(Object.keys(p).sort(), ['admin_hidden_at', 'updated_at']);
    assert.equal(p.admin_hidden_at, null);
});

test('relisting a trade whose subscription we cancelled gives seven days’ grace, one card email', () => {
    const now = new Date('2026-10-04T10:00:00Z');
    const p = relistPatch({
        plan: 'subscription', stripe_subscription_id: null, subscription_status: 'canceled',
        trial_ends_at: '2026-03-01T00:00:00Z', reminders_sent: ['trial_started', 'thirty_days'],
    }, now);
    assert.equal(p.subscription_status, 'none');
    assert.equal(p.trial_ends_at, now.toISOString());
    // Everything up to the free period's end is marked sent; only the grace
    // email (with the card link) is still to come.
    assert.ok(p.reminders_sent.indexOf('grace') === -1);
    for (const k of ['trial_started', 'thirty_days', 'fourteen_days', 'seven_days', 'one_day']) {
        assert.ok(p.reminders_sent.indexOf(k) !== -1, k + ' marked sent');
    }
});

test('relisting a trade delisted for non-payment does not re-list them for free', () => {
    const p = relistPatch({ plan: 'subscription', stripe_subscription_id: null, subscription_status: 'unpaid' }, new Date());
    assert.equal(p.subscription_status, undefined);
});
