// The pool on a holiday let: Pool is ticked like Hot tub and Sauna (chip,
// filter, badge), and once it is, the host says private or shared and indoor or
// outdoor. The save route and both forms clean the answers with one helper, so
// what is asserted here is what is stored and what a guest reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cleanPoolDetails, poolLabel, hasPool } = require('../lib/poolDetails');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QUICK_CHIPS, FILTER_AMENITIES, ALWAYS_AMENITIES, matchesFilters, EMPTY_FILTERS } = require('../lib/listingFilters');

test('the guest reads one line, Airbnb style', () => {
    assert.equal(poolLabel('private', 'outdoor'), 'Private outdoor pool');
    assert.equal(poolLabel('shared', 'indoor'), 'Shared indoor pool');
    assert.equal(poolLabel('private', null), 'Private pool');
    assert.equal(poolLabel(null, 'indoor'), 'Indoor pool');
    assert.equal(poolLabel(null, null), 'Pool', 'nothing said yet: just Pool');
});

test('only the four real answers are stored; anything else is not said', () => {
    assert.deepEqual(cleanPoolDetails(['Pool'], 'shared', 'outdoor'), { pool_access: 'shared', pool_setting: 'outdoor' });
    assert.deepEqual(cleanPoolDetails(['Pool'], 'PRIVATE', 'heated'), { pool_access: null, pool_setting: null });
    assert.deepEqual(cleanPoolDetails(['Pool'], 1, true), { pool_access: null, pool_setting: null });
});

test('unticking Pool clears both answers', () => {
    assert.deepEqual(cleanPoolDetails(['Wifi'], 'private', 'indoor'), { pool_access: null, pool_setting: null });
    assert.deepEqual(cleanPoolDetails(null, 'private', 'indoor'), { pool_access: null, pool_setting: null });
    assert.equal(hasPool(['Pool']), true);
    assert.equal(hasPool(['Swimming pool']), false);
});

test('Pool is a chip, a filter and always offered, exactly like Hot tub and Sauna', () => {
    for (const a of ['Hot tub', 'Sauna', 'Pool']) {
        assert.ok(QUICK_CHIPS.some((c: any) => c.amenity === a), a + ' has a quick chip');
        assert.ok(FILTER_AMENITIES.indexOf(a) !== -1, a + ' is in the Filters panel');
        assert.ok(ALWAYS_AMENITIES.indexOf(a) !== -1, a + ' is offered even with none in view');
    }
});

test('the Pool filter keeps only listings with Pool ticked', () => {
    const f = { ...EMPTY_FILTERS, amenities: ['Pool'] };
    const base = { property_type: 'Cottages', price_per_night: 100, bedrooms: 1, beds: 1, bathrooms: 1, instant_book: false, self_check_in: false };
    assert.equal(matchesFilters({ ...base, amenities: ['Pool', 'Wifi'] }, f), true);
    assert.equal(matchesFilters({ ...base, amenities: ['Hot tub'] }, f), false);
    assert.equal(matchesFilters({ ...base, amenities: null }, f), false);
});
