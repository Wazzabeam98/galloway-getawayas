// The unit model for experience offerings (9 Oct 2026): five units a provider
// recognises — per person, per group, per event, per item (per hour comes with
// stage two) — offered by booking shape, and the words a guest reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import { chargeUnitsFor, unitChoices, needsCapacity, guestUnitSuffix, priceQuestion, UNIT_NAME } from '../lib/pricingUnits';
import { unitMultiplies, orderQuantity } from '../lib/serviceOrders';

test('each shape is offered the units that fit how it is booked', () => {
    assert.deepEqual(chargeUnitsFor('slot'), ['person', 'flat'], 'a group session: a place each, or the whole session');
    assert.deepEqual(chargeUnitsFor('slot', { timed: true }), ['flat'], 'a massage: one price for a set length, never asked');
    assert.deepEqual(chargeUnitsFor('comes_to_you'), ['person', 'flat', 'event', 'item', 'hour'], 'per hour is comes-to-you only');
    assert.deepEqual(chargeUnitsFor('made_to_order'), ['item'], 'a food menu is per item, never asked');
});

test('per group and per event are two names for the same one-price charge', () => {
    assert.equal(UNIT_NAME.flat, 'Per group');
    assert.equal(UNIT_NAME.event, 'Per event');
    for (const u of ['flat', 'event']) {
        assert.equal(unitMultiplies(u), false, u + ' is charged once');
        assert.equal(orderQuantity(u, 9), 1, u + ': however many come, the quantity is one');
    }
});

test('a guest sees the word the provider chose', () => {
    assert.equal(guestUnitSuffix('person'), ' / guest');
    assert.equal(guestUnitSuffix('flat'), ' / group');
    assert.equal(guestUnitSuffix('event'), ' / event');
    assert.equal(guestUnitSuffix('item'), '');
    // A timed treatment reads by its length ("£60 · 1 hr"), not "/ group".
    assert.equal(guestUnitSuffix('flat', true), '');
});

test('the price is asked per the unit already chosen', () => {
    assert.equal(priceQuestion('person'), 'How much per person?');
    assert.equal(priceQuestion('flat'), 'How much per group?');
    assert.equal(priceQuestion('event'), 'How much per event?');
    assert.equal(priceQuestion('flat', true), 'How much is it?');
});

test('a maximum capacity is asked only of per-person or per-group pricing', () => {
    assert.equal(needsCapacity(['event']), false);
    assert.equal(needsCapacity(['item']), false);
    assert.equal(needsCapacity(['event', 'item']), false);
    assert.equal(needsCapacity(['hour']), false, 'a dog walker by the hour has no capacity');
    assert.equal(needsCapacity(['person']), true);
    assert.equal(needsCapacity(['flat', 'event']), true);
    assert.equal(needsCapacity([]), true, 'nothing chosen yet is never read as "skip it"');
});

test('an offering on a legacy unit keeps it rather than being silently changed', () => {
    assert.deepEqual(unitChoices(['person', 'flat'], 'night'), ['person', 'flat', 'night']);
    assert.deepEqual(unitChoices(['person', 'flat'], 'person'), ['person', 'flat']);
});

// Ranges and price on enquiry were dropped, but price_mode stays on the table
// (not written, not dropped). An older range row stores its "from" figure as
// price, so a route that checked only price > 0 would sell it at that figure —
// the request path did exactly that until 9 Oct 2026. Every route that sells an
// offering must refuse on the mode, and the marketplace must list fixed only.
test('every route that sells an offering refuses a price that is not fixed', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

    const order = read('app/api/services/order/route.ts');
    assert.match(order, /\.select\('[^']*price_mode[^']*'\)\s*\.eq\('id', itemId\)/, 'the single-item request reads the mode');
    assert.match(order, /\(item\.price_mode \|\| 'fixed'\) !== 'fixed'/, 'the single-item request refuses a non-fixed price');
    assert.match(order, /it\.price_mode && it\.price_mode !== 'fixed'/, 'the food cart refuses a non-fixed price');

    const slots = read('app/api/services/slots/book/route.ts');
    assert.match(slots, /item\.price_mode && item\.price_mode !== 'fixed'/, 'a slot booking refuses a non-fixed price');

    const loader = read('lib/experiencesData.ts');
    assert.match(loader, /\.eq\('price_mode', 'fixed'\)/, 'the marketplace lists fixed prices only');
});

// ONE OFFERING, TWO PRICES (9 Oct 2026). A per-person offering with a group price
// is booked a place each or whole by one group — the provider sets it up once.
import { bookingOptions, optionTarget } from '../components/marketplace/present';

test('a per-person offering with a group price offers a whole-group option', () => {
    const sauna = { id: 's1', name: 'Sauna round', price: 18, unit: 'person', groupPrice: 90, minPeople: 2 };
    const walk = { id: 'w1', name: 'Guided walk', price: 25, unit: 'person', groupPrice: null, minPeople: null };
    const hire = { id: 'h1', name: 'Boat hire', price: 300, unit: 'flat', groupPrice: null, minPeople: null };
    const opts = bookingOptions([sauna, walk, hire]);
    assert.deepEqual(opts.map((o) => o.id), ['s1', 's1~group', 'w1', 'h1'], 'only the offering with a group price gains a second option');
    const group = opts.find((o) => o.id === 's1~group')!;
    assert.equal(group.unit, 'flat', 'the whole-group option is a one-price booking — the private-hire rules apply');
    assert.equal(group.price, 90, 'at the group price');
    assert.equal(group.minPeople, null, 'a per-person minimum never applies to the whole group');
    assert.deepEqual(optionTarget('s1~group'), { itemId: 's1', bookAs: 'group' }, 'the route is sent the real offering and the mode');
    assert.deepEqual(optionTarget('s1'), { itemId: 's1' });
});

test('both booking routes take a group booking only from a per-person offering with a group price, at that price', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    for (const f of ['app/api/services/slots/book/route.ts', 'app/api/services/order/route.ts']) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.match(src, /bookAsGroup && !\(normaliseUnit\(item\.unit\) === 'person' && Number\(item\.group_price\) > 0\)/, f + ' refuses a group booking without a group price');
        assert.match(src, /const unit = bookAsGroup \? 'flat' : normaliseUnit\(item\.unit\)/, f + ' books the group whole (flat)');
        assert.match(src, /const unitPrice = bookAsGroup \? Number\(item\.group_price\) : Number\(item\.price\)/, f + ' charges the group price, read from the item');
    }
});

// PER HOUR (9 Oct 2026): multiplies by the hours the guest picks, never by people.
import { pricedPerHead, pricedByQuantity, orderTotal } from '../lib/serviceOrders';
import { perGroupPricing } from '../lib/orderChange';

test('per hour and per item multiply by a quantity, never by the party', () => {
    assert.equal(pricedPerHead('person'), true);
    for (const u of ['hour', 'item']) {
        assert.equal(pricedPerHead(u), false, u + ' is not per head');
        assert.equal(pricedByQuantity(u), true, u + ' is priced by a quantity the guest picks');
        assert.equal(unitMultiplies(u), true, u + ' still multiplies');
    }
    for (const u of ['flat', 'event']) assert.equal(pricedByQuantity(u), false);
    // Three people booking a two-hour walk at £20 an hour pay £40, not £60 or £120.
    assert.equal(orderTotal(20, 2), 40);
});

test('changing the head count never re-prices an hourly or per-item booking', () => {
    assert.equal(perGroupPricing('person'), false, 'per person: more people, more money');
    assert.equal(perGroupPricing('hour'), true, 'per hour: the party is not the price');
    assert.equal(perGroupPricing('item'), true);
    assert.equal(perGroupPricing('flat'), true);
    assert.equal(perGroupPricing('event'), true);
});

test('the request route and dialog price an hourly booking by hours, with its minimum', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    const order = fs.readFileSync(path.join(ROOT, 'app/api/services/order/route.ts'), 'utf8');
    assert.match(order, /\.select\('[^']*min_hours[^']*'\)/, 'the route reads the minimum hours');
    assert.match(order, /if \(quantity < minHours\)/, 'fewer than the minimum is refused');
    assert.match(order, /pricedPerHead\(unit\) && quantity > cap/, 'only a per-head booking is capped by the party size');
    assert.doesNotMatch(order, /unitMultiplies\(unit\) && quantity > cap/, 'hours are never capped by how many are staying');
    const dialog = fs.readFileSync(path.join(ROOT, 'components/marketplace/RequestBooking.tsx'), 'utf8');
    assert.match(dialog, /if \(pricedPerHead\(it\.unit\)\) return orderTotal\(it\.price, Math\.max\(1, adults/, 'per person: price × heads');
    assert.match(dialog, /if \(pricedByQuantity\(it\.unit\)\) return orderTotal\(it\.price, Math\.max\(itemMinQuantity\(it\), Math\.floor\(quantity\)/, 'per hour: price × hours picked, at least the minimum');
    const panel = fs.readFileSync(path.join(ROOT, 'components/marketplace/BookingPanel.tsx'), 'utf8');
    assert.match(panel, /byQuantity \? Math\.max\(1, args\.quantity\)/, 'the panel sends the hours picked as the quantity');
});
