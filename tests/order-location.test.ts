// The order page derives WHERE for a SLOT from the order's own frozen fulfilment,
// never the provider's live setup — the same freeze rule as price and slot
// duration. What a guest booked (come-to-me vs the provider travelling) must not
// change when the provider edits their setup afterwards. A made-to-order product
// still reads the provider's live value (its freeze is a follow-up), passed in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { orderLocation, locationFromDirection } = require('@/lib/orderLocation');

// --- the direction reads off the order for a slot ----------------------------

test('a come-to-me slot: guest collects, does not go to the cottage', () => {
    const v = orderLocation({ shape: 'slot', fulfilment: 'collection' });
    assert.equal(v.comesToCottage, false);
    assert.equal(v.collects, true);
    assert.equal(v.slotTravels, false);
});

test('a travelling slot: provider comes to the cottage, no collection block', () => {
    const v = orderLocation({ shape: 'slot', fulfilment: 'delivery' });
    assert.equal(v.comesToCottage, true);
    assert.equal(v.collects, false);
    assert.equal(v.slotTravels, true);
});

test('a comes-to-you order is at the cottage by its SHAPE, whatever the fulfilment', () => {
    assert.equal(orderLocation({ shape: 'comes_to_you', fulfilment: null }).comesToCottage, true);
    assert.equal(orderLocation({ shape: 'comes_to_you', fulfilment: 'collection' }).comesToCottage, true);
});

test('a null-fulfilment slot reads as come-to-me (null is not delivery)', () => {
    const v = orderLocation({ shape: 'slot', fulfilment: null });
    assert.equal(v.slotTravels, false);
    assert.equal(v.comesToCottage, false);
    // THE HALF THIS TEST USED TO LEAVE OUT, AND THE BUG THAT HID THERE.
    // "Reads as come-to-me" has to mean the guest is shown where to go. It did
    // not: collects was false for a null, so the order page withheld the
    // address while the listing had already promised it "once your booking is
    // paid". Asserting only comesToCottage let that pass for months.
    assert.equal(v.collects, true);
});

// --- THE LISTING AND THE ORDER PAGE MUST NOT DISAGREE ------------------------
// The listing page used to derive this itself, in its own expression. Both now
// call locationFromDirection, and this pins every combination so they cannot
// drift apart again.

test('listing and order page agree on every shape/direction combination', () => {
    for (const shape of ['slot', 'comes_to_you', 'made_to_order']) {
        for (const direction of [null, undefined, 'collection', 'delivery', 'both']) {
            const listing = locationFromDirection(shape, direction as any);
            // How the order page reaches the same rule: a slot from its own
            // frozen value, every other shape from the provider's live one.
            const order = shape === 'slot'
                ? orderLocation({ shape, fulfilment: direction as any })
                : orderLocation({ shape, fulfilment: null }, direction as any);
            assert.equal(order.comesToCottage, listing.comesToCottage,
                `comesToCottage differs for ${shape}/${direction}`);
            assert.equal(order.collects, listing.collects,
                `collects differs for ${shape}/${direction}`);
            // The binary itself: you travel unless they come to you.
            assert.equal(listing.collects, !listing.comesToCottage,
                `not a clean binary for ${shape}/${direction}`);
        }
    }
});

test('a guest who has paid is never told nothing: some direction is always true', () => {
    // The failure mode was a third, silent state — neither coming to you nor
    // collecting — which rendered as "they will arrange it with you" on a paid
    // booking that had a real address on file.
    for (const shape of ['slot', 'comes_to_you', 'made_to_order']) {
        for (const direction of [null, undefined, 'collection', 'delivery', 'both']) {
            const v = locationFromDirection(shape, direction as any);
            assert.ok(v.comesToCottage || v.collects,
                `neither direction was true for ${shape}/${direction}`);
        }
    }
});

// --- made-to-order still reads the provider's LIVE value (freeze is a follow-up)

test('made-to-order collects/delivers from the provider arg, not the order', () => {
    // The order carries no frozen direction for this shape yet; the provider's
    // live value drives it, exactly as before this change.
    assert.equal(orderLocation({ shape: 'made_to_order', fulfilment: null }, 'both').collects, true);
    assert.equal(orderLocation({ shape: 'made_to_order', fulfilment: null }, 'collection').collects, true);
    assert.equal(orderLocation({ shape: 'made_to_order', fulfilment: null }, 'delivery').collects, false);
    assert.equal(orderLocation({ shape: 'made_to_order', fulfilment: null }, 'both').comesToCottage, false);
});

// --- THE FREEZE: for a slot, the provider argument cannot change the outcome ---
// This is the guarantee the bug needed. The provider's live value is an argument,
// yet a slot ignores it entirely: a come-to-me slot stays come-to-me whatever the
// provider is switched to.

test('THE FREEZE: a come-to-me slot ignores the provider arg — stays come-to-me after a switch to travelling', () => {
    const booked = { shape: 'slot', fulfilment: 'collection' };

    // Every possible current provider state — the slot result must not move.
    for (const providerNow of [undefined, null, 'collection', 'delivery', 'both'] as const) {
        const v = orderLocation(booked, providerNow as any);
        assert.equal(v.comesToCottage, false, `stayed come-to-me with provider=${providerNow}`);
        assert.equal(v.collects, true, `still collects with provider=${providerNow}`);
    }

    // Counter-proof: the OLD path derived from the provider, so a switch to
    // 'delivery' would have flipped it. That is what we moved away from.
    const buggy = orderLocation({ shape: 'slot', fulfilment: 'delivery' });
    assert.equal(buggy.comesToCottage, true, 'the old provider-derived path would have rewritten it');
});
