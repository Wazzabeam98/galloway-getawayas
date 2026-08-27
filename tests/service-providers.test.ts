// The rules a provider sign-up is held to, and the distance maths that decides
// who gets shown to whom.
//
// Worth testing before there is any UI on top: coversPoint is what will decide
// whether a baker in Dumfries is offered to a cottage in Stranraer, and a sign
// error in it would be invisible on screen and wrong in every result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    submitProblems,
    canSubmit,
    milesBetween,
    coversPoint,
    tradeLabel,
    TRADES,
    TRADE_GROUPS,
    planForTrade,
    pricingModelFor,
    commissionRateFor,
    trialEndsAt,
    trialActive,
    planTerms,
    TRIAL_DAYS,
    SUBSCRIPTION_MONTHLY,
} = require('@/lib/serviceProviders');

const complete = {
    business_name: 'Solway Sparkle',
    trade: 'sponge',
    description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
    contact_email: 'hello@solwaysparkle.test',
    audience: 'host',
    areaCount: 1,
    // A banded trade has to price at least one band before it can be sent.
    // See tests/service-pricing.test.ts for the rule itself.
    prices: { beds_1_2: { price: '60' } },
};

test('a complete application can be sent', () => {
    assert.deepEqual(submitProblems(complete), []);
    assert.equal(canSubmit(complete), true);
});

test('each missing piece is named, and named once', () => {
    const problems = submitProblems({});
    const fields = problems.map((p: any) => p.field).sort();

    // No trade means no pricing shape, so pricing has nothing to complain
    // about yet — the trade problem stands in for it.
    assert.deepEqual(fields, ['areas', 'audience', 'business_name', 'contact_email', 'description', 'trade']);
    assert.equal(new Set(fields).size, fields.length, 'no field should be reported twice');
});

test('covering nowhere is a problem — that is how a provider reaches nobody', () => {
    const problems = submitProblems({ ...complete, areaCount: 0 });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'areas');
});

test('a one-word description is not a description', () => {
    const problems = submitProblems({ ...complete, description: 'Cleaning.' });
    assert.equal(problems.some((p: any) => p.field === 'description'), true);
});

test('an email without an @ is caught', () => {
    const problems = submitProblems({ ...complete, contact_email: 'hello.solwaysparkle.test' });
    assert.equal(problems.some((p: any) => p.field === 'contact_email'), true);
});

// Kirkcudbright to Castle Douglas is about 10 miles by road and a little under
// 9 as the crow flies. Real coordinates, so a sign error or a radians mistake
// shows up as a wildly wrong number rather than a plausible one.
const KIRKCUDBRIGHT = { lat: 54.8362, lng: -4.0530 };
const CASTLE_DOUGLAS = { lat: 54.9375, lng: -3.9319 };
const STRANRAER = { lat: 54.9021, lng: -5.0269 };

test('distance between two real towns is right', () => {
    const d = milesBetween(KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng);
    assert.ok(d > 7 && d < 10, 'Kirkcudbright to Castle Douglas should be 7-10 miles, got ' + d);
});

test('distance is the same measured either way', () => {
    const there = milesBetween(KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng, STRANRAER.lat, STRANRAER.lng);
    const back = milesBetween(STRANRAER.lat, STRANRAER.lng, KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng);
    assert.equal(Math.round(there), Math.round(back));
});

test('a point is nought miles from itself', () => {
    assert.equal(Math.round(milesBetween(54.8362, -4.053, 54.8362, -4.053)), 0);
});

test('a ten mile radius from Kirkcudbright reaches Castle Douglas but not Stranraer', () => {
    const areas = [{ centre_lat: KIRKCUDBRIGHT.lat, centre_lng: KIRKCUDBRIGHT.lng, radius_miles: 10 }];

    assert.equal(coversPoint(areas, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng), true);
    assert.equal(coversPoint(areas, STRANRAER.lat, STRANRAER.lng), false,
        'Stranraer is roughly 37 miles away and must not be covered');
});

test('two circles cover two towns without covering the gap', () => {
    const areas = [
        { centre_lat: KIRKCUDBRIGHT.lat, centre_lng: KIRKCUDBRIGHT.lng, radius_miles: 4 },
        { centre_lat: STRANRAER.lat, centre_lng: STRANRAER.lng, radius_miles: 4 },
    ];

    assert.equal(coversPoint(areas, KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng), true);
    assert.equal(coversPoint(areas, STRANRAER.lat, STRANRAER.lng), true);
    assert.equal(coversPoint(areas, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng), false,
        'the middle is not covered just because both ends are');
});

test('no areas covers nothing', () => {
    assert.equal(coversPoint([], KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng), false);
});

test('an unknown trade still reads as something', () => {
    assert.equal(tradeLabel('sponge'), 'Cleaning');
    assert.equal(tradeLabel('nonsense'), 'Service');
});

// ---------------------------------------------------------------------------
// WHAT A PROVIDER PAYS
//
// This block used to say there was no trial and nothing to test. There is one
// again: 90 free days from approval, then £20 a month, for the six trades
// whose work is quoted on site and paid off-platform. Everything else is 10%
// of a job the platform charges the customer for.
//
// The old warning still stands and is why these tests exist in this shape: a
// trial that is measured somewhere nobody looks becomes a promise nobody
// meant to make. So the clock is asserted to start at approval and nowhere
// else, and the words are asserted to come from the same constants as the
// number.
// ---------------------------------------------------------------------------

test('the plan map and the maintenance group are the same six trades', () => {
    // The checkable rule behind the map: subscription where the work is
    // quoted on site and paid off-platform, which is exactly the maintenance
    // group. Written out rather than derived — deriving it would key money
    // off a value free to be re-shuffled for other reasons — but held to the
    // group here so the two cannot drift apart unnoticed.
    const subscription = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => planForTrade(trade) === 'subscription')
        .sort();

    const maintenance = TRADE_GROUPS
        .filter((g: any) => g.key === 'maintenance')
        .flatMap((g: any) => g.trades as string[])
        .slice()
        .sort();

    assert.deepEqual(subscription, maintenance);
    assert.equal(subscription.length, 6);
});

test('every trade has a plan, and the guest trades are all commission', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        const plan = planForTrade(trade);
        assert.equal(plan === 'commission' || plan === 'subscription', true, trade + ' has a plan');
    }

    // The trap in "quoted trades go on the subscription": pricingModelFor
    // returns 'quoted' for all four of these as well, so deriving the plan
    // from it would have put a cake baker on £20 a month.
    for (const trade of ['chef', 'cake', 'basket', 'paw']) {
        assert.equal(planForTrade(trade), 'commission', trade + ' sells through the site');
        assert.equal(pricingModelFor(trade), 'quoted',
            trade + ' is quoted, which is exactly why the plan is not read off the pricing model');
    }
});

test('an unplaced trade falls to commission, not to a subscription', () => {
    // Commission bills nothing until there is a job. A subscription default
    // would start a clock on somebody who never agreed to one.
    assert.equal(planForTrade('nonsense'), 'commission');
    assert.equal(planForTrade(''), 'commission');
});

test('a subscription provider is 0%, whatever the column says', () => {
    // The column defaults to 0.10 and the row is written from the browser, so
    // a plumber's row is carrying 0.10 until something overwrites it. Reading
    // the plan rather than the column is what stops that becoming a charge.
    assert.equal(commissionRateFor({ trade: 'plumber', plan: 'subscription', commission_rate: 0.10 }), 0);
    assert.equal(commissionRateFor({ trade: 'roofer', plan: 'subscription', commission_rate: 0.25 }), 0);
});

test('every subscription trade resolves to nothing per job', () => {
    for (const trade of TRADES.map((t: any) => t.key).filter((t: string) => planForTrade(t) === 'subscription')) {
        // Stale rate on the row, no plan stamped yet — the worst case, and
        // the one an enquiry would snapshot if it were built today.
        assert.equal(commissionRateFor({ trade, commission_rate: 0.10 }), 0,
            trade + ' pays nothing per job');
    }
});

test('a commission provider keeps the rate on their row', () => {
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission', commission_rate: 0.10 }), 0.10);
    // Snapshotting is the point: a rate somebody agreed to is not rewritten
    // when the default moves.
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission', commission_rate: 0.08 }), 0.08);
    // A genuine zero is a rate, not a missing value.
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission', commission_rate: 0 }), 0);
});

test('a commission provider with no rate falls back rather than charging nothing', () => {
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission' }), 0.10);
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission', commission_rate: null }), 0.10);
});

test('the trial is ninety days, counted in days rather than months', () => {
    const end = trialEndsAt('2026-08-27T09:00:00.000Z');

    // 27 August + 90 days = 25 November. Months vary in length; the promise
    // is a number of days, so the arithmetic has to be too.
    assert.equal(end, '2026-11-25T09:00:00.000Z');
    assert.equal(TRIAL_DAYS, 90);
});

test('the trial clock crosses a month end and a leap year without drifting', () => {
    assert.equal(trialEndsAt('2026-12-15T00:00:00.000Z'), '2027-03-15T00:00:00.000Z');
    assert.equal(trialEndsAt('2027-12-15T00:00:00.000Z'), '2028-03-14T00:00:00.000Z');
});

test('a running trial is only a thing a subscription provider can have', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const ends = '2026-11-25T00:00:00.000Z';

    assert.equal(trialActive({ plan: 'subscription', trial_ends_at: ends }, now), true);
    assert.equal(trialActive({ plan: 'subscription', trial_ends_at: '2026-08-01T00:00:00.000Z' }, now), false,
        'a date that has passed is not a free period');
    assert.equal(trialActive({ plan: 'commission', trial_ends_at: ends }, now), false,
        'a commission row carrying a date is not owed free months');
    assert.equal(trialActive({ plan: 'subscription', trial_ends_at: null }, now), false);
    assert.equal(trialActive(null, now), false);
});

test('what a provider is told they will pay comes from the same numbers', () => {
    const plumber = planTerms('plumber');
    assert.match(plumber, new RegExp(String(TRIAL_DAYS) + ' days'));
    assert.match(plumber, new RegExp('£' + String(SUBSCRIPTION_MONTHLY) + ' a month'));
    assert.equal(plumber.indexOf('10%'), -1, 'a subscription trade is not told about commission');

    const cleaner = planTerms('sponge');
    assert.match(cleaner, /10%/);
    assert.equal(cleaner.indexOf('a month'), -1, 'a commission trade is not told about a subscription');
});

test('nothing anywhere still charges per enquiry', () => {
    // The £15 per-accepted-enquiry lead fee was dropped before it reached the
    // code. This is the guard against it arriving later by habit: there is one
    // commission model and one subscription model, and neither is per enquiry.
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'lib', 'serviceProviders.ts'), 'utf8'
    );

    assert.equal(/per[- ]enquiry|lead[_ ]fee|leadFee/i.test(src), false,
        'no per-enquiry charge has crept back into the rules');
});
