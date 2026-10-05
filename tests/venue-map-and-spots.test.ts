// Two display rules on an experience listing.
//
// The venue map point (lib/venuePoint.ts): every provider with a place guests go
// to gets a "Where you'll be" map from their postcode — and a coverage region's
// 0,0 placeholder must never be taken for a place.
//
// "Spots left" (lib/spotsLeft.ts): shown only when a session is genuinely filling
// up, the way Airbnb does — never on an empty session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { hasVenue, roundedPoint, venueMapPoint } = require('@/lib/venuePoint');
const { isFillingUp, spotsLeftLabel } = require('@/lib/spotsLeft');

test('who has a venue: a set-times place, or a made-to-order collection point', () => {
    assert.equal(hasVenue('slot', 'collection'), true);
    assert.equal(hasVenue('slot', null), true, 'an unset slot fulfilment is come-to-me');
    assert.equal(hasVenue('slot', 'both'), true, 'a studio that also travels still has the studio');
    assert.equal(hasVenue('slot', 'delivery'), false, 'a slot host who travels has no place');
    assert.equal(hasVenue('made_to_order', 'collection'), true);
    assert.equal(hasVenue('made_to_order', 'both'), true);
    assert.equal(hasVenue('made_to_order', 'delivery'), false);
    assert.equal(hasVenue('comes_to_you', null), false, 'a chef at the cottage has no venue');
});

test('the stored point is rounded to the public-pin precision (~110m)', () => {
    assert.deepEqual(roundedPoint({ latitude: 54.884321, longitude: -4.181789 }), { venue_lat: 54.884, venue_lng: -4.182 });
});

test('the map uses the venue point first, and never a 0,0 region row', () => {
    assert.deepEqual(venueMapPoint({ venue_lat: 54.884, venue_lng: -4.182 }, [{ centre_lat: 55, centre_lng: -4 }]), { lat: 54.884, lng: -4.182 });
    // No venue point: a real seed coordinate still works.
    assert.deepEqual(venueMapPoint({}, [{ centre_lat: 0, centre_lng: 0 }, { centre_lat: 54.8, centre_lng: -4.05 }]), { lat: 54.8, lng: -4.05 });
    // Only coverage regions (written at 0,0): no map, not a pin in the Atlantic.
    assert.equal(venueMapPoint({ venue_lat: null, venue_lng: null }, [{ centre_lat: 0, centre_lng: 0 }]), null);
    assert.equal(venueMapPoint(null, null), null);
});

test('an empty or roomy session is not filling up', () => {
    assert.equal(isFillingUp(8, 0), false, 'nobody booked — no scarcity line');
    assert.equal(isFillingUp(8, 2), false, '6 of 8 left is plenty');
    assert.equal(isFillingUp(8, 8), false, 'full is "Full", not "0 spots left"');
});

test('a session with bookings and few places left is filling up', () => {
    assert.equal(isFillingUp(8, 5), true, '3 of 8 left');
    assert.equal(isFillingUp(8, 7), true, '1 left');
    assert.equal(isFillingUp(4, 2), true, '2 of 4 left');
    assert.equal(isFillingUp(4, 1), false, '3 of 4 left is most of it');
    assert.equal(isFillingUp(2, 1), true, 'the last place of two');
    assert.equal(isFillingUp(20, 16), false, 'the cap is 3 left, not half');
    assert.equal(isFillingUp(20, 17), true);
});

test('the label', () => {
    assert.equal(spotsLeftLabel(1), '1 spot left');
    assert.equal(spotsLeftLabel(3), '3 spots left');
});
