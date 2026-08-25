// What a provider charges, and which shape their trade uses.
//
// Bands are defined here rather than by the provider so that two cleaners are
// comparable. The axis differs by trade — bedrooms for cleaning and waste,
// because the listing already knows it; plot for gardening, because a two-bed
// cottage can sit in an acre — but the shape is one shape.
//
// The rule that matters most in here: typical_hours is a guide shown to the
// host and must never enter a calculation. The moment it does, the total only
// exists after the job, and the completion problem is back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    pricingModelFor,
    bandsFor,
    bandLabel,
    bandForBedrooms,
    bandForPlot,
    bandForStoreys,
    storeyLabel,
    BUILDING_TYPES,
    buildingTypeLabel,
    STOREY_BANDS,
    canBeRequested,
    showsTimeGuide,
    unclaimedTrades,
    pricingProblems,
    submitProblems,
    BEDROOM_BANDS,
    PLOT_BANDS,
    tradeLabel,
} = require('@/lib/serviceProviders');

// --- which shape each trade uses -------------------------------------------

test('cleaning and waste are banded on bedrooms', () => {
    assert.equal(pricingModelFor('sponge'), 'bands');
    assert.equal(pricingModelFor('bin'), 'bands');
    assert.deepEqual(bandsFor('sponge').map((b: any) => b.key), ['beds_1_2', 'beds_3_4', 'beds_5_plus']);
    assert.deepEqual(bandsFor('bin').map((b: any) => b.key), ['beds_1_2', 'beds_3_4', 'beds_5_plus']);
});

test('gardening is banded on the plot, not on bedrooms', () => {
    assert.equal(pricingModelFor('trees'), 'bands');
    assert.deepEqual(bandsFor('trees').map((b: any) => b.key), ['plot_yard', 'plot_garden', 'plot_grounds']);
    assert.equal(bandsFor('trees').some((b: any) => b.key.indexOf('beds') === 0), false,
        'a two-bed cottage can sit in an acre');
});

test('maintenance is a call-out plus an hourly rate, and cannot be banded', () => {
    assert.equal(pricingModelFor('spanner'), 'callout_hourly');
    assert.deepEqual(bandsFor('spanner'), []);
});

test('waste removal exists as a trade and reads as something', () => {
    assert.equal(tradeLabel('bin'), 'Waste removal');
});

test('window cleaning is banded on bedrooms, not on panes', () => {
    // Per-pane was rejected: a six-over-six sash is one window and twelve
    // panes, and it would have been the only place on the site where a host
    // has to go outside and count something.
    assert.equal(pricingModelFor('droplet'), 'bands');
    assert.deepEqual(bandsFor('droplet').map((b: any) => b.key), ['beds_1_2', 'beds_3_4', 'beds_5_plus']);
});

test('the storey bands say what the cleaner faces, not how many floors', () => {
    const labels = STOREY_BANDS.map((b: any) => b.label);

    assert.equal(STOREY_BANDS.length, 3);
    assert.match(labels.join(' '), /ladder/, 'the cost driver, said out loud');
    assert.equal(
        labels.some((l: string) => /^\s*(one|two|three) storey/i.test(l)),
        false,
        '"two storeys" is counted differently depending on whether the ground floor is one'
    );
});

// One business per trade, so the picker is a list of what somebody has plus
// what is left — not a question they have already answered.

test('somebody with nothing yet is offered every host trade', () => {
    const left = unclaimedTrades([], 'host').map((t: any) => t.key);
    assert.deepEqual(left, ['sponge', 'bin', 'spanner', 'trees', 'droplet'].filter(k => left.indexOf(k) !== -1));
    assert.equal(left.length, 5);
});

test('a trade already signed up for is not offered again', () => {
    const left = unclaimedTrades([{ trade: 'sponge' }], 'host').map((t: any) => t.key);

    assert.equal(left.indexOf('sponge'), -1, 'they already have a cleaning business');
    assert.equal(left.length, 4);
});

test('a cleaning firm and a window round leave three trades open', () => {
    const left = unclaimedTrades([{ trade: 'sponge' }, { trade: 'droplet' }], 'host').map((t: any) => t.key);

    assert.deepEqual(left.sort(), ['bin', 'spanner', 'trees']);
});

test('somebody with every trade is offered none', () => {
    const all = ['sponge', 'bin', 'spanner', 'trees', 'droplet'].map((trade) => ({ trade }));
    assert.deepEqual(unclaimedTrades(all, 'host'), []);
});

test('a guest-side business does not use up a host trade', () => {
    const left = unclaimedTrades([{ trade: 'cake' }], 'host').map((t: any) => t.key);
    assert.equal(left.length, 5, 'a baker has not signed up as a cleaner');
});

test('no providers at all is the same as none', () => {
    assert.equal(unclaimedTrades(null, 'host').length, 5);
    assert.equal(unclaimedTrades(undefined, 'host').length, 5);
});

test('window cleaning offers no time guide, the banded trades do', () => {
    assert.equal(showsTimeGuide('droplet'), false, 'quick work — a guide on every band is noise');
    assert.equal(showsTimeGuide('sponge'), true, 'an hour either way on a changeover is worth knowing');
    assert.equal(showsTimeGuide('trees'), true);
});

test('a building type is not the marketing category on a listing', () => {
    const keys = BUILDING_TYPES.map((b: any) => b.key);
    assert.deepEqual(keys, ['bungalow', 'semi_detached', 'detached', 'flat']);

    // listings.property_type holds Cottages, Farmhouses, Coastal Stays,
    // Cabins & Pods, Townhouses, Luxury Stays — how a place is sold, not what
    // it is built as. A cottage can be a bungalow or two storeys.
    const marketing = ['Cottages', 'Farmhouses', 'Coastal Stays', 'Cabins & Pods', 'Townhouses', 'Luxury Stays'];
    for (const m of marketing) {
        assert.equal(keys.indexOf(m), -1, m + ' is a category, not a building type');
    }

    assert.equal(buildingTypeLabel('flat'), 'Flat or apartment');
    assert.equal(buildingTypeLabel('Cottages'), '');
});

test('a storey band is only a band if it is one of ours', () => {
    assert.equal(bandForStoreys('storeys_two'), 'storeys_two');
    assert.equal(bandForStoreys('two-ish'), null);
    assert.equal(bandForStoreys(null), null, 'not said is a prompt, not a refusal');
    assert.equal(storeyLabel('storeys_one').length > 5, true);
    assert.equal(storeyLabel('nonsense'), '');
});

test('anything else prices per job', () => {
    assert.equal(pricingModelFor('cake'), 'quoted');
    assert.equal(pricingModelFor('chef'), 'quoted');
    assert.equal(pricingModelFor('nonsense'), 'quoted');
});

// --- the bands read the same to everybody ----------------------------------

test('the plot bands are physical anchors, not adjectives', () => {
    const labels = PLOT_BANDS.map((b: any) => b.label);

    assert.match(labels.join(' '), /tennis court/, 'something two people can picture');
    assert.equal(
        labels.some((l: string) => /\b(small|medium|large|big)\b/i.test(l) && !/Larger than that/.test(l)),
        false,
        'a bare size word is read differently by two hosts'
    );
});

test('every band has a label', () => {
    for (const b of [...BEDROOM_BANDS, ...PLOT_BANDS]) {
        assert.equal(bandLabel(b.key), b.label);
    }
    assert.equal(bandLabel('made_up'), 'made_up');
});

// --- derived from the listing, so the host enters nothing -------------------

test('the bedroom band comes off the listing', () => {
    assert.equal(bandForBedrooms(1), 'beds_1_2');
    assert.equal(bandForBedrooms(2), 'beds_1_2');
    assert.equal(bandForBedrooms(3), 'beds_3_4');
    assert.equal(bandForBedrooms(4), 'beds_3_4');
    assert.equal(bandForBedrooms(5), 'beds_5_plus');
    assert.equal(bandForBedrooms(9), 'beds_5_plus', 'the top band is open');
});

test('a listing with no bedroom count has no band rather than a wrong one', () => {
    assert.equal(bandForBedrooms(null), null);
    assert.equal(bandForBedrooms(0), null);
    assert.equal(bandForBedrooms(undefined), null);
});

test('a plot band is only a band if it is one of ours', () => {
    assert.equal(bandForPlot('plot_garden'), 'plot_garden');
    assert.equal(bandForPlot('medium-ish'), null);
    assert.equal(bandForPlot(null), null, 'not said is a prompt, not a refusal');
});

// --- maintenance cannot be requested yet -----------------------------------

test('maintenance cannot be requested until completion exists', () => {
    assert.equal(canBeRequested('spanner'), false,
        'the total only exists once the job is done, and nothing confirms that yet');
    assert.equal(canBeRequested('sponge'), true);
    assert.equal(canBeRequested('trees'), true);
    assert.equal(canBeRequested('cake'), true);
});

// --- what has to be filled in ----------------------------------------------

const priced = (bands: Record<string, any>) => ({ trade: 'sponge', prices: bands });

test('a blank band is a real answer, not a mistake', () => {
    const problems = pricingProblems(priced({ beds_1_2: { price: '60' } }));
    assert.deepEqual(problems, [], 'not covering 5-beds is allowed and says so by being blank');
});

test('pricing nothing at all is a problem — that provider reaches nobody', () => {
    const problems = pricingProblems(priced({}));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'prices');
});

test('a price that is not a number is caught', () => {
    const problems = pricingProblems(priced({ beds_1_2: { price: 'sixty' } }));
    assert.equal(problems.some((p: any) => p.field === 'price_beds_1_2'), true);
});

test('a negative or zero price is caught', () => {
    assert.equal(pricingProblems(priced({ beds_1_2: { price: '0' } })).some((p: any) => p.field === 'price_beds_1_2'), true);
    assert.equal(pricingProblems(priced({ beds_1_2: { price: '-10' } })).some((p: any) => p.field === 'price_beds_1_2'), true);
});

test('typical hours are optional', () => {
    assert.deepEqual(pricingProblems(priced({ beds_1_2: { price: '60' } })), []);
    assert.deepEqual(pricingProblems(priced({ beds_1_2: { price: '60', typical_hours: '2' } })), []);
    assert.deepEqual(pricingProblems(priced({ beds_1_2: { price: '60', typical_hours: '' } })), []);
});

test('typical hours that are not a number are caught', () => {
    const problems = pricingProblems(priced({ beds_1_2: { price: '60', typical_hours: 'a while' } }));
    assert.equal(problems.some((p: any) => p.field === 'hours_beds_1_2'), true);
});

test('maintenance needs both numbers', () => {
    assert.deepEqual(pricingProblems({ trade: 'spanner', callout_fee: '45', hourly_rate: '30' }), []);

    const noFee = pricingProblems({ trade: 'spanner', hourly_rate: '30' });
    assert.equal(noFee.some((p: any) => p.field === 'callout_fee'), true);

    const noRate = pricingProblems({ trade: 'spanner', callout_fee: '45' });
    assert.equal(noRate.some((p: any) => p.field === 'hourly_rate'), true);
});

test('a quote-per-job trade needs no prices at all', () => {
    assert.deepEqual(pricingProblems({ trade: 'cake' }), []);
});

// --- pricing is part of the one submit gate --------------------------------

const complete = {
    business_name: 'Solway Sparkle',
    trade: 'sponge',
    description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
    contact_email: 'hello@solwaysparkle.test',
    audience: 'host',
    areaCount: 1,
};

test('a cleaner cannot be sent for review with no prices', () => {
    const problems = submitProblems(complete);
    assert.equal(problems.some((p: any) => p.field === 'prices'), true,
        'pricing is not a separate gate — it is part of the one that already exists');
});

test('the same cleaner with one band priced can be sent', () => {
    const problems = submitProblems({ ...complete, prices: { beds_3_4: { price: '75' } } });
    assert.deepEqual(problems, []);
});

// --- the rule that keeps the total knowable before the job ------------------

test('typical hours never enter any calculation', () => {
    // Behavioural half: two drafts differing only in hours are indistinguishable
    // to everything that produces an answer.
    const withHours = { trade: 'sponge', prices: { beds_1_2: { price: '60', typical_hours: '2' } } };
    const without = { trade: 'sponge', prices: { beds_1_2: { price: '60' } } };
    const wildly = { trade: 'sponge', prices: { beds_1_2: { price: '60', typical_hours: '400' } } };

    assert.deepEqual(pricingProblems(withHours), pricingProblems(without));
    assert.deepEqual(pricingProblems(wildly), pricingProblems(without));
    assert.deepEqual(submitProblems({ ...complete, ...withHours }), submitProblems({ ...complete, ...without }));

    // Structural half: no line that touches hours may also multiply or divide.
    // An hourly total is exactly what put the price after the job in the first
    // place, and a behavioural test can only cover the code that exists today.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'lib', 'serviceProviders.ts'),
        'utf8'
    );

    const offending = src
        .split('\n')
        .map((line: string) => line.replace(/\/\/.*$/, ''))
        .filter((line: string) => /typical_hours|typicalHours|\bhours/i.test(line))
        .filter((line: string) => /[*\/]/.test(line));

    assert.deepEqual(offending, [],
        'hours are a guide shown to the host, never a term in a total');
});

// ---------------------------------------------------------------------------
// Two sign-ups, not one with a question.
//
// A business at the host sign-up can see it is for property owners, and the
// trade list in front of them only has host trades — so asking who they sell
// to asks them to confirm what the page already said. The audience comes from
// the trade instead, which also means the record cannot disagree with itself.
// ---------------------------------------------------------------------------

const {
    HOST_TRADES,
    GUEST_TRADES,
    tradesFor,
    audienceForTrade,
    TRADES,
} = require('@/lib/serviceProviders');

test('every trade belongs to exactly one sign-up', () => {
    for (const t of TRADES) {
        const inHost = HOST_TRADES.indexOf(t.key) !== -1;
        const inGuest = GUEST_TRADES.indexOf(t.key) !== -1;

        assert.equal(inHost || inGuest, true,
            t.key + ' is on neither sign-up, so nobody can ever choose it');
        assert.equal(inHost && inGuest, false,
            t.key + ' is on both, so the audience it implies is ambiguous');
    }
});

test('the host sign-up offers the property trades and nothing else', () => {
    const keys = tradesFor('host').map((t: any) => t.key);

    assert.deepEqual(keys.slice().sort(), ['bin', 'droplet', 'spanner', 'sponge', 'trees']);
    assert.equal(keys.indexOf('cake'), -1, 'a baker is not supplying a property owner');
    assert.equal(keys.indexOf('chef'), -1);
});

test('the guest sign-up offers the experience trades', () => {
    const keys = tradesFor('guest').map((t: any) => t.key);

    assert.deepEqual(keys.slice().sort(), ['basket', 'cake', 'chef', 'paw']);
    assert.equal(keys.indexOf('sponge'), -1, 'a changeover clean is not bought by a guest');
});

test('the audience is derived from the trade, never asked', () => {
    assert.equal(audienceForTrade('sponge'), 'host');
    assert.equal(audienceForTrade('bin'), 'host');
    assert.equal(audienceForTrade('trees'), 'host');
    assert.equal(audienceForTrade('spanner'), 'host');
    assert.equal(audienceForTrade('droplet'), 'host');

    assert.equal(audienceForTrade('cake'), 'guest');
    assert.equal(audienceForTrade('chef'), 'guest');
});

test('an unknown trade yields no audience rather than a wrong one', () => {
    assert.equal(audienceForTrade('nonsense'), '',
        'guessing here would file a business into the wrong shop silently');
});

test('every banded trade is a host trade', () => {
    for (const t of TRADES) {
        if (pricingModelFor(t.key) === 'bands') {
            assert.equal(HOST_TRADES.indexOf(t.key) !== -1, true,
                t.key + ' is banded on a property, so it cannot be a guest trade');
        }
    }
});
