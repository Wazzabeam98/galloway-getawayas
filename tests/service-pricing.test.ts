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
    canBeBooked,
    canBeEnquiredAbout,
    calloutLine,
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

const MAINTENANCE_TRADES = ['electrician', 'joiner', 'plumber', 'roofer', 'painter', 'handyman'];

test('no maintenance trade can be priced by the size of the property', () => {
    // A leak is a leak whether the cottage has two bedrooms or five.
    for (const trade of MAINTENANCE_TRADES) {
        assert.deepEqual(bandsFor(trade), [], trade + ' has no size bands');
    }
});

test('the trades that bill by the hour, and the trades that quote', () => {
    // Turn up, diagnose, charge for the time.
    for (const trade of ['electrician', 'plumber', 'handyman']) {
        assert.equal(pricingModelFor(trade), 'callout_hourly', trade + ' bills by the hour');
    }

    // Look at it, then say what the job costs. These were callout_hourly,
    // which made an hourly rate compulsory before they could apply — and no
    // roofer prices a re-slate by the hour, so that number would have been
    // invented to get past the form.
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.equal(pricingModelFor(trade), 'quoted', trade + ' quotes per job');
    }
});

// The completeness guard. The tests above each name a trade for a reason of
// its own -- gardening is banded on the plot, window cleaning on bedrooms and
// not on panes -- and those names are the point of them. What was missing was
// anything that noticed a trade nobody had written a test for at all: a new
// entry in TRADES would have had no pricing coverage and nothing would have
// said so.
test('every trade prices in a shape that matches the bands it is given', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        const model = pricingModelFor(trade);
        const bands = bandsFor(trade);

        assert.equal(['bands', 'callout_hourly', 'quoted'].indexOf(model) !== -1, true,
            trade + ' has a known pricing model');

        // The two have to agree. Bands with no banded model is a set of prices
        // nothing reads; a banded model with no bands is a form with nothing
        // on it, and either way the provider cannot say what they charge.
        assert.equal(bands.length > 0, model === 'bands',
            trade + ' has bands exactly when it is banded');
    }
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

const HOST_KEYS = [
    'sponge', 'bin', 'trees', 'droplet',
    'electrician', 'joiner', 'plumber', 'roofer', 'painter', 'handyman',
];

test('somebody with nothing yet is offered every host trade', () => {
    const left = unclaimedTrades([], 'host').map((t: any) => t.key);
    assert.deepEqual(left.slice().sort(), HOST_KEYS.slice().sort());
});

test('a trade already signed up for is not offered again', () => {
    const left = unclaimedTrades([{ trade: 'sponge' }], 'host').map((t: any) => t.key);

    assert.equal(left.indexOf('sponge'), -1, 'they already have a cleaning business');
    assert.equal(left.length, HOST_KEYS.length - 1);
});

// The case the whole split exists for: one person, two trades, and nothing
// about holding one that stops them holding the other.
test('a plumber who also joins is offered neither again, and everything else still', () => {
    const left = unclaimedTrades([{ trade: 'plumber' }, { trade: 'joiner' }], 'host').map((t: any) => t.key);

    assert.equal(left.indexOf('plumber'), -1);
    assert.equal(left.indexOf('joiner'), -1);
    assert.equal(left.indexOf('roofer') !== -1, true, 'the other trades are untouched');
    assert.equal(left.length, HOST_KEYS.length - 2);
});

test('somebody with every trade is offered none', () => {
    const all = HOST_KEYS.map((trade) => ({ trade }));
    assert.deepEqual(unclaimedTrades(all, 'host'), []);
});

test('a guest-side business does not use up a host trade', () => {
    const left = unclaimedTrades([{ trade: 'cake' }], 'host').map((t: any) => t.key);
    assert.equal(left.length, HOST_KEYS.length, 'a baker has not signed up as a cleaner');
});

test('no providers at all is the same as none', () => {
    assert.equal(unclaimedTrades(null, 'host').length, HOST_KEYS.length);
    assert.equal(unclaimedTrades(undefined, 'host').length, HOST_KEYS.length);
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

// --- maintenance cannot be booked yet, and can be asked --------------------

test('no maintenance trade can be booked, however it is priced', () => {
    // This named only the plumber, and the rule underneath it was written as
    // "not priced by the hour" rather than "not maintenance". Moving the
    // roofer, the joiner and the painter to `quoted` flipped all three to
    // bookable — a job with no price, no total and no completion step — and
    // the suite stayed green, because none of them were named.
    //
    // So it loops, and the rule it checks is the one that was meant.
    //
    // The function was `canBeRequested` until phase two. Nothing it asserts
    // has changed value: the reason maintenance cannot be booked is still
    // that there is no quote, no total and nothing that observes a job
    // finishing. What changed is that "requested" became false as English —
    // a host CAN now request a plumber — so the old wording would have
    // asserted the opposite of what the site does while staying green.
    for (const trade of MAINTENANCE_TRADES) {
        assert.equal(canBeBooked(trade), false,
            trade + ' cannot be booked until quoting and completion exist');
    }

    assert.equal(canBeBooked('sponge'), true);
    assert.equal(canBeBooked('trees'), true);
    assert.equal(canBeBooked('cake'), true);
});

// The counterpart, and the reason there are two functions rather than one.
//
// If a refactor ever collapses them back together this fails, which is the
// point: the whole of phase two rests on the two answers being allowed to
// disagree about the same trade.
test('a maintenance trade cannot be booked and can be enquired about', () => {
    for (const trade of MAINTENANCE_TRADES) {
        assert.equal(canBeBooked(trade), false, trade + ' is not bookable');
        assert.equal(canBeEnquiredAbout(trade), true, trade + ' can be asked to come and look');
    }
});

test('what is not in the shop, and why', () => {
    // Cleaning and waste take 10% at acceptance. A commission needs a total,
    // a total needs a completion step, and that is a booking. They are not
    // late — they are somewhere else.
    assert.equal(canBeEnquiredAbout('sponge'), false, 'cleaning is booked, not enquired about');
    assert.equal(canBeEnquiredAbout('bin'), false, 'waste is booked, not enquired about');

    // Gardening is banded on listings.plot_band and NOTHING WRITES THAT
    // COLUMN — there is no field on the listing form. A gardener in the shop
    // would show every host a blank where the price goes.
    //
    // So this assertion is a note to whoever builds that field: add 'trees'
    // to SHOP_TRADES and delete this line, in the same change. It is the only
    // absence here that is waiting on work rather than on a decision.
    assert.equal(canBeEnquiredAbout('trees'), false, 'gardening waits for listings.plot_band');

    // The guest trades are sold to somebody on holiday and have their own
    // shop. Nothing about the host flow applies to them.
    for (const trade of ['chef', 'cake', 'basket', 'paw']) {
        assert.equal(canBeEnquiredAbout(trade), false, trade + ' is a guest trade');
    }
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

test('an hourly trade needs an hourly rate, and only that', () => {
    assert.deepEqual(pricingProblems({ trade: 'plumber', callout_fee: '45', hourly_rate: '30' }), []);

    // The call-out fee used to be compulsory here. Plenty of handymen charge
    // an hourly rate and no call-out, or a day rate — so requiring it made
    // them invent a number to get past the form, which is the same fault as
    // asking a roofer to price a re-slate by the hour.
    assert.deepEqual(pricingProblems({ trade: 'plumber', hourly_rate: '30' }), [],
        'a call-out fee is theirs to charge or not');

    const noRate = pricingProblems({ trade: 'plumber', callout_fee: '45' });
    assert.equal(noRate.some((p: any) => p.field === 'hourly_rate'), true,
        'the hourly rate IS the price for a trade that bills by the hour');
});

test('all three hourly trades are the same about it', () => {
    for (const trade of ['plumber', 'electrician', 'handyman']) {
        assert.deepEqual(pricingProblems({ trade, hourly_rate: '30' }), [],
            trade + ' can apply with no call-out fee');
        assert.equal(
            pricingProblems({ trade, callout_fee: '45' }).some((p: any) => p.field === 'hourly_rate'),
            true,
            trade + ' still needs an hourly rate'
        );
    }
});

// The mirror. A roofer with nothing filled in is a complete application: the
// job is quoted once they have seen it, and a call-out fee is theirs to charge
// or not.
test('a quoted trade needs no numbers at all', () => {
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.deepEqual(pricingProblems({ trade }), [], trade + ' can apply with nothing priced');
        assert.deepEqual(pricingProblems({ trade, callout_fee: '40' }), [],
            trade + ' can give a call-out fee and no hourly rate');
    }
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

    assert.deepEqual(keys.slice().sort(), [
        'bin', 'droplet', 'electrician', 'handyman', 'joiner',
        'painter', 'plumber', 'roofer', 'sponge', 'trees',
    ]);
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
    assert.equal(audienceForTrade('plumber'), 'host');
    assert.equal(audienceForTrade('roofer'), 'host');
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

// ---------------------------------------------------------------------------
// The call-out line a host reads.
//
// Worded in one place so the admin card and the directory cannot disagree, and
// because the waiver is the tradesman's own offer rather than a platform rule
// — it has to sit in the same sentence as the fee to read as an advantage
// rather than as a footnote.
// ---------------------------------------------------------------------------

test('a fee on its own says what it is', () => {
    assert.equal(calloutLine(40), '£40 call-out');
    assert.equal(calloutLine('40'), '£40 call-out');
});

test('a waived fee says so in the same breath', () => {
    assert.equal(calloutLine(40, true), '£40 call-out, waived if you go ahead');
});

test('no fee is nothing at all, not "none"', () => {
    // Not charging a call-out fee and not having said are different things,
    // and only one of them is ours to announce on somebody's behalf.
    assert.equal(calloutLine(null), null);
    assert.equal(calloutLine(undefined), null);
    assert.equal(calloutLine(''), null);
    assert.equal(calloutLine('   '), null);
    assert.equal(calloutLine(0), null);
});

test('a waiver with no fee behind it says nothing', () => {
    // The toggle only appears once a fee is typed, but a stale draft or an old
    // row could carry the tick without the number.
    assert.equal(calloutLine(null, true), null);
    assert.equal(calloutLine(0, true), null);
});

test('a nonsense fee is not shown to anybody', () => {
    assert.equal(calloutLine('about forty quid'), null);
    assert.equal(calloutLine(-40), null);
});

test('whole pounds read as whole pounds', () => {
    // "£40.00 call-out" reads like a system wrote it.
    assert.equal(calloutLine(40), '£40 call-out');
    assert.equal(calloutLine(37.5), '£37.50 call-out');
});
