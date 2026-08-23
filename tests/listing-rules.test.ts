// What a listing needs before it can be on the site.
//
// These rules existed twice — once in the wizard, once, partially, in the edit
// screen — which is how a listing went live with no title. They are one module
// now, and this is what holds them to it.
//
// The half worth the most attention is grandfathering. A rule added today is
// applied to listings published before it existed, and getting that wrong does
// not look like a bug: it looks like three live cottages that will not save.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    publishProblems,
    problemAtStep,
    firstPublishProblem,
    newProblems,
    fromRow,
    MIN_AMENITIES,
    MAX_PRICE_PER_NIGHT,
} = require('../lib/listingRules');

// A listing with nothing wrong with it, to vary one field at a time from.
const GOOD = {
    propertyType: 'Cottage',
    street: '4 Harbour Row',
    city: 'Kirkcudbright',
    region: 'Dumfries and Galloway',
    postcode: 'DG6 4LE',
    photoCount: 3,
    title: 'Modern Cottage, with Hot Tub',
    description: 'A place to stay.',
    price: '120',
    amenities: ['Wifi', 'Parking', 'Kitchen'],
    checkInMethod: 'Lockbox',
};

const keys = (listing: any) => publishProblems(listing).map((r: any) => r.key);

test('a complete listing has nothing wrong with it', () => {
    assert.deepEqual(keys(GOOD), []);
});

// --- The two new rules ---------------------------------------------------

test('a listing with no way in cannot be published', () => {
    assert.ok(keys({ ...GOOD, checkInMethod: '' }).includes('check_in_method'));
    assert.ok(keys({ ...GOOD, checkInMethod: null }).includes('check_in_method'));
    // A space is not a choice.
    assert.ok(keys({ ...GOOD, checkInMethod: '   ' }).includes('check_in_method'));
});

test('fewer than ' + MIN_AMENITIES + ' amenities cannot be published', () => {
    assert.ok(keys({ ...GOOD, amenities: [] }).includes('amenities'));
    assert.ok(keys({ ...GOOD, amenities: ['Wifi', 'Parking'] }).includes('amenities'));
    assert.equal(keys({ ...GOOD, amenities: ['Wifi', 'Parking', 'Kitchen'] }).length, 0);
});

test('a missing amenities column is nothing selected, not a free pass', () => {
    assert.ok(keys({ ...GOOD, amenities: null }).includes('amenities'));
    assert.ok(keys({ ...GOOD, amenities: undefined }).includes('amenities'));
});

// --- The rules that already existed, now that they live somewhere else ----

test('the rules the wizard already had still hold', () => {
    assert.ok(keys({ ...GOOD, title: '   ' }).includes('title'));
    assert.ok(keys({ ...GOOD, description: '' }).includes('title'));
    assert.ok(keys({ ...GOOD, photoCount: 0 }).includes('photos'));
    assert.ok(keys({ ...GOOD, price: '0' }).includes('price'));
    assert.ok(keys({ ...GOOD, price: String(MAX_PRICE_PER_NIGHT + 1) }).includes('price_ceiling'));
    assert.ok(keys({ ...GOOD, postcode: 'Kirkcudbright' }).includes('postcode_format'));
    assert.ok(keys({ ...GOOD, propertyType: '' }).includes('property_type'));
});

// --- The weekend price -----------------------------------------------------
//
// Only the calendar's Pricing tab sets one. Every other surface leaves it out
// of the object entirely, so the rule has to stand down on absent rather than
// treat it as zero — otherwise the wizard could never publish.

test('a weekend price over the ceiling is caught like any other price', () => {
    assert.ok(
        keys({ ...GOOD, weekendPrice: MAX_PRICE_PER_NIGHT + 1 }).includes('weekend_price_ceiling')
    );
    assert.ok(
        keys({ ...GOOD, weekendPrice: String(MAX_PRICE_PER_NIGHT + 1) })
            .includes('weekend_price_ceiling')
    );
});

test('no weekend price is not a failing weekend price', () => {
    assert.equal(keys({ ...GOOD }).length, 0, 'absent');
    assert.equal(keys({ ...GOOD, weekendPrice: null }).length, 0, 'null');
    assert.equal(keys({ ...GOOD, weekendPrice: undefined }).length, 0, 'undefined');
    assert.equal(keys({ ...GOOD, weekendPrice: '' }).length, 0, 'cleared in the form');
    assert.equal(keys({ ...GOOD, weekendPrice: MAX_PRICE_PER_NIGHT }).length, 0, 'at the ceiling');
});

test('a weekend price is read off the row like the rest', () => {
    const row = {
        property_type: 'Cottage',
        street_address: '4 Harbour Row',
        location: 'Kirkcudbright, Dumfries and Galloway',
        postcode: 'DG6 4LE',
        images: ['a.jpg', 'b.jpg'],
        title: 'Harbour cottage',
        description: 'By the water.',
        price_per_night: 140,
        amenities: ['Wifi', 'Parking', 'Kitchen'],
        check_in_method: 'Key safe',
        weekend_price: MAX_PRICE_PER_NIGHT + 1,
    };
    assert.ok(keys(fromRow(row)).includes('weekend_price_ceiling'));
    assert.deepEqual(keys(fromRow({ ...row, weekend_price: null })), []);
});

test('the calendar cannot push a weekend price over the line', () => {
    // The exact shape /api/listings/save builds: the stored row, patched.
    const row = {
        property_type: 'Cottage',
        street_address: '4 Harbour Row',
        location: 'Kirkcudbright, Dumfries and Galloway',
        postcode: 'DG6 4LE',
        images: ['a.jpg'],
        title: 'Harbour cottage',
        description: 'By the water.',
        price_per_night: 140,
        amenities: ['Wifi', 'Parking', 'Kitchen'],
        check_in_method: 'Key safe',
        weekend_price: 190,
    };
    const introduced = (patch: any) =>
        newProblems(fromRow(row), fromRow({ ...row, ...patch })).map((r: any) => r.key);

    assert.deepEqual(introduced({ weekend_price: 220 }), [], 'a real weekend price still saves');
    assert.deepEqual(
        introduced({ weekend_price: MAX_PRICE_PER_NIGHT + 1 }),
        ['weekend_price_ceiling'],
        'the extra zero does not'
    );
    assert.deepEqual(
        introduced({ price_per_night: MAX_PRICE_PER_NIGHT + 1 }),
        ['price_ceiling'],
        'and neither does it on the base price'
    );
});

// A listing that was already over the line keeps saving — the same
// grandfathering every other rule gets, for the same reason.
test('a weekend price already over the ceiling does not lock the host out', () => {
    const row = {
        property_type: 'Cottage',
        street_address: '4 Harbour Row',
        location: 'Kirkcudbright, Dumfries and Galloway',
        postcode: 'DG6 4LE',
        images: ['a.jpg'],
        title: 'Harbour cottage',
        description: 'By the water.',
        price_per_night: 140,
        amenities: ['Wifi', 'Parking', 'Kitchen'],
        check_in_method: 'Key safe',
        weekend_price: 99999,
    };
    assert.deepEqual(
        newProblems(fromRow(row), fromRow({ ...row, cleaning_fee: 60 })).map((r: any) => r.key),
        [],
        'they can still fix everything else'
    );
});

test('a name or a street will do, but not the town alone', () => {
    assert.equal(keys({ ...GOOD, street: '', propertyName: 'Rose Cottage' }).length, 0);
    assert.ok(keys({ ...GOOD, street: '', propertyName: '', flat: '' }).includes('address'));
});

// --- Getting sent to the right page --------------------------------------

test('a failure names the step that fixes it', () => {
    assert.equal(firstPublishProblem({ ...GOOD, checkInMethod: '' }).step, 4);
    assert.equal(firstPublishProblem({ ...GOOD, amenities: [] }).step, 5);
    assert.equal(problemAtStep({ ...GOOD, amenities: [] }, 4), null, 'not step 4’s problem');
    assert.ok(problemAtStep({ ...GOOD, amenities: [] }, 5));
});

test('publishing reports the earliest step, so a host walks forwards', () => {
    const problem = firstPublishProblem({ ...GOOD, checkInMethod: '', amenities: [], title: '' });
    assert.equal(problem.step, 4, 'check-in comes before amenities and the title');
});

// --- Grandfathering: the part that could break three live cottages --------

test('a listing already below the line still saves', () => {
    // Published long before either rule existed.
    const legacy = { ...GOOD, checkInMethod: '', amenities: [] };

    // Its host changes the price and nothing else.
    const edited = { ...legacy, price: '135' };

    assert.deepEqual(
        newProblems(legacy, edited).map((r: any) => r.key),
        [],
        'refusing this would leave a live cottage unable to fix its own price'
    );
});

test('but it cannot be pushed further down', () => {
    const legacy = { ...GOOD, checkInMethod: '' };
    const worse = { ...legacy, amenities: ['Wifi'] };

    assert.deepEqual(newProblems(legacy, worse).map((r: any) => r.key), ['amenities']);
});

test('a compliant listing cannot be edited below the line', () => {
    assert.deepEqual(
        newProblems(GOOD, { ...GOOD, checkInMethod: '' }).map((r: any) => r.key),
        ['check_in_method']
    );
    assert.deepEqual(
        newProblems(GOOD, { ...GOOD, amenities: ['Wifi'] }).map((r: any) => r.key),
        ['amenities']
    );
});

test('fixing one thing while another stays broken is allowed', () => {
    // Both rules failing; the host fixes the check-in method and leaves the
    // amenities for another day. Refusing that would mean a listing had to be
    // brought all the way up to standard in one sitting or not at all.
    const legacy = { ...GOOD, checkInMethod: '', amenities: [] };
    const better = { ...legacy, checkInMethod: 'Lockbox' };

    assert.deepEqual(newProblems(legacy, better).map((r: any) => r.key), []);
});

// --- The database-row shape ----------------------------------------------

test('a row reads the same as form state', () => {
    const row = {
        property_type: 'Cottage',
        street_address: '4 Harbour Row',
        location: 'Kirkcudbright, Dumfries and Galloway',
        postcode: 'DG6 4LE',
        images: ['a.jpg', 'b.jpg'],
        title: 'Modern Cottage, with Hot Tub',
        description: 'A place to stay.',
        price_per_night: 120,
        amenities: ['Wifi', 'Parking', 'Kitchen'],
        check_in_method: 'Lockbox',
    };

    assert.deepEqual(keys(fromRow(row)), [], 'the same listing, read from its row');
});

test('a row missing the new columns fails the new rules and no others', () => {
    const row = {
        property_type: 'Cottage',
        street_address: '4 Harbour Row',
        location: 'Kirkcudbright, Dumfries and Galloway',
        postcode: 'DG6 4LE',
        images: ['a.jpg'],
        title: 'Seed cottage',
        description: 'A place to stay.',
        price_per_night: 120,
        amenities: [],
        check_in_method: null,
    };

    assert.deepEqual(keys(fromRow(row)).sort(), ['amenities', 'check_in_method']);
});

test('an empty row is not silently acceptable', () => {
    assert.ok(publishProblems(fromRow(null)).length > 0);
    assert.ok(publishProblems(fromRow({})).length > 0);
});
