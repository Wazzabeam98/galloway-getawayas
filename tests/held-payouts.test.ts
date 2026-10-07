// Money held for an experience provider who hasn't set up payouts (Airbnb's
// model: live once approved, share held until they can be paid) — the figures
// the dashboard, the reminder emails and the admin list share, and the reminder
// sequence. Pure; no database, no Stripe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();
const { heldSummary, isOwedToProvider } = require('../lib/heldPayouts');
const { planProviderReminders, providerReminderCopy } = require('../lib/experiencePayoutReminders');

const TODAY = '2026-10-20';
const order = (o: any) => ({
    id: o.id || 'o1', provider_id: o.provider_id || 'p1', status: 'confirmed', cancel_ack: null,
    service_date: '2026-10-25', price: 100, commission_rate: 0.1, amount_refunded: 0,
    created_at: '2026-10-01T10:00:00Z', paid_out_at: null, funds_flow: 'held', ...o,
});

test('owed: held + unpaid + confirmed or a walk-away — the payout run’s own rule', () => {
    assert.equal(isOwedToProvider(order({})), true);
    assert.equal(isOwedToProvider(order({ status: 'cancelled', cancel_ack: { refunded: 0 } })), true, 'a walk-away is kept by the provider');
    assert.equal(isOwedToProvider(order({ status: 'cancelled' })), false, 'a refunded cancel is owed nothing');
    assert.equal(isOwedToProvider(order({ paid_out_at: '2026-10-02T11:15:00Z' })), false, 'already paid');
    assert.equal(isOwedToProvider(order({ funds_flow: 'direct' })), false, 'a destination charge paid the provider at capture');
    assert.equal(isOwedToProvider(order({ status: 'authorised' })), false, 'not taken yet');
});

test('summary: waiting is the experience-has-happened share, coming up the rest, net of fee and refunds', () => {
    const s = heldSummary([
        order({ id: 'a', service_date: '2026-10-10' }),                       // £90 waiting
        order({ id: 'b', service_date: '2026-10-19', amount_refunded: 50 }),   // kept 50 → £45 waiting
        order({ id: 'c', service_date: TODAY }),                              // dated today: still coming up
        order({ id: 'd', service_date: '2026-11-01', price: 40 }),            // £36 coming up
        order({ id: 'e', service_date: '2026-10-01', status: 'cancelled' }),  // refunded cancel: nothing
    ], TODAY);
    assert.deepEqual(s, { waiting: 135, waitingCount: 2, upcoming: 126, upcomingCount: 2, oldestWaiting: '2026-10-10' });
});

test('reminders: first booking, then money waiting, then weekly — once each, stopping with nothing held', () => {
    const none = new Set<string>();
    // Only a future booking: the first-booking email.
    const first = planProviderReminders([order({})], none, TODAY);
    assert.deepEqual(first.map((r: any) => r.kind), ['first_booking']);
    assert.equal(planProviderReminders([order({})], new Set(['p1:first_booking']), TODAY).length, 0, 'sent once');

    // The experience has happened: "money waiting", and the first-booking one is claimed with it.
    const due = planProviderReminders([order({ service_date: '2026-10-18' })], none, TODAY);
    assert.equal(due.length, 1);
    assert.equal(due[0].kind, 'money_waiting');
    assert.equal(due[0].alsoClaim, 'first_booking');
    assert.equal(due[0].waiting, 90);

    // A week on from the oldest waiting order: weekly, each week once.
    const sent = new Set(['p1:first_booking', 'p1:money_waiting']);
    assert.equal(planProviderReminders([order({ service_date: '2026-10-15' })], sent, TODAY).length, 0, 'not a week yet');
    const week1 = planProviderReminders([order({ service_date: '2026-10-13' })], sent, TODAY);
    assert.deepEqual(week1.map((r: any) => r.kind), ['waiting_week_1']);
    assert.equal(planProviderReminders([order({ service_date: '2026-10-13' })], new Set([...sent, 'p1:waiting_week_1']), TODAY).length, 0);
    assert.deepEqual(planProviderReminders([order({ service_date: '2026-10-05' })], sent, TODAY).map((r: any) => r.kind), ['waiting_week_2']);

    // Nothing owed (paid out, refunded): nothing sent.
    assert.equal(planProviderReminders([order({ paid_out_at: '2026-10-19T11:15:00Z' })], none, TODAY).length, 0);
});

test('reminders: one email per provider, each provider on its own sequence', () => {
    const plan: any[] = planProviderReminders([
        order({ id: 'a', provider_id: 'p1' }),
        order({ id: 'b', provider_id: 'p1', service_date: '2026-11-02' }),
        order({ id: 'c', provider_id: 'p2', service_date: '2026-10-11' }),
    ], new Set(), TODAY);
    assert.deepEqual(plan.map((r: any) => r.providerId + ':' + r.kind).sort(), ['p1:first_booking', 'p2:money_waiting']);
});

test('copy: says how much is waiting and what to do', () => {
    const c = providerReminderCopy({ providerId: 'p1', kind: 'money_waiting', waiting: 135, upcoming: 36 });
    assert.match(c.subject, /£135\.00 is waiting for you/);
    assert.match(c.paragraphs.join(' '), /£36\.00 more/);
    assert.match(c.paragraphs.join(' '), /set up/i);
    const f = providerReminderCopy({ providerId: 'p1', kind: 'first_booking', waiting: 0, upcoming: 90 });
    assert.match(f.subject, /set up payouts/);
    assert.match(f.paragraphs[0], /£90\.00/);
});
