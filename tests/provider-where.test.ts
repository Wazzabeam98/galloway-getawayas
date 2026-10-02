// The "Where" line on a provider's own reservation card must be worded from the
// provider's side, never the guest's. In particular a booking held at the
// provider's own place shows their venue/listing name with the address beneath,
// not "At the provider's place" (which only makes sense to a guest). Decision of
// 28 September 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { whereForOrder, providerVenueAddress, whereForTradeJob } = require('@/lib/providerReservations');

const provider = {
    business_name: 'Solway Sauna',
    fulfilment: null,
    collection_street: '4 Shore Road',
    collection_town: 'Kirkcudbright',
    collection_postcode: 'DG6 4JT',
};

test('a slot at the provider’s own place shows the venue name and address, not "the provider’s place"', () => {
    const where = whereForOrder({ shape: 'slot', fulfilment: 'collection', service_address: null }, provider);
    assert.deepEqual(where, { line: 'Solway Sauna', sub: '4 Shore Road, Kirkcudbright, DG6 4JT' });
    assert.equal(JSON.stringify(where).includes('provider'), false);
});

test('the venue address is omitted when we hold none of it, leaving just the name', () => {
    const bare = { business_name: 'Solway Sauna', fulfilment: null };
    assert.deepEqual(whereForOrder({ shape: 'slot', fulfilment: 'collection' }, bare), { line: 'Solway Sauna', sub: null });
});

test('with no business name, the venue falls back to a neutral own-place line', () => {
    const noName = { fulfilment: null, collection_town: 'Wigtown' };
    assert.deepEqual(whereForOrder({ shape: 'slot', fulfilment: 'collection' }, noName), { line: 'Your place', sub: 'Wigtown' });
});

test('a travelling slot keeps showing the guest’s address to the provider', () => {
    assert.equal(
        whereForOrder({ shape: 'slot', fulfilment: 'delivery', service_address: '2 Bridge St, Moffat' }, provider),
        'You travel to 2 Bridge St, Moffat',
    );
    assert.equal(
        whereForOrder({ shape: 'slot', fulfilment: 'delivery', service_address: null }, provider),
        'You travel to the guest',
    );
});

test('a come-to-you booking is worded from the provider’s side', () => {
    assert.equal(
        whereForOrder({ shape: 'comes_to_you', service_address: '2 Bridge St, Moffat' }, provider),
        'You go to 2 Bridge St, Moffat',
    );
    assert.equal(whereForOrder({ shape: 'comes_to_you', service_address: null }, provider), 'You go to the guest');
});

test('a made-to-order booking reads as delivery or collection, never as the guest', () => {
    assert.equal(whereForOrder({ shape: 'made_to_order', fulfilment: 'delivery', service_address: 'The Cottage' }, { ...provider, fulfilment: 'delivery' }), 'Deliver to The Cottage');
    assert.equal(whereForOrder({ shape: 'made_to_order', fulfilment: 'collection' }, { ...provider, fulfilment: 'collection' }), 'For collection');
});

test('the venue-address helper joins the three fields and drops blanks', () => {
    assert.equal(providerVenueAddress(provider), '4 Shore Road, Kirkcudbright, DG6 4JT');
    assert.equal(providerVenueAddress({ collection_town: 'Wigtown' }), 'Wigtown');
    assert.equal(providerVenueAddress({}), null);
});

// Round six (30 Sep 2026): a trade needs to know where a job is BEFORE deciding
// whether to take it, so the full street address is on the enquiry from the
// start — there is no accepted-only wall. The property name is the line, the full
// address the sub, whatever the enquiry's status.
const jobListing = { title: 'Millburn Cottage', location: 'Kirkcudbright, DG6 4XT', street_address: '3 Mill Road', postcode: 'DG6 4XT' };

test('a trade job shows the full street address, not just the town', () => {
    assert.deepEqual(whereForTradeJob(jobListing), { line: 'Millburn Cottage', sub: '3 Mill Road, Kirkcudbright, DG6 4XT' });
});

test('a trade job with only a town falls back to the town under the name', () => {
    assert.deepEqual(
        whereForTradeJob({ title: 'The Bothy', location: 'Gatehouse of Fleet' }),
        { line: 'The Bothy', sub: 'Gatehouse of Fleet' },
    );
});

test('a trade job with no listing reads as the property', () => {
    assert.equal(whereForTradeJob(null), 'the property');
});

test('a trade job with no listing shows the area the owner named, not the placeholder', () => {
    assert.equal(
        whereForTradeJob(null, 'Kirkcudbright, Dumfries and Galloway'),
        'Kirkcudbright, Dumfries and Galloway',
    );
    // A blank area still falls back to the placeholder rather than an empty line.
    assert.equal(whereForTradeJob(null, '   '), 'the property');
});
