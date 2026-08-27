// What a provider shows of themselves, and what stands in when they show
// nothing.
//
// A clean kitchen tells an owner nothing — they are hiring a contractor and
// want to see a business. A guest buying a cake wants to see the cake. So the
// host trades take a logo and the guest trades take work photos.
//
// Kept per trade rather than per audience even though the default comes from
// the audience: gardening is the one host trade where before-and-after shots
// would genuinely sell, and when that day comes it should be one entry rather
// than a reshape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    imageryFor,
    initialsFor,
    HOST_TRADES,
    GUEST_TRADES,
    REVIEWABLE_FIELDS,
    reviewDigest,
    hasUnreviewedChanges,
    changedFields,
} = require('@/lib/serviceProviders');

test('host trades ask for a logo', () => {
    for (const trade of HOST_TRADES) {
        assert.equal(imageryFor(trade), 'logo', trade + ' is hiring-a-contractor, not showing off a cake');
    }
});

test('guest trades ask for work photos', () => {
    for (const trade of GUEST_TRADES) {
        assert.equal(imageryFor(trade), 'photos', trade + ' sells on what the work looks like');
    }
});

test('cleaning asks for a logo rather than photos of a kitchen', () => {
    assert.equal(imageryFor('sponge'), 'logo');
});

test('an unknown trade still gets an answer', () => {
    assert.equal(imageryFor('nonsense'), 'logo', 'stable rather than undefined');
});

// --- the stand-in ----------------------------------------------------------

test('initials come off the business name', () => {
    assert.equal(initialsFor('Solway Sparkle'), 'SS');
    assert.equal(initialsFor('Galloway Cleaning Company'), 'GC', 'two letters, not three');
});

test('a one-word business gets one letter', () => {
    assert.equal(initialsFor('Sparkle'), 'S');
});

test('punctuation and spacing do not produce a blank badge', () => {
    assert.equal(initialsFor('  solway   sparkle  '), 'SS');
    assert.equal(initialsFor('Solway-Sparkle'), 'SS');
    assert.equal(initialsFor("O'Brien Cleaning"), 'OB', 'the apostrophe is a separator, not a letter');
    // Digits are not special-cased: the first two words are the first two
    // words. "27" is odd to read but it is stable and derived from the name,
    // which is what a stand-in badge needs to be.
    assert.equal(initialsFor('24/7 Cleaning'), '27');
});

test('no name is an empty badge rather than a crash', () => {
    assert.equal(initialsFor(''), '');
    assert.equal(initialsFor(null), '');
    assert.equal(initialsFor(undefined), '');
    assert.equal(initialsFor('   '), '');
});

// --- a logo is shop window --------------------------------------------------

test('changing the logo is re-checked, like the photos', () => {
    assert.equal(REVIEWABLE_FIELDS.indexOf('logo') !== -1, true);

    const live: any = {
        status: 'approved',
        business_name: 'Solway Sparkle', trade: 'sponge',
        description: 'Changeover cleans across the Stewartry.',
        audience: 'host', photos: [], logo: 'providers/logo-a.jpg',
    };
    live.approved_digest = reviewDigest(live);

    assert.equal(hasUnreviewedChanges(live), false);
    assert.equal(hasUnreviewedChanges({ ...live, logo: 'providers/logo-b.jpg' }), true);
    assert.deepEqual(changedFields({ ...live, logo: 'providers/logo-b.jpg' }), ['logo']);
});

// --- and the thing that adding it exposed ----------------------------------

test('adding a reviewable field does not put every live provider in the queue', () => {
    // A provider approved before `logo` existed: their stored digest cannot
    // carry a field that was not in REVIEWABLE_FIELDS at the time.
    const approvedBefore = {
        status: 'approved',
        business_name: 'Solway Sparkle', trade: 'sponge',
        description: 'Changeover cleans across the Stewartry.',
        audience: 'host', photos: [], logo: null,
        approved_digest:
            'business_name=Solway Sparkle|trade=sponge|'
            + 'description=Changeover cleans across the Stewartry.|audience=host|photos=',
    };

    assert.equal(hasUnreviewedChanges(approvedBefore), false,
        'comparing whole digests would have queued everybody the moment a field was added');
    assert.deepEqual(changedFields(approvedBefore), []);

    // But a real edit to a field the digest does carry is still caught.
    assert.equal(hasUnreviewedChanges({ ...approvedBefore, description: 'Something else.' }), true);
});
