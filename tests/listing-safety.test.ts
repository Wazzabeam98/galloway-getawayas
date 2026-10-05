// Pets in House rules, checkout instructions and Guest safety: the rules the
// editor, the save route, the listing page, the booking card and checkout share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    petLimit, petsProblem, withPetsAmenity, clampMaxPets, cleanCheckoutTasks, cleanCheckoutNote,
    checkoutTaskLabels, hasCheckoutInstructions, cleanGuestSafety, guestSafetyProblem,
    withAlarmAmenities, safetyAnswer, tickedSafety, SAFETY_GROUPS,
} from '../lib/listingSafety';

test('no pets allowed means a limit of 0, and checkout refuses any pet', () => {
    assert.equal(petLimit({ amenities: ['Wifi'], max_pets: 3 }), 0);
    assert.match(petsProblem(1, 0) || '', /doesn’t allow pets/);
    assert.equal(petsProblem(0, 0), null);
});

test('pets allowed: up to the host maximum, never above 5', () => {
    assert.equal(petLimit({ amenities: ['Pets allowed'], max_pets: 2 }), 2);
    assert.equal(petLimit({ amenities: ['Pets allowed'], max_pets: 9 }), 5);
    assert.equal(petLimit({ amenities: ['Pets allowed'], max_pets: null }), 1, 'no maximum stored yet = the default the editor shows');
    assert.equal(petsProblem(2, 2), null);
    assert.match(petsProblem(3, 2) || '', /up to 2 pets/);
    assert.equal(clampMaxPets(0), 1);
});

test('the house rule switches the "Pets allowed" amenity everything public reads', () => {
    assert.deepEqual(withPetsAmenity(['Wifi'], true), ['Wifi', 'Pets allowed']);
    assert.deepEqual(withPetsAmenity(['Wifi', 'Pets allowed'], false), ['Wifi']);
    assert.deepEqual(withPetsAmenity(['Pets allowed', 'Wifi'], true), ['Wifi', 'Pets allowed']);
});

test('checkout instructions: only known tasks, in order; empty means nothing shown', () => {
    assert.deepEqual(cleanCheckoutTasks(['lock_up', 'towels', 'junk']), ['towels', 'lock_up']);
    assert.deepEqual(checkoutTaskLabels(['towels', 'return_keys']), ['Gather used towels', 'Return keys']);
    assert.equal(cleanCheckoutNote('   '), null);
    assert.equal(cleanCheckoutNote('x'.repeat(600))?.length, 500);
    assert.equal(hasCheckoutInstructions([], null), false);
    assert.equal(hasCheckoutInstructions([], 'Leave keys on the table'), true);
});

test('guest safety: a ticked security camera must say where it is', () => {
    const s = cleanGuestSafety({ security_camera: { yes: true } });
    assert.match(guestSafetyProblem(s) || '', /exterior security camera/);
    assert.equal(guestSafetyProblem(cleanGuestSafety({ security_camera: { yes: true, details: 'Above the front door' } })), null);
    assert.deepEqual(cleanGuestSafety({ bogus: { yes: true }, stairs: { yes: 'yes' } }), {}, 'unknown items and non-booleans dropped');
});

test('shared spaces is ticked automatically for a private or shared room', () => {
    assert.deepEqual(cleanGuestSafety({}, 'A private room').shared_spaces, { yes: true });
    assert.deepEqual(cleanGuestSafety({ shared_spaces: { yes: false } }, 'A shared room').shared_spaces, { yes: true });
    assert.equal(cleanGuestSafety({}, 'Entire place').shared_spaces, undefined);
});

test('the alarms stay amenities — each listing keeps its current answer', () => {
    const smoke = SAFETY_GROUPS[1].items.find((i) => i.key === 'smoke_alarm')!;
    assert.deepEqual(safetyAnswer(smoke, {}, ['Smoke alarm']), { yes: true }, 'an existing amenity reads as ✓');
    assert.equal(safetyAnswer(smoke, {}, []), null, 'none reads as unanswered');
    assert.deepEqual(withAlarmAmenities(['Wifi', 'Smoke alarm'], { smoke_alarm: { yes: false }, co_alarm: { yes: true } }), ['Wifi', 'Carbon monoxide alarm']);
    assert.deepEqual(withAlarmAmenities(['Smoke alarm'], {}), ['Smoke alarm'], 'unanswered leaves the amenity alone');
});

test('the listing shows ticked items with details, not the ✗s', () => {
    const shown = tickedSafety({ nearby_water: { yes: true, details: 'River at the bottom of the garden' }, stairs: { yes: false } }, []);
    assert.deepEqual(shown, [{ key: 'nearby_water', label: 'Nearby water, like a lake or river', details: 'River at the bottom of the garden' }]);
});
