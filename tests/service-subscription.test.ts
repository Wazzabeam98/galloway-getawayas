// The ladder that is the only reason anybody ever pays.
//
// Nobody has a card on file until the end of the ninety days, so these emails
// are not a courtesy — if they do not go out, the subscription does not exist
// and nothing anywhere fails to say so. That is what makes this file worth
// more than its length suggests: every bug it catches is silent in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    REMINDERS,
    remindersDue,
    reminderByKey,
    hasCard,
    dueDate,
    graceEndsAt,
    graceExpired,
    visibleInDirectory,
    GRACE_DAYS,
    SUBSCRIPTION_STATUSES,
} = require('../lib/serviceSubscription');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TRIAL_DAYS } = require('../lib/serviceProviders');

const ENDS = '2026-11-29T12:00:00.000Z';

function provider(over: any = {}) {
    return {
        id: 'p1',
        business_name: 'Baxter Plumbing',
        contact_email: 'baxter@example.test',
        plan: 'subscription',
        status: 'approved',
        trial_ends_at: ENDS,
        stripe_subscription_id: null,
        subscription_status: 'none',
        reminders_sent: [],
        ...over,
    };
}

// A day relative to the end of the trial, for readability below.
function on(offsetDays: number, hour = 12) {
    const d = new Date(ENDS);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
}

// ---------------------------------------------------------------------------
// THE SHAPE OF THE LADDER
// ---------------------------------------------------------------------------

test('one email that asks for nothing comes before any email that asks', () => {
    // The rule the whole sequence is built on. A tradesman who has had ninety
    // free days and then gets a bill out of nowhere is a tradesman who leaves.
    const firstAsk = REMINDERS.findIndex((r: any) => r.asks);
    assert.equal(firstAsk > 0, true, 'something warns him before anything asks him');

    const before = REMINDERS.slice(0, firstAsk);
    assert.equal(before.every((r: any) => !r.asks), true);
    assert.equal(before.length >= 2, true, 'the start of the trial and the month mark');
});

test('the ladder runs in order, from the start of the trial to after it ends', () => {
    const offsets = REMINDERS.map((r: any) => r.offset);
    const sorted = offsets.slice().sort((a: number, b: number) => a - b);

    assert.deepEqual(offsets, sorted, 'declared in the order they are sent');
    assert.equal(offsets[0], -TRIAL_DAYS, 'the first lands as the free period starts');
    assert.equal(offsets[offsets.length - 1] > 0, true, 'the last lands after it has ended');
});

test('every reminder key is unique, because the key is what stops a re-send', () => {
    // reminders_sent is keyed on these. A duplicate key would mean one send
    // suppressing a different email; a renamed one would re-send to everybody
    // who already had the old one.
    const keys = REMINDERS.map((r: any) => r.key);
    assert.equal(new Set(keys).size, keys.length);
    keys.forEach((k: string) => assert.equal(reminderByKey(k).key, k));
});

test('everything that asks for a card stops once there is one', () => {
    REMINDERS.filter((r: any) => r.asks).forEach((r: any) => {
        assert.equal(r.needsCard, true, r.key + ' must not chase somebody who has paid');
    });
});

// ---------------------------------------------------------------------------
// WHAT IS DUE, AND WHEN
// ---------------------------------------------------------------------------

test('nothing is due before its day', () => {
    // The day before the thirty-day note, the cron owes nothing at all — the
    // only earlier email is the one the enquiry route already sent.
    const due = remindersDue(provider(), on(-31)).map((r: any) => r.key);
    assert.deepEqual(due, []);
});

test('each reminder becomes due on its own day', () => {
    for (const r of REMINDERS.filter((x: any) => !x.atFirstEnquiry)) {
        const due = remindersDue(provider(), on(r.offset)).map((x: any) => x.key);
        assert.equal(due.indexOf(r.key) !== -1, true, r.key + ' is due on its day');
    }
});

// THE ONE THE CRON MUST NEVER SEND.
//
// 'trial_started' says the free period began "today" and goes out from the
// enquiry route at the moment the clock is stamped. The cron runs at seven in
// the morning, so if it could send this, a tradesman whose first enquiry
// arrived at three in the afternoon would read "today" the next morning about
// a day that had passed. There is no offset at which the cron may claim it.
test('the cron never sends the first email, at any point in the trial', () => {
    const first = REMINDERS.filter((r: any) => r.atFirstEnquiry);
    assert.equal(first.length, 1, 'exactly one email is sent from the enquiry route');
    assert.equal(first[0].key, 'trial_started');

    for (let day = -TRIAL_DAYS - 5; day <= 30; day++) {
        const due = remindersDue(provider(), on(day)).map((r: any) => r.key);
        assert.equal(due.indexOf('trial_started'), -1,
            'the cron claimed the first email on day ' + day);
    }
});

test('a reminder already sent is never sent again', () => {
    const sent = provider({ reminders_sent: ['trial_started', 'thirty_days', 'fourteen_days'] });
    // 'trial_started' is in there because the enquiry route records it.
    const due = remindersDue(sent, on(-14)).map((r: any) => r.key);

    assert.deepEqual(due, [], 'nothing outstanding');
});

// A cron that missed a day must catch up rather than skip. The alternative is
// a tradesman who is never told his card is due, and no failure anywhere.
test('a missed day is caught up, not skipped', () => {
    const due = remindersDue(provider(), on(-6)).map((r: any) => r.key);

    assert.deepEqual(due, ['thirty_days', 'fourteen_days', 'seven_days'],
        'everything whose day has passed, not just today s');
});

// The expensive bug in the other direction: chasing a man who has already paid.
test('a provider with a card is asked for nothing more', () => {
    const paid = provider({ stripe_subscription_id: 'sub_123' });
    const due = remindersDue(paid, on(1)).map((r: any) => r.key);

    assert.deepEqual(due, ['thirty_days'],
        'only the one the cron owes that never asks for anything');
    assert.equal(hasCard(paid), true);
});

test('a customer id is not a card', () => {
    // A Stripe customer exists the moment Checkout opens and can sit there for
    // ever with nothing behind it. Treating it as payment would silence the
    // whole ladder for somebody who abandoned the page.
    assert.equal(hasCard(provider({ stripe_customer_id: 'cus_1' })), false);
    assert.equal(hasCard(provider({ stripe_subscription_id: 'sub_1' })), true);
});

test('nobody outside the subscription ever gets one of these', () => {
    assert.deepEqual(remindersDue(provider({ plan: 'commission' }), on(0)), []);
    assert.deepEqual(remindersDue(provider({ status: 'hidden' }), on(0)), []);
    assert.deepEqual(remindersDue(provider({ status: 'pending_review' }), on(0)), []);
    assert.deepEqual(remindersDue(provider({ trial_ends_at: null }), on(0)), [],
        'no first enquiry yet, so no clock and nothing owed');
    assert.deepEqual(remindersDue(null, on(0)), []);
});

test('the due date is counted off the trial end, not off today', () => {
    assert.equal(dueDate(ENDS, -14).toISOString(), '2026-11-15T12:00:00.000Z');
    assert.equal(dueDate(ENDS, 3).toISOString(), '2026-12-02T12:00:00.000Z');
});

// ---------------------------------------------------------------------------
// GRACE, AND THE LISTING COMING DOWN
// ---------------------------------------------------------------------------

test('the grace period is seven days after the free period ends', () => {
    assert.equal(GRACE_DAYS, 7);
    assert.equal(graceEndsAt(ENDS), '2026-12-06T12:00:00.000Z');
});

test('a listing stays up through the grace period and comes down after it', () => {
    assert.equal(graceExpired(provider(), on(0)), false, 'the day it ends');
    assert.equal(graceExpired(provider(), on(6)), false, 'still inside the seven days');
    assert.equal(graceExpired(provider(), on(7)), true, 'the seven days are up');
});

test('somebody who paid is never hidden, however late in the grace period', () => {
    const paid = provider({ stripe_subscription_id: 'sub_123' });
    assert.equal(graceExpired(paid, on(30)), false);
});

test('a provider already hidden is not hidden a second time', () => {
    // The cron would otherwise write the same row every day for ever.
    const already = provider({ subscription_status: 'unpaid' });
    assert.equal(graceExpired(already, on(30)), false);
});

test('nobody without a clock running can have their listing taken down', () => {
    assert.equal(graceExpired(provider({ trial_ends_at: null }), on(30)), false);
    assert.equal(graceExpired(provider({ plan: 'commission' }), on(30)), false);
});

// ---------------------------------------------------------------------------
// THE SHOP WINDOW
// ---------------------------------------------------------------------------

test('only unpaid takes a business out of the directory', () => {
    // past_due must NOT hide: Stripe is still retrying, and a listing that
    // flickers off on the first failed card and back on the retry is worse
    // than one that waits for the answer.
    assert.equal(visibleInDirectory(provider({ subscription_status: 'none' })), true);
    assert.equal(visibleInDirectory(provider({ subscription_status: 'trialing' })), true);
    assert.equal(visibleInDirectory(provider({ subscription_status: 'active' })), true);
    assert.equal(visibleInDirectory(provider({ subscription_status: 'past_due' })), true);
    assert.equal(visibleInDirectory(provider({ subscription_status: 'unpaid' })), false);
});

test('a business the admin took down stays down whatever it is paying', () => {
    // The two columns are read together and neither overrides the other.
    assert.equal(visibleInDirectory(provider({ status: 'hidden', subscription_status: 'active' })), false);
    assert.equal(visibleInDirectory(provider({ status: 'declined' })), false);
});

test('every status the webhook can copy across is one the database allows', () => {
    // The webhook writes Stripe's own vocabulary straight onto the row. A
    // status Stripe can send and the check constraint refuses would be a
    // webhook that throws, on the event that says somebody stopped paying.
    ['trialing', 'active', 'past_due', 'unpaid', 'canceled'].forEach((s) => {
        assert.equal(SUBSCRIPTION_STATUSES.indexOf(s) !== -1, true, s + ' is allowed');
    });
});
