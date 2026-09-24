// The money rules and state machine for the stay Resolution Centre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    commissionRateFor, applicationFeePence, isDamageAllowed, sendCapPounds,
    validateSendAmount, escalationDeadline, isPastDeadline, guestMayRespond,
    hostMayDecideCounter, hostMayCancel, isTerminal, ESCALATION_HOURS, toPence,
} from '../lib/resolutions';

test('an extra-services request takes 10%; damage and sends take nothing', () => {
    assert.equal(commissionRateFor('request', 'extra_services'), 0.10);
    assert.equal(commissionRateFor('request', 'damage'), 0);
    assert.equal(commissionRateFor('send', 'extra_services'), 0);
    assert.equal(commissionRateFor('send', 'damage'), 0);
});

test('the application fee is 10% of the amount for extras, 0 for damage', () => {
    assert.equal(applicationFeePence(toPence(50), commissionRateFor('request', 'extra_services')), 500);
    assert.equal(applicationFeePence(toPence(50), commissionRateFor('request', 'damage')), 0);
});

test('damage is only allowed from check-out day onward', () => {
    const now = new Date('2026-10-09T09:00:00Z');
    assert.equal(isDamageAllowed('2026-10-09', now), true, 'on the check-out day');
    assert.equal(isDamageAllowed('2026-10-05', now), true, 'after check-out');
    assert.equal(isDamageAllowed('2026-10-12', now), false, 'before check-out (stay still upcoming)');
    assert.equal(isDamageAllowed(null, now), false);
});

test('a send is capped at what the guest has paid net of refunds', () => {
    assert.equal(sendCapPounds(300, 50), 250);
    assert.equal(sendCapPounds(100, 100), 0);
    assert.equal(validateSendAmount(200, 250).ok, true);
    const over = validateSendAmount(300, 250);
    assert.equal(over.ok, false);
    assert.match(over.error || '', /more than the £250\.00/);
    assert.equal(validateSendAmount(0, 250).ok, false, 'zero is refused');
});

test('the escalation deadline is 72 hours out, and lapses on time', () => {
    const from = '2026-10-01T00:00:00.000Z';
    const due = escalationDeadline(from);
    assert.equal(new Date(due).getTime() - new Date(from).getTime(), ESCALATION_HOURS * 3600 * 1000);
    assert.equal(isPastDeadline(due, new Date('2026-10-03T23:59:00Z')), false, 'inside 72h');
    assert.equal(isPastDeadline(due, new Date('2026-10-04T00:01:00Z')), true, 'past 72h');
    assert.equal(isPastDeadline(null), false);
});

test('the state machine gates who can act from each status', () => {
    assert.equal(guestMayRespond('pending'), true);
    assert.equal(guestMayRespond('countered'), false);
    assert.equal(guestMayRespond('paid'), false);
    assert.equal(hostMayDecideCounter('countered'), true);
    assert.equal(hostMayDecideCounter('pending'), false);
    assert.equal(hostMayCancel('pending'), true);
    assert.equal(hostMayCancel('countered'), true);
    assert.equal(hostMayCancel('paid'), false);
    assert.equal(isTerminal('paid'), true);
    assert.equal(isTerminal('escalated'), true);
    assert.equal(isTerminal('pending'), false);
});
