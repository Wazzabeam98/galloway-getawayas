// composeAddressLine turns the four delivery-address boxes into the one line the
// order route sends and the provider reads. The house/flat folds into the street
// the same way add-a-property assembles a private address, and empty boxes drop
// out — so a rural "house name + postcode" address reads cleanly, and a repeated
// house-in-street doesn't double up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAddressLine } from '../lib/address';

test('composes house, street, town and postcode in order', () => {
    assert.equal(
        composeAddressLine({ house: 'Rose Cottage', street: '18 Dovecroft', town: 'Kirkcudbright', postcode: 'DG6 4JA' }),
        'Rose Cottage, 18 Dovecroft, Kirkcudbright, DG6 4JA',
    );
});

test('drops empty boxes — a house name and a postcode alone still reads', () => {
    assert.equal(
        composeAddressLine({ house: 'Hillfoot', street: '', town: '', postcode: 'DG7 1AB' }),
        'Hillfoot, DG7 1AB',
    );
});

test('does not repeat a house name typed into the street too', () => {
    assert.equal(
        composeAddressLine({ house: 'Rose Cottage', street: 'Rose Cottage', town: 'Gatehouse', postcode: 'DG7 2HP' }),
        'Rose Cottage, Gatehouse, DG7 2HP',
    );
});

test('an empty address composes to an empty string', () => {
    assert.equal(composeAddressLine({ house: '', street: '', town: '', postcode: '' }), '');
});
