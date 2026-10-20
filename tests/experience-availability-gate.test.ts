// A set-times (slot) or comes-to-you experience must have its weekly opening
// hours set before it goes live. B's audit found approval made such an
// experience "live" with nothing a guest could book, because availability left
// the sign-up wizard for the listing editor and nothing then required it.
//
// needsWeeklyHours is the one rule behind the editor's greyed Submit, the submit
// RPC's SQL mirror, and the admin Approve gate; approvalBlockers is what the
// admin queue and the decision route both refuse on. These assert the rule
// directly, so the shapes it applies to can't drift apart from the gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { needsWeeklyHours, approvalBlockers } = require('@/lib/serviceProviders');

const HOURS_BLOCKER = /weekly opening hours/i;

test('needsWeeklyHours: a guest slot and comes-to-you need hours; made-to-order does not', () => {
    assert.equal(needsWeeklyHours({ audience: 'guest', shape: 'slot' }), true);
    assert.equal(needsWeeklyHours({ audience: 'guest', shape: 'comes_to_you' }), true);
    assert.equal(needsWeeklyHours({ audience: 'guest', shape: 'made_to_order' }), false);
    // Default/absent shape is the request engine (made_to_order) — not gated.
    assert.equal(needsWeeklyHours({ audience: 'guest' }), false);
});

test('needsWeeklyHours: a host trade is never gated, whatever the shape column says', () => {
    assert.equal(needsWeeklyHours({ audience: 'host', shape: 'slot' }), false);
    assert.equal(needsWeeklyHours({ trade: 'plumber', shape: 'comes_to_you' }), false);
});

test('needsWeeklyHours: a guest identified by trade (audience unset) is still gated', () => {
    assert.equal(needsWeeklyHours({ trade: 'guest', shape: 'slot' }), true);
});

test('approvalBlockers: a slot guest with no hours is blocked; with hours is not', () => {
    const slot = { trade: 'guest', audience: 'guest', shape: 'slot', stripe_mcc: '7997', custom_label: 'Activity' };
    const withoutHours = approvalBlockers(slot, [], undefined, { weeklyHoursSet: false });
    assert.ok(withoutHours.some((b: string) => HOURS_BLOCKER.test(b)), 'no-hours slot should be blocked');

    const withHours = approvalBlockers(slot, [], undefined, { weeklyHoursSet: true });
    assert.ok(!withHours.some((b: string) => HOURS_BLOCKER.test(b)), 'slot with hours should pass the hours gate');
});

test('approvalBlockers: a comes-to-you guest with no hours is blocked', () => {
    const chef = { trade: 'guest', audience: 'guest', shape: 'comes_to_you', stripe_mcc: '5811', custom_label: 'Private chef' };
    const stops = approvalBlockers(chef, [], undefined, { weeklyHoursSet: false });
    assert.ok(stops.some((b: string) => HOURS_BLOCKER.test(b)));
});

test('approvalBlockers: made-to-order is never held on hours, even with none set', () => {
    const baker = { trade: 'guest', audience: 'guest', shape: 'made_to_order', stripe_mcc: '5462', custom_label: 'Bakery' };
    const stops = approvalBlockers(baker, [], undefined, { weeklyHoursSet: false });
    assert.ok(!stops.some((b: string) => HOURS_BLOCKER.test(b)));
});

test('approvalBlockers: a caller that did not count hours (undefined) does not apply the hours gate', () => {
    const slot = { trade: 'guest', audience: 'guest', shape: 'slot', stripe_mcc: '7997', custom_label: 'Activity' };
    const stops = approvalBlockers(slot, []);
    assert.ok(!stops.some((b: string) => HOURS_BLOCKER.test(b)));
});
