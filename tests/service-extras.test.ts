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
        assert.equal(['about', 'priced', 'reimbursed'].indexOf(e.group) !== -1, true, e.key + ' has no group');
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
        'equipment_provided', 'same_day_changeover', 'damage_photos',
        'laundry_on_site', 'laundry_taken_away',
        'bedding_single', 'bedding_double', 'hot_tub_service',
        'consumables', 'welcome_gifts', 'receipts_provided',
    ]) {
        assert.equal(keys.indexOf(expected) !== -1, true, expected + ' is missing');
    }

    assert.equal(keys.some((k: string) => /pet/.test(k)), false, 'the pet surcharge was dropped');
});

test('laundry is two independent toggles, not one lossy yes/no', () => {
    const onSite = extraByKey('laundry_on_site');
    const takenAway = extraByKey('laundry_taken_away');

    assert.equal(onSite.type, 'toggle');
    assert.equal(takenAway.type, 'toggle');
    assert.notEqual(onSite.key, takenAway.key,
        'one toggle could not tell "taken away" from "does not do laundry"');
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

// --- what has to be filled in ----------------------------------------------

const offered = (extras: Record<string, any>) => ({ trade: 'sponge', extras });

test('offering nothing is fine', () => {
    assert.deepEqual(extrasProblems(offered({})), []);
});

test('a priced extra turned on needs a price', () => {
    const problems = extrasProblems(offered({ hot_tub_service: { offered: true } }));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'extra_price_hot_tub_service');
});

test('a priced extra turned off needs nothing', () => {
    assert.deepEqual(extrasProblems(offered({ hot_tub_service: { offered: false } })), []);
});

test('a toggle never needs a price', () => {
    assert.deepEqual(extrasProblems(offered({ same_day_changeover: { offered: true } })), []);
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
        submitProblems({ ...base, extras: { bedding_double: { offered: true } } })
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
            },
        },
        cleaning()
    );
    assert.equal(ceiling, 60 + 24 + 10);
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
