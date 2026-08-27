// The cleaner's choice: a price per house size, or a rate per hour.
//
// Bands exist so two cleaners are comparable and so the total is knowable
// before the job -- an hourly figure as the price is what puts the total after
// the job. Cleaning is a 10% commission trade, so an hourly price has nothing
// to take a percentage of at acceptance.
//
// What makes hourly safe is not the trade, it is who sends the bill: on an
// in-house provider the platform bills, knows the hours, and takes no
// commission from itself. That is the whole of the justification, so it is the
// whole of what is permitted, and most of this file is about holding it there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    TRADES,
    offersHourlyChoice,
    pricingChoiceFor,
    coversBand,
    pricingProblems,
    bandsFor,
    BEDROOM_BANDS,
} = require('@/lib/serviceProviders');

const { hourlyVisitTotal, serviceCommission } = require('@/lib/pricing');

const inHouseCleaner = (over: any = {}) => ({
    trade: 'sponge', kind: 'in_house', pricing_choice: 'hourly',
    billable_hourly_rate: 18, covered_bands: ['beds_1_2', 'beds_3_4'], ...over,
});

// --- who may be asked at all ------------------------------------------------

test('only an in-house cleaner is offered the choice', () => {
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: 'in_house' }), true);
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: 'external' }), false,
        'a firm that bills its own customers is not ours to bill by the hour');
});

test('no other trade is offered it, in-house or not', () => {
    // The rule everywhere else stands: an hourly rate is display-only and
    // never enters a total. Looped rather than sampled, so a trade added to
    // the picker cannot quietly acquire a billable rate.
    for (const trade of TRADES.map((t: any) => t.key)) {
        if (trade === 'sponge') continue;

        assert.equal(offersHourlyChoice({ trade, kind: 'in_house' }), false,
            trade + ' is not offered an hourly price even in-house');
        assert.equal(offersHourlyChoice({ trade, kind: 'external' }), false);
    }
});

test('a public applicant is external, so the question never reaches them', () => {
    // `kind` has no default in the browser and no route writes it, so this is
    // the shape every self-serve sign-up actually has.
    assert.equal(offersHourlyChoice({ trade: 'sponge' }), false);
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: '' }), false);
    assert.equal(offersHourlyChoice(null), false);
});

// --- the value is only honoured where it is permitted -----------------------

test('an hourly row that is no longer in-house falls back to bands', () => {
    // The stale case: switched to in-house, set to hourly, switched back. The
    // column still says 'hourly'. Reading the permission as well as the value
    // is what stops anything downstream honouring it.
    const stale = inHouseCleaner({ kind: 'external' });

    assert.equal(pricingChoiceFor(stale), 'bands');
    assert.equal(pricingChoiceFor(inHouseCleaner()), 'hourly');
});

test('bands is the answer for everybody who has not said otherwise', () => {
    assert.equal(pricingChoiceFor({ trade: 'sponge', kind: 'in_house' }), 'bands');
    assert.equal(pricingChoiceFor({ trade: 'plumber', pricing_choice: 'hourly' }), 'bands',
        'a plumber cannot reach the per-hour route by writing to the column');
    assert.equal(pricingChoiceFor(null), 'bands');
});

// --- how she appears in a band-filtered list --------------------------------

test('a banded cleaner is covered where she has a price and nowhere else', () => {
    const banded = { trade: 'sponge', kind: 'external', pricing_choice: 'bands' };
    const prices = { beds_1_2: { price: '80' }, beds_3_4: { price: '' } };

    assert.equal(coversBand(banded, prices, 'beds_1_2'), true);
    assert.equal(coversBand(banded, prices, 'beds_3_4'), false, 'blank means she does not cover it');
    assert.equal(coversBand(banded, prices, 'beds_5_plus'), false, 'absent means the same');
});

test('an hourly cleaner is covered exactly where she said, and does not vanish', () => {
    // The failure this exists to stop: she prices no bands, so under the
    // banded rule she would drop out of every list at once -- and a provider
    // who appears nowhere looks exactly like a provider nobody searched for,
    // which is why nobody would have noticed.
    const hourly = inHouseCleaner();

    assert.equal(coversBand(hourly, {}, 'beds_1_2'), true);
    assert.equal(coversBand(hourly, {}, 'beds_3_4'), true);
    assert.equal(coversBand(hourly, {}, 'beds_5_plus'), false, 'she said she will not take those');

    const covered = BEDROOM_BANDS
        .map((b: any) => b.key)
        .filter((band: string) => coversBand(hourly, {}, band));

    assert.equal(covered.length > 0, true, 'an hourly cleaner is never invisible everywhere');
});

test('an hourly cleaner ignores band prices, and a banded one ignores the array', () => {
    // The two routes must not read each other's answer, or a leftover from
    // one shape would decide coverage in the other.
    const hourlyWithStalePrices = inHouseCleaner({ covered_bands: ['beds_5_plus'] });
    assert.equal(coversBand(hourlyWithStalePrices, { beds_1_2: { price: '80' } }, 'beds_1_2'), false);
    assert.equal(coversBand(hourlyWithStalePrices, {}, 'beds_5_plus'), true);

    const bandedWithStaleArray = {
        trade: 'sponge', kind: 'in_house', pricing_choice: 'bands', covered_bands: ['beds_5_plus'],
    };
    assert.equal(coversBand(bandedWithStaleArray, {}, 'beds_5_plus'), false);
});

test('a price of zero or nonsense is not coverage', () => {
    const banded = { trade: 'sponge', pricing_choice: 'bands' };

    assert.equal(coversBand(banded, { beds_1_2: { price: '0' } }, 'beds_1_2'), false);
    assert.equal(coversBand(banded, { beds_1_2: { price: 'free' } }, 'beds_1_2'), false);
    assert.equal(coversBand(banded, { beds_1_2: { price: null } }, 'beds_1_2'), false);
});

// --- what the form will and will not accept ---------------------------------

const draft = (over: any = {}) => ({
    trade: 'sponge', prices: {}, extras: {}, callout_fee: '', hourly_rate: '',
    callout_waived: false, ...over,
});

test('an hourly cleaner is accepted with no band prices at all', () => {
    // The rule that would otherwise refuse her for ever: price at least one
    // size.
    const problems = pricingProblems(draft({
        kind: 'in_house', pricing_choice: 'hourly',
        billable_hourly_rate: '18', covered_bands: ['beds_1_2'],
    }));

    assert.deepEqual(problems, []);
});

test('a banded cleaner still has to price a size', () => {
    const problems = pricingProblems(draft({ kind: 'external', pricing_choice: 'bands' }));

    assert.equal(problems.some((p: any) => p.field === 'prices'), true,
        'the banded rule is untouched');
});

test('an hourly cleaner without a rate is refused', () => {
    const problems = pricingProblems(draft({
        kind: 'in_house', pricing_choice: 'hourly', covered_bands: ['beds_1_2'],
    }));

    assert.equal(problems.some((p: any) => p.field === 'billable_hourly_rate'), true);
});

test('an hourly cleaner who names no sizes is refused rather than hidden', () => {
    // Left to itself this is the silent failure: a complete-looking listing
    // that appears in no search. So it is a problem on the form instead.
    const problems = pricingProblems(draft({
        kind: 'in_house', pricing_choice: 'hourly', billable_hourly_rate: '18', covered_bands: [],
    }));

    assert.equal(problems.some((p: any) => p.field === 'covered_bands'), true);
});

test('an external cleaner sending pricing_choice hourly is validated as banded', () => {
    // There is no path where the form accepts a rate the database would then
    // refuse: the check constraint says hourly is cleaning AND in-house, and
    // this says the same thing one layer up.
    const problems = pricingProblems(draft({
        kind: 'external', pricing_choice: 'hourly', billable_hourly_rate: '18',
        covered_bands: ['beds_1_2'],
    }));

    assert.equal(problems.some((p: any) => p.field === 'prices'), true,
        'she is held to the banded rules, rate or no rate');
});

// --- the arithmetic ---------------------------------------------------------

test('an hourly visit totals rate by hours, and only in lib/pricing', () => {
    assert.equal(hourlyVisitTotal(18, 2.5), 45);
    assert.equal(hourlyVisitTotal('18', '3'), 54);

    // Nothing is owed for nothing worked, and a missing rate is not free work.
    assert.equal(hourlyVisitTotal(18, 0), 0);
    assert.equal(hourlyVisitTotal(null, 3), 0);
    assert.equal(hourlyVisitTotal(18, null), 0);
    assert.equal(hourlyVisitTotal(-5, 3), 0);
});

test('the multiplication is not in serviceProviders, where the hours guard looks', () => {
    // tests/service-pricing.test.ts scans that file for any line mentioning
    // hours that also multiplies or divides. Putting this there would either
    // trip that guard or tempt somebody to word around it, and the guard is
    // what keeps typical_hours out of every total. So it lives in the file
    // that owns arithmetic, and this says so out loud.
    const fs = require('fs');
    const path = require('path');

    const rules = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'lib', 'serviceProviders.ts'), 'utf8');
    assert.equal(/hourlyVisitTotal/.test(rules), false,
        'the totalling helper does not live in the rules file');

    const pricing = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'lib', 'pricing.ts'), 'utf8');
    assert.equal(/hourlyVisitTotal/.test(pricing), true);
});

test('an in-house cleaner is billed by us and charged no commission on top', () => {
    // Why hourly is safe here and nowhere else, stated as a number: in-house
    // takes no commission, so there is no ceiling for the missing total to
    // have been a percentage of.
    assert.equal(serviceCommission(hourlyVisitTotal(18, 3), 0), 0);
});
