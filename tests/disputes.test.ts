// Chargebacks.
//
// Nothing listened for these, and the platform carries full liability — so the
// first anyone would have known was money missing. Stripe decides a dispute on
// the evidence sent before a deadline measured in days, which makes the
// deadline arithmetic and the "is this still money at risk" rule worth testing
// on their own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor, deadlineText, isUrgent, isMoneyAtRisk, isInquiry } from '../lib/disputes';

const now = new Date('2026-08-22T12:00:00.000Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3600000);

/* ------------------------------------------------------------- deadlines */

test('a deadline is counted in whole days, then hours as it closes', () => {
    assert.equal(deadlineText(inHours(24 * 9), now), '9 days left');
    assert.equal(deadlineText(inHours(48), now), '2 days left');
    assert.equal(deadlineText(inHours(25), now), '1 day left');
    assert.equal(deadlineText(inHours(6), now), '6 hours left');
    assert.equal(deadlineText(inHours(1), now), '1 hour left');
});

test('a deadline that has gone says so rather than counting backwards', () => {
    assert.equal(deadlineText(inHours(-1), now), 'The deadline has passed.');
    assert.equal(deadlineText(inHours(-500), now), 'The deadline has passed.');
});

test('no deadline sends you to Stripe rather than inventing one', () => {
    assert.match(deadlineText(null, now), /Stripe/);
});

test('urgent means under three days, and an unknown deadline is urgent', () => {
    assert.equal(isUrgent(inHours(24 * 5), now), false);
    assert.equal(isUrgent(inHours(71), now), true);
    assert.equal(
        isUrgent(null, now),
        true,
        'not knowing when it is due is a reason to look now, not later'
    );
});

/* --------------------------------------------------------- money at risk */

test('an open dispute is money at risk', () => {
    assert.equal(isMoneyAtRisk({ status: 'needs_response', funds_reinstated_at: null }), true);
    assert.equal(isMoneyAtRisk({ status: 'under_review', funds_reinstated_at: null }), true);
    assert.equal(isMoneyAtRisk({ status: 'lost', funds_reinstated_at: null }), true);
});

// Found by raising both kinds against test Stripe: the page totalled an early
// fraud warning together with a real chargeback, when no money had gone on the
// warning at all. A warning cannot even be closed the way a dispute can.
test('an early warning is not money at risk, because nothing has been taken', () => {
    assert.equal(isInquiry('warning_needs_response'), true);
    assert.equal(isInquiry('warning_under_review'), true);
    assert.equal(isInquiry('warning_closed'), true);
    assert.equal(isInquiry('needs_response'), false, 'a real dispute is not a warning');
    assert.equal(isInquiry(null), false);

    assert.equal(isMoneyAtRisk({ status: 'warning_needs_response', funds_reinstated_at: null }), false);
    assert.equal(
        isMoneyAtRisk({ status: 'needs_response', funds_reinstated_at: null }),
        true,
        'but the real one still counts, or the total understates the loss'
    );
});

test('a won dispute is not money at risk', () => {
    // Otherwise the total on the page keeps counting money that came back,
    // and a number nobody can explain is a number nobody trusts.
    assert.equal(isMoneyAtRisk({ status: 'won', funds_reinstated_at: null }), false);
    assert.equal(isMoneyAtRisk({ status: 'warning_closed', funds_reinstated_at: null }), false);
});

test('reinstated funds settle it whatever the status says', () => {
    assert.equal(
        isMoneyAtRisk({ status: 'needs_response', funds_reinstated_at: '2026-08-22T00:00:00Z' }),
        false,
        'the money is back; the status field lagging does not change that'
    );
});

/* ------------------------------------------------------------- guidance */

test('each Stripe reason gets its own advice, not one generic answer', () => {
    const notReceived = guidanceFor('product_not_received');
    const fraud = guidanceFor('fraudulent');
    const duplicate = guidanceFor('duplicate');

    assert.notEqual(notReceived.meaning, fraud.meaning);
    assert.notEqual(fraud.meaning, duplicate.meaning);

    assert.match(notReceived.evidence.join(' '), /stay took place|key safe/i);
    assert.match(fraud.evidence.join(' '), /3-D Secure|IP address/i);
    assert.match(duplicate.evidence.join(' '), /deposit and (a )?balance|twice|both charges/i);
});

test('every reason says what we already hold, including the core records', () => {
    for (const reason of ['product_not_received', 'fraudulent', 'duplicate', 'subscription_canceled', 'general']) {
        const g = guidanceFor(reason);
        assert.ok(g.weHold.length > 0, reason + ' must say where to look');
        assert.match(
            g.weHold.join(' '),
            /message thread/i,
            'the thread is evidence in every case and must always be listed'
        );
    }
});

test('an unknown reason admits it rather than guessing', () => {
    const g = guidanceFor('some_new_code_stripe_added');
    assert.match(g.meaning, /some_new_code_stripe_added/, 'it quotes the code back');
    assert.match(g.meaning, /no specific guidance/i);
    assert.ok(g.evidence.length > 0, 'but still says something useful');
});

test('a missing reason is treated as general, not as an error', () => {
    assert.equal(guidanceFor(null).meaning, guidanceFor('general').meaning);
    assert.equal(guidanceFor(undefined).meaning, guidanceFor('general').meaning);
});
