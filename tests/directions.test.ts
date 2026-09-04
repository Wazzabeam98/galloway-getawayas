// Get directions must never point at the town centre.
//
// The bug this pins: the home card and the trips card built a directions link
// from `[street_address, postcode, location]` joined, which is only the TOWN when
// the street parts are missing — so a cottage with no pin and no street address
// got a button that confidently drove the guest to Kirkcudbright town centre, the
// exact wrong-place failure the arrival screen exists to prevent. directionsUrl
// now returns null in that case: no destination, no button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionsUrl, appleDirectionsUrl, hasRealCoords } from '../lib/directions';

test('coordinates win — the link points at the pin', () => {
    const url = directionsUrl({ latitude: 54.8356, longitude: -4.0533, location: 'Kirkcudbright' });
    assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=54.8356,-4.0533');
});

test('a street address is geocodable — the link uses the full address', () => {
    const url = directionsUrl({ streetAddress: '2 Harbour Square', postcode: 'DG6 4HY', location: 'Kirkcudbright' });
    assert.ok(url && url.includes(encodeURIComponent('2 Harbour Square, DG6 4HY, Kirkcudbright')));
});

test('the TOWN alone is not a destination — no link', () => {
    // No pin, no street address — only the town. This is the failure case: the
    // old code returned a maps link to the town centre; this returns null.
    assert.equal(directionsUrl({ location: 'Kirkcudbright, Dumfries and Galloway' }), null);
});

test('postcode without a street is still not a door — no link', () => {
    // A postcode covers a whole area; without a street address it is not the
    // door. Coordinates are how a postcode becomes a real pin.
    assert.equal(directionsUrl({ postcode: 'DG6 4HY', location: 'Kirkcudbright' }), null);
});

test('nothing at all — no link', () => {
    assert.equal(directionsUrl({}), null);
});

// Apple Maps carries the same rule — a pin or a street, never the town — so the
// picker's Apple option can never send a guest to the town centre either.
test('Apple: coordinates win — daddr points at the pin', () => {
    assert.equal(
        appleDirectionsUrl({ latitude: 54.8356, longitude: -4.0533, location: 'Kirkcudbright' }),
        'https://maps.apple.com/?daddr=54.8356,-4.0533',
    );
});

test('Apple: a street address is geocodable — daddr uses the full address', () => {
    const url = appleDirectionsUrl({ streetAddress: '2 Harbour Square', postcode: 'DG6 4HY', location: 'Kirkcudbright' });
    assert.ok(url && url.startsWith('https://maps.apple.com/?daddr='));
    assert.ok(url && url.includes(encodeURIComponent('2 Harbour Square, DG6 4HY, Kirkcudbright')));
});

test('Apple: the TOWN alone is not a destination — no link', () => {
    assert.equal(appleDirectionsUrl({ location: 'Kirkcudbright, Dumfries and Galloway' }), null);
    assert.equal(appleDirectionsUrl({ postcode: 'DG6 4HY', location: 'Kirkcudbright' }), null);
    assert.equal(appleDirectionsUrl({}), null);
});

test('null-island (0,0) is treated as no pin, not a destination', () => {
    // A failed geocode leaves 0,0. It must not be offered as a destination, and
    // with no street address there is no link at all.
    assert.equal(hasRealCoords(0, 0), false);
    assert.equal(directionsUrl({ latitude: 0, longitude: 0, location: 'Kirkcudbright' }), null);
    // ...but with a street address, it falls through to that.
    const url = directionsUrl({ latitude: 0, longitude: 0, streetAddress: '2 Harbour Square' });
    assert.ok(url && url.includes(encodeURIComponent('2 Harbour Square')));
});
