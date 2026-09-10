// The shared review-content normaliser feeds the admin review row and the
// unclaimed application payload from one place. The load-bearing bit is the
// price read: an unbookable listing (no item priced above zero) must be
// distinguishable so the row can flag it, and "from £X" must be the cheapest
// priced item — never counting a zero/blank price.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { reviewContentFrom } = require('@/lib/serviceProviders');

const guestSource = (over: any = {}) => ({
    audience: 'guest',
    guest_details: {
        professional_title: 'Home baker',
        what_to_expect: 'Order two days ahead.',
        qualifications: 'Level 3 Food Hygiene',
        dietary_options: ['vegetarian', 'gluten_free', 'made_up_key'],
    },
    dietary_note: 'GF with notice.',
    declarations: { terms_version: 'draft-2026-09-07', terms_agreed_at: '2026-09-10T10:00:00.000Z' },
    items: [
        { name: 'Victoria sponge', price: 25, unit: 'item' },
        { name: 'Grazing table', price: 120, unit: 'item' },
    ],
    ...over,
});

test('a priced guest listing reports its items, count and cheapest price', () => {
    const c = reviewContentFrom(guestSource());
    assert.equal(c.isGuest, true);
    assert.equal(c.items.length, 2);
    assert.equal(c.pricedCount, 2);
    assert.equal(c.priceFrom, 25);          // the cheapest, not the first
    assert.ok(c.items.every((i: any) => i.priced));
});

test('no priced item is the unbookable signal — pricedCount 0, priceFrom null', () => {
    assert.deepEqual(
        (() => { const c = reviewContentFrom(guestSource({ items: [] })); return [c.pricedCount, c.priceFrom]; })(),
        [0, null],
    );
    // An item with a blank or zero price does not count, and is flagged per item.
    const c = reviewContentFrom(guestSource({ items: [{ name: 'Unpriced', price: '' }, { name: 'Zero', price: 0 }] }));
    assert.equal(c.pricedCount, 0);
    assert.equal(c.priceFrom, null);
    assert.equal(c.items[0].priced, false);
    assert.equal(c.items[1].priced, false);
});

test('mixed prices: only priced items count, and from = the cheapest priced', () => {
    const c = reviewContentFrom(guestSource({
        items: [{ name: 'A', price: '' }, { name: 'B', price: 40 }, { name: 'C', price: 15 }],
    }));
    assert.equal(c.pricedCount, 2);
    assert.equal(c.priceFrom, 15);
});

test('the written answers and terms come through; unknown dietary keys are dropped', () => {
    const c = reviewContentFrom(guestSource());
    assert.equal(c.title, 'Home baker');
    assert.equal(c.whatHappens, 'Order two days ahead.');
    assert.equal(c.qualifications, 'Level 3 Food Hygiene');
    assert.deepEqual(c.dietary, ['Vegetarian', 'Gluten-free']);   // labels, made_up_key dropped
    assert.equal(c.dietaryNote, 'GF with notice.');
    assert.equal(c.termsVersion, 'draft-2026-09-07');
    assert.equal(c.termsAgreedAt, '2026-09-10T10:00:00.000Z');
});

test('a host/trade source is not a guest listing, so the block stays empty', () => {
    const c = reviewContentFrom({ audience: 'both', items: [{ name: 'x', price: 10 }] });
    assert.equal(c.isGuest, false);
});

test('the same shape works from an application payload (provider + items)', () => {
    // What the admin page passes for an unclaimed row: payload.provider fields
    // plus payload.items — the identical normaliser call.
    const payload = {
        provider: {
            audience: 'guest',
            guest_details: { professional_title: 'Guide' },
            declarations: {},
        },
        items: [{ name: 'Walk', price: 30 }],
    };
    const c = reviewContentFrom({
        audience: payload.provider.audience,
        guest_details: payload.provider.guest_details,
        declarations: payload.provider.declarations,
        items: payload.items,
    });
    assert.equal(c.isGuest, true);
    assert.equal(c.title, 'Guide');
    assert.equal(c.pricedCount, 1);
    assert.equal(c.termsVersion, '');    // not agreed → the row shows "not yet agreed"
});
