// The listing editor's guest-safety disclosures and checkout instructions, and
// the short-term let licence line. What these hold to:
//
//   - a guest is told WHERE the cameras are, not just that there are some —
//     the editor and /api/listings/save refuse a camera with no note, through
//     the one helper (itemProblems), so the browser cannot be argued past;
//   - whatever a request body says, only known items are stored, each once;
//   - the licence number the law wants on the advert is what the page prints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SAFETY_DISCLOSURES, CHECKOUT_INSTRUCTIONS, cleanItems, itemProblems, NOTE_MAX,
} from '../lib/listingDisclosures';
import { publicLicenceLine, licenceWarning } from '../lib/stlLicence';

test('a security camera with no note cannot be saved', () => {
    const items = cleanItems([{ key: 'security_cameras', note: '   ' }], SAFETY_DISCLOSURES);
    assert.equal(itemProblems(items, SAFETY_DISCLOSURES).length, 1);
    const ok = cleanItems([{ key: 'security_cameras', note: 'Doorbell camera covering the front path' }], SAFETY_DISCLOSURES);
    assert.deepEqual(itemProblems(ok, SAFETY_DISCLOSURES), []);
});

test('other disclosures need no note', () => {
    const items = cleanItems([{ key: 'nearby_water' }, { key: 'heights', note: '' }], SAFETY_DISCLOSURES);
    assert.deepEqual(itemProblems(items, SAFETY_DISCLOSURES), []);
});

test('"Additional requests" at checkout needs saying what they are', () => {
    const items = cleanItems([{ key: 'other', note: '' }], CHECKOUT_INSTRUCTIONS);
    assert.equal(itemProblems(items, CHECKOUT_INSTRUCTIONS).length, 1);
});

test('unknown keys, duplicates and junk are dropped; notes are trimmed and capped', () => {
    const items = cleanItems(
        [
            { key: 'heights', note: '  steep stair  ' },
            { key: 'heights', note: 'again' },
            { key: 'free_beer', note: 'yes' },
            'nonsense',
            null,
            { key: 'nearby_water', note: 'x'.repeat(NOTE_MAX + 50) },
        ],
        SAFETY_DISCLOSURES
    );
    assert.deepEqual(items.map((i) => i.key), ['nearby_water', 'heights']);
    assert.equal(items[1].note, 'steep stair');
    assert.equal(items[0].note.length, NOTE_MAX);
    assert.deepEqual(cleanItems('not a list', SAFETY_DISCLOSURES), []);
});

test('the listing page prints the licence number, or says exempt, or nothing', () => {
    assert.equal(publicLicenceLine('licensed', ' ABC12345 '), 'Licence number: ABC12345');
    assert.equal(publicLicenceLine('exempt', ''), 'Exempt from short-term let licensing');
    assert.equal(publicLicenceLine('none', null), null);
    assert.equal(publicLicenceLine('applied', ''), null);
});

test('the licence warning nags until a number is there', () => {
    assert.ok(licenceWarning({ stl_licence_status: 'none', stl_licence_number: null, stl_licence_expiry: null }));
    assert.ok(licenceWarning({ stl_licence_status: 'licensed', stl_licence_number: '', stl_licence_expiry: null }));
    assert.equal(licenceWarning({ stl_licence_status: 'licensed', stl_licence_number: 'ABC12345', stl_licence_expiry: null }), null);
});
