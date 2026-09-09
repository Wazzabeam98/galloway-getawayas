// The guest listing title. A guest experience is a person, not a business, so
// the title is the person's name — unless they trade under a name, which wins.
// business_name is derived from this at write time, so getting it right here is
// the whole of the title everywhere it's read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { resolveTitle } = require('@/lib/utils');

test('a trading name wins when set', () => {
    assert.equal(
        resolveTitle({ full_name: 'Rosa Muir', trading_name: 'Solway Suppers', show_full_name: true }, ''),
        'Solway Suppers',
    );
});

test('without a trading name, the person\'s name stands', () => {
    assert.equal(
        resolveTitle({ full_name: 'Rosa Muir', trading_name: null, show_full_name: true }, ''),
        'Rosa Muir',
    );
});

test('a preferred name is used ahead of the legal name (via displayName)', () => {
    assert.equal(
        resolveTitle({ full_name: 'Rosa Muir', preferred_name: 'Rosie', trading_name: '', show_full_name: true }, ''),
        'Rosie',
    );
});

test('a hidden legal name with no preferred name and no trading name yields the fallback, never the legal name', () => {
    assert.equal(
        resolveTitle({ full_name: 'Rosa Muir', trading_name: null, show_full_name: false }, 'Provider'),
        'Provider',
    );
});

test('a blank trading name does not win over the name', () => {
    assert.equal(
        resolveTitle({ full_name: 'Rosa Muir', trading_name: '   ', show_full_name: true }, ''),
        'Rosa Muir',
    );
});
