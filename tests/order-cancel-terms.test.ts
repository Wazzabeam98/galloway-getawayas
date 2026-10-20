// An experience order keeps the cancellation terms it was booked under.
//
// The intent: once a guest has paid, the provider changing their policy must not
// change what that guest is refunded — in either direction. The order's stamp
// (service_orders.cancellation_window_hours + no_refund) governs; the provider's
// live terms only stamp NEW orders, or stand in for an order written before the
// stamp existed.
//
// PROVE IT FAILS FIRST: make orderCancelTerms read the provider before the order
// and the "provider changed policy" cases go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    orderCancelTerms, termsToStamp, termsMetadata, termsFromMetadata, inheritedStamp,
} from '../lib/orderCancelTerms';
import { guestMayCancelFree } from '../lib/serviceSlots';

const flexible = { cancellation_window_hours: 24, guest_details: {} };
const noRefund = { cancellation_window_hours: 0, guest_details: { no_refund: true } };
const firm = { cancellation_window_hours: 168, guest_details: {} };

test('an order booked on Flexible stays Flexible after the provider moves to No refund', () => {
    const order = termsToStamp(flexible);
    const terms = orderCancelTerms(order, noRefund);
    assert.equal(terms.noRefund, false);
    assert.equal(terms.windowHours, 24);
});

test('an order booked on No refund stays non-refundable after the provider moves to Flexible', () => {
    const order = termsToStamp(noRefund);
    assert.equal(order.no_refund, true);
    assert.equal(orderCancelTerms(order, flexible).noRefund, true);
});

test('a window change after booking does not move the free-cancel cutoff', () => {
    // A slot 3 days out, booked on Flexible (24h). The provider then goes Firm (7 days).
    const order = termsToStamp(flexible);
    const now = new Date('2026-11-01T10:00:00Z');
    const { windowHours } = orderCancelTerms(order, firm);
    assert.equal(guestMayCancelFree('slot', '2026-11-04', '10:00', windowHours, now), true);
    // Read live, the same cancel would have been refused.
    assert.equal(guestMayCancelFree('slot', '2026-11-04', '10:00', 168, now), false);
});

test('an order written before the stamp falls back to the provider’s live terms', () => {
    assert.deepEqual(orderCancelTerms({ cancellation_window_hours: null, no_refund: false }, noRefund), { windowHours: 48, noRefund: true });
    assert.deepEqual(orderCancelTerms(null, firm), { windowHours: 168, noRefund: false });
});

test('the stamp survives the Stripe metadata round trip a request order takes', () => {
    assert.deepEqual(termsFromMetadata(termsMetadata(noRefund)), { cancellation_window_hours: 0, no_refund: true });
    assert.deepEqual(termsFromMetadata(termsMetadata(firm)), { cancellation_window_hours: 168, no_refund: false });
    // A session made before the stamp carries no keys → no stamp, so the webhook
    // uses the provider's terms then.
    assert.equal(termsFromMetadata({ kind: 'service_order' }), null);
});

test('added places carry the parent booking’s terms, not the provider’s new ones', () => {
    const parent = termsToStamp(flexible);
    assert.deepEqual(inheritedStamp(parent, noRefund), { cancellation_window_hours: 24, no_refund: false });
});
