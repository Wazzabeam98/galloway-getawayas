// Extras, and the money rule that decides how each type behaves.
//
// Three types, because they are three different things:
//
//   toggle      matching and comparison. Never a line on a bill.
//   priced      part of the ceiling the 10% comes off.
//   reimbursed  the provider spends the host's money and is paid back directly
//               against a receipt. Off Stripe entirely. No number exists at
//               quote time, it is revenue for nobody, and it must never reach
//               a ceiling or a commission.
//
// That last rule is the one worth the most tests. It is the same shape as
// typical_hours: a value that must stay out of every total, guarded twice —
// once by behaviour and once by reading the source, because behaviour can only
// cover the code that exists today.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    SERVICE_EXTRAS,
    extrasFor,
    extraByKey,
    extrasProblems,
    groupIsOffered,
    groupGate,
    EXTRA_GROUPS,
    submitProblems,
    HOST_TRADES,
} = require('@/lib/serviceProviders');

const { serviceCeiling, serviceCommission } = require('@/lib/pricing');

const cleaning = () => extrasFor('sponge');

// --- the catalogue ---------------------------------------------------------

test('every extra belongs to a real trade and has a type', () => {
    for (const e of SERVICE_EXTRAS) {
        assert.equal(HOST_TRADES.indexOf(e.trade) !== -1, true, e.key + ' is on no host trade');
        assert.equal(['toggle', 'priced', 'reimbursed'].indexOf(e.type) !== -1, true, e.key + ' has no type');
        assert.equal(EXTRA_GROUPS.some((g: any) => g.key === e.group), true, e.key + ' is in no known group');
        assert.ok(e.label && e.label.length > 3, e.key + ' has no label');
    }
});

test('no two extras share a key', () => {
    const keys = SERVICE_EXTRAS.map((e: any) => e.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('a per-unit extra says what the host is counting', () => {
    for (const e of SERVICE_EXTRAS) {
        if (e.unit === 'each') {
            assert.ok(e.quantityLabel, e.key + ' is per-unit but never says per what');
        }
    }
});

test('cleaning carries the extras that were asked for', () => {
    const keys = cleaning().map((e: any) => e.key);

    for (const expected of [
        'equipment_provided', 'damage_photos',
        'bedding_single', 'bedding_double', 'bedding_king', 'hot_tub_service',
        'consumables', 'welcome_gifts', 'receipts_provided',
    ]) {
        assert.equal(keys.indexOf(expected) !== -1, true, expected + ' is missing');
    }

    assert.equal(keys.some((k: string) => /pet/.test(k)), false, 'the pet surcharge was dropped');
    assert.equal(keys.indexOf('laundry_on_site'), -1, 'the two laundry toggles were dropped');
    assert.equal(keys.indexOf('laundry_taken_away'), -1);
    assert.equal(keys.indexOf('same_day_changeover'), -1, 'and the same-day changeover toggle');
});

test('the three bedding rates sit behind one question', () => {
    const beds = cleaning().filter((e: any) => e.group === 'laundry');

    assert.deepEqual(beds.map((e: any) => e.key), ['bedding_single', 'bedding_double', 'bedding_king']);
    assert.equal(groupGate('laundry'), 'Do you offer a laundry service?');

    for (const b of beds) {
        assert.equal(b.type, 'priced');
        assert.equal(b.unit, 'each', b.key + ' is a rate per bed, not a total');
    }
});

test('king is a catalogue entry and needs no column', () => {
    const king = extraByKey('bedding_king');

    assert.equal(king.group, 'laundry');
    assert.equal(king.type, 'priced');
    // The table constrains the shape of a key, not a list of them — which is
    // why a new size is a line in lib rather than a migration.
    assert.match(king.key, /^[a-z][a-z0-9_]{2,48}$/);
});

test('the gate is worked out from the prices, never stored', () => {
    const trade = 'sponge';

    assert.equal(groupIsOffered('laundry', trade, {}), false);
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '' } }), false,
        'a blank box is not an offer');
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '0' } }), false);
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '8' } }), true,
        'one rate filled in is a laundry service');
    assert.equal(groupIsOffered('laundry', trade, { bedding_king: { price: '12' } }), true);
});

test('only groups that need a question have one', () => {
    assert.equal(groupGate('priced'), null);
    assert.equal(groupGate('about'), null);
    assert.equal(groupGate('reimbursed'), null);
});

test('receipts sits with the reimbursed ones but is stored as a toggle', () => {
    const receipts = extraByKey('receipts_provided');
    assert.equal(receipts.type, 'toggle', 'there is no price on it');
    assert.equal(receipts.group, 'reimbursed', 'but it belongs with the money it is about');
});

test('a trade with no extras yet has none rather than the cleaning ones', () => {
    assert.deepEqual(extrasFor('trees'), []);
    assert.deepEqual(extrasFor('spanner'), []);
});

test('window cleaning charges for height, and does not ask whether they go up', () => {
    const keys = extrasFor('droplet').map((e: any) => e.key);

    // Long poles: going upstairs is not a real distinction, so height is
    // priced rather than offered or withheld.
    assert.deepEqual(keys, ['upstairs_surcharge', 'high_access_surcharge']);
    assert.equal(extraByKey('upstairs_windows'), null);
    assert.equal(extraByKey('upstairs_surcharge').type, 'priced');
    assert.equal(extraByKey('high_access_surcharge').type, 'priced');
});

test('a storey surcharge is a flat amount, not a rate per anything', () => {
    for (const key of ['upstairs_surcharge', 'high_access_surcharge']) {
        assert.equal(extraByKey(key).unit, undefined,
            key + ' must be a flat figure — a host should not have to do arithmetic');
    }
});

test('the storey surcharges are part of the ceiling', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 35, extras: { upstairs_surcharge: { offered: true, price: 15 } } },
        extrasFor('droplet')
    );
    assert.equal(ceiling, 50);
});

// --- what has to be filled in ----------------------------------------------

const offered = (extras: Record<string, any>) => ({ trade: 'sponge', extras });

test('offering nothing is fine', () => {
    assert.deepEqual(extrasProblems(offered({})), []);
});

test('a blank price is a real answer, not a mistake', () => {
    assert.deepEqual(extrasProblems(offered({ hot_tub_service: { price: '' } })), [],
        'a price is the yes and a blank is the no, exactly as the size bands work');
    assert.deepEqual(extrasProblems(offered({ bedding_king: { price: '' } })), []);
});

test('something typed into a price box that is not a price is caught', () => {
    const problems = extrasProblems(offered({ hot_tub_service: { price: 'twenty' } }));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'extra_price_hot_tub_service');

    assert.equal(
        extrasProblems(offered({ bedding_single: { price: '-4' } }))
            .some((p: any) => p.field === 'extra_price_bedding_single'),
        true
    );
});

test('a priced extra has no tick to disagree with its price', () => {
    // The price alone decides. Offering nothing and offering a blank are the
    // same answer, and there is no state where a tick says yes and the box
    // says nothing.
    assert.deepEqual(
        extrasProblems(offered({ hot_tub_service: { price: '25' } })),
        extrasProblems(offered({ hot_tub_service: { offered: true, price: '25' } }))
    );
});

test('a toggle never needs a price', () => {
    assert.deepEqual(extrasProblems(offered({ damage_photos: { offered: true } })), []);
});

test('a reimbursed extra never needs a price — there is no number yet', () => {
    assert.deepEqual(extrasProblems(offered({ consumables: { offered: true } })), [],
        'the amount is whatever the receipt says, weeks later');
});

test('extras are part of the one submit gate', () => {
    const base = {
        business_name: 'Solway Sparkle',
        trade: 'sponge',
        description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
        contact_email: 'hello@solwaysparkle.test',
        // Supplied the way the page supplies it — derived from the trade.
        audience: 'host',
        areaCount: 1,
        prices: { beds_1_2: { price: '60' } },
    };

    assert.deepEqual(submitProblems(base), []);
    assert.equal(
        submitProblems({ ...base, extras: { bedding_double: { price: 'eight' } } })
            .some((p: any) => p.field === 'extra_price_bedding_double'),
        true
    );
});

// --- the ceiling -----------------------------------------------------------

test('the ceiling is the band price when nothing is added', () => {
    assert.equal(serviceCeiling({ bandPrice: '60' }, cleaning()), 60);
});

test('a flat priced extra is added to the ceiling', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { hot_tub_service: { offered: true, price: 25 } } },
        cleaning()
    );
    assert.equal(ceiling, 85);
});

test('a per-unit extra multiplies by what the host asked for', () => {
    const ceiling = serviceCeiling(
        {
            bandPrice: 60,
            extras: {
                bedding_double: { offered: true, price: 8, quantity: 3 },
                bedding_single: { offered: true, price: 5, quantity: 2 },
                bedding_king: { offered: true, price: 12, quantity: 1 },
            },
        },
        cleaning()
    );
    assert.equal(ceiling, 60 + 24 + 10 + 12);
});

test('a per-unit extra with no quantity adds nothing', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { bedding_double: { offered: true, price: 8 } } },
        cleaning()
    );
    assert.equal(ceiling, 60, 'no beds asked for is no beds charged');
});

test('an extra that was not offered is not charged even with a price on it', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { hot_tub_service: { offered: false, price: 25 } } },
        cleaning()
    );
    assert.equal(ceiling, 60);
});

test('the ceiling lands on a penny', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60.005, extras: { hot_tub_service: { offered: true, price: 0.001 } } },
        cleaning()
    );
    assert.equal(ceiling, Math.round(ceiling * 100) / 100);
});

test('commission is ten per cent of the ceiling', () => {
    assert.equal(serviceCommission(85, 0.10), 8.5);
    assert.equal(serviceCommission(0, 0.10), 0);
    assert.equal(serviceCommission(33.33, 0.10), 3.33);
});

// --- reimbursed money never reaches a total --------------------------------

test('a reimbursed extra never enters the ceiling', () => {
    const without = serviceCeiling({ bandPrice: 60 }, cleaning());

    // Offered, and with a price wrongly attached — the sort of thing a bad
    // write or a hand-edited row could produce.
    const withReimbursed = serviceCeiling(
        {
            bandPrice: 60,
            extras: {
                consumables: { offered: true, price: 40, quantity: 3 },
                welcome_gifts: { offered: true, price: 25 },
            },
        },
        cleaning()
    );

    assert.equal(withReimbursed, without,
        'the host pays the cleaner back directly — it is revenue for nobody and cannot be commissioned');
});

test('a reimbursed extra never changes the commission', () => {
    const clean = serviceCommission(serviceCeiling({ bandPrice: 60 }, cleaning()), 0.10);
    const dirty = serviceCommission(
        serviceCeiling(
            { bandPrice: 60, extras: { consumables: { offered: true, price: 400 } } },
            cleaning()
        ),
        0.10
    );

    assert.equal(dirty, clean);
    assert.equal(dirty, 6);
});

test('reimbursed money is absent by construction, not by subtraction', () => {
    // Structural half. Only 'priced' is summed, so there is no branch that
    // could let a reimbursed extra through — and no line that touches the word
    // may multiply or divide.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'pricing.ts'), 'utf8');

    const offending = src
        .split('\n')
        .map((line: string) => line.replace(/\/\/.*$/, ''))
        .filter((line: string) => /reimburse/i.test(line))
        .filter((line: string) => /[*\/]/.test(line));

    assert.deepEqual(offending, [],
        'a reimbursed amount must never be a term in a total');

    // And the sum is opt-in on the type, rather than opting reimbursed out —
    // a filter that excludes is one edit away from including.
    assert.match(src, /extra\.type !== 'priced'\) continue;/,
        'only priced extras are summed, by name');
});
