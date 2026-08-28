// The cleaner's choice: a price per house size, or a rate per hour.
//
// Bands exist so two cleaners are comparable and so the total is knowable
// before the job -- an hourly figure as the price is what puts the total after
// the job. Cleaning is a 10% commission trade, so an hourly price has nothing
// to take a percentage of at acceptance.
//
// That reasoning is still true and is no longer the whole rule. The in-house
// gate came off on 29 Aug 2026: every cleaner is offered the choice, a public
// applicant included. The consequence was accepted rather than solved — an
// external hourly cleaner has no knowable total at acceptance, so her
// commission cannot be computed there, and that is deferred to enquiries where
// the hours are agreed. Nothing is on a live money path yet.
//
// What this file holds the line on now is the TRADE: hourly is cleaning and
// nothing else, everywhere, at both layers.

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

// Deliberately external. The point of the fixture is that hourly no longer
// depends on who sends the bill, so the default case here is the one that used
// to be forbidden.
const hourlyCleaner = (over: any = {}) => ({
    trade: 'sponge', kind: 'external', pricing_choice: 'hourly',
    billable_hourly_rate: 18, covered_bands: ['beds_1_2', 'beds_3_4'], ...over,
});

// --- who may be asked at all ------------------------------------------------

test('every cleaner is offered the choice, whoever sends the bill', () => {
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: 'in_house' }), true);
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: 'external' }), true,
        'a cleaning round that bills by the hour is an ordinary way to run one');
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

test('a public applicant is asked it too', () => {
    // `kind` has no default in the browser and no route writes it, so this is
    // the shape every self-serve sign-up actually has — and it is now exactly
    // the shape the question is meant to reach.
    assert.equal(offersHourlyChoice({ trade: 'sponge' }), true);
    assert.equal(offersHourlyChoice({ trade: 'sponge', kind: '' }), true);
    assert.equal(offersHourlyChoice(null), false, 'no provider, no choice');
});

// --- the value is only honoured where it is permitted -----------------------

test('an hourly row on a trade that may not have it falls back to bands', () => {
    // The stale case, on the axis that still exists. Kind no longer decides
    // anything, but trade does: a row set to hourly as a cleaner and then
    // moved to another trade still says 'hourly' in the column. Reading the
    // permission as well as the value is what stops anything downstream
    // honouring it.
    const movedTrade = hourlyCleaner({ trade: 'plumber' });

    assert.equal(pricingChoiceFor(movedTrade), 'bands');
    assert.equal(pricingChoiceFor(hourlyCleaner()), 'hourly',
        'an external cleaner on hourly is honoured now, not downgraded');
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
    const hourly = hourlyCleaner();

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
    const hourlyWithStalePrices = hourlyCleaner({ covered_bands: ['beds_5_plus'] });
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

test('an external cleaner on hourly is validated as hourly, not banded', () => {
    // The inverse of what this asserted before the gate came off. She is not
    // held to "price at least one size" any more, because she prices none.
    const problems = pricingProblems(draft({
        kind: 'external', pricing_choice: 'hourly', billable_hourly_rate: '18',
        covered_bands: ['beds_1_2'],
    }));

    assert.deepEqual(problems, []);
});

test('a non-cleaner sending pricing_choice hourly is still validated as banded', () => {
    // The half of the old rule that stands. There is no path where the form
    // accepts a rate the database would then refuse: the check constraint says
    // hourly is cleaning, and this says the same thing one layer up.
    const problems = pricingProblems(draft({
        trade: 'droplet', pricing_choice: 'hourly', billable_hourly_rate: '18',
        covered_bands: ['beds_1_2'],
    }));

    assert.equal(problems.some((p: any) => p.field === 'prices'), true,
        'held to the banded rules, rate or no rate');
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
    // Still true, and no longer the justification for anything. In-house takes
    // no commission, so there is no ceiling for a missing total to have been a
    // percentage of.
    //
    // For an EXTERNAL hourly cleaner there is no assertion here to make yet:
    // the total is not known at acceptance, so the 10% cannot be computed
    // there. That is the deferred consequence recorded in
    // 20260827192211_cleaning_hourly_any_cleaner.sql, and it is a gap in the design
    // rather than in this file. When enquiries settle the hours, it gets a
    // test.
    assert.equal(serviceCommission(hourlyVisitTotal(18, 3), 0), 0);
});
