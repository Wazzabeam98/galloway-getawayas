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
    HOST_TRADES,
    COMMISSION_HOST_TRADES,
    canBeBooked,
    planForTrade,
    pricingModelFor,
    commissionRateFor,
    trialEndsAt,
    trialActive,
    trialState,
    shouldStartTrial,
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
// again: 90 free days from approval, then £20 a month, for every host trade
// except cleaning and waste. Those two, and the four guest trades, are 10% of
// a job.
//
// The old warning still stands and is why these tests exist in this shape: a
// trial that is measured somewhere nobody looks becomes a promise nobody
// meant to make. So the clock is asserted to start at approval and nowhere
// else, and the words are asserted to come from the same constants as the
// number.
// ---------------------------------------------------------------------------

// This used to assert that the subscription trades and the maintenance group
// were the same six. That was true when it was written and wrong the moment
// gardening and window cleaning moved on 27 August 2026 — and it was the wrong
// shape either way, because the maintenance group is a heading on the trade
// picker and never was a billing concept. Holding money to it made it one by
// accident, which is the third time this file has been asked to read one thing
// as a stand-in for another.
//
// The rule is now asserted as the rule: every host trade except cleaning and
// waste is on the subscription. Looped over HOST_TRADES rather than a list, so
// a trade added to the picker cannot arrive without a plan.
test('every host trade except cleaning and waste is on the subscription', () => {
    const exceptions = COMMISSION_HOST_TRADES as unknown as string[];

    for (const trade of HOST_TRADES as unknown as string[]) {
        const expected = exceptions.indexOf(trade) === -1 ? 'subscription' : 'commission';

        assert.equal(planForTrade(trade), expected,
            trade + ' is on the ' + expected + ' plan');
    }
});

test('the two exceptions are the ones named, and they are real host trades', () => {
    // Guards the exception list itself. Without this, emptying it would put
    // every host trade on the subscription and the loop above would still
    // pass, because it takes its expectation from the same list.
    assert.deepEqual((COMMISSION_HOST_TRADES as unknown as string[]).slice().sort(), ['bin', 'sponge']);

    for (const trade of COMMISSION_HOST_TRADES as unknown as string[]) {
        assert.equal((HOST_TRADES as unknown as string[]).indexOf(trade) !== -1, true,
            trade + ' is a host trade');
    }
});

test('eight host trades pay a subscription and two pay commission', () => {
    // The count, stated plainly, so a trade quietly changing sides shows up as
    // a number rather than as nothing.
    const host = HOST_TRADES as unknown as string[];
    const subscription = host.filter((t) => planForTrade(t) === 'subscription');
    const commission = host.filter((t) => planForTrade(t) === 'commission');

    assert.equal(subscription.length, 8);
    assert.deepEqual(commission.sort(), ['bin', 'sponge']);
});

test('the maintenance group is not what decides the plan', () => {
    // The proxy, refused explicitly. Gardening and window cleaning are on the
    // subscription and are not maintenance trades, so anything reading the
    // group to answer a billing question now gets the wrong answer — and this
    // is here to say so out loud rather than leave the next person to find it.
    const maintenance = TRADE_GROUPS
        .filter((g: any) => g.key === 'maintenance')
        .flatMap((g: any) => g.trades as string[]);

    for (const trade of ['trees', 'droplet']) {
        assert.equal(planForTrade(trade), 'subscription', trade + ' pays a subscription');
        assert.equal(maintenance.indexOf(trade), -1, trade + ' is not a maintenance trade');
    }
});

// A consequence of the move, pinned because it is new.
//
// Until gardening and window cleaning changed sides, every subscription trade
// happened to be one nobody could book — they are all in the maintenance
// group, and canBeBooked excludes that whole group. So "subscription means
// nothing is ever booked" was accidentally true, and is the kind of thing that
// gets relied on without being written down.
//
// It is not true now. A gardening job is bookable and its provider pays no
// commission, so whatever builds bookings has to take the rate from
// commissionRateFor rather than assuming a bookable job is a chargeable one.
//
// This test said "requestable" and "a gardening enquiry" when it was written,
// which now reads as a claim about the enquiry flow — and would be wrong about
// gardening, which is not in it. Same assertions, accurate words.
test('a bookable trade can be on the subscription, and pays nothing per job', () => {
    for (const trade of ['trees', 'droplet']) {
        assert.equal(canBeBooked(trade), true, trade + ' can be booked');
        assert.equal(planForTrade(trade), 'subscription');
        assert.equal(commissionRateFor({ trade, commission_rate: 0.10 }), 0,
            trade + ' is requestable and still pays nothing per job');
    }

    // The pair it used to be safe to conflate.
    assert.equal(canBeBooked('sponge'), true);
    assert.equal(commissionRateFor({ trade: 'sponge', plan: 'commission', commission_rate: 0.10 }), 0.10);
});

test('every trade has a plan, and the guest trades are all commission', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        const plan = planForTrade(trade);
        assert.equal(plan === 'commission' || plan === 'subscription', true, trade + ' has a plan');
    }

    // The trap in "quoted trades go on the subscription": pricingModelFor
    // returns 'quoted' for all four of these as well, so deriving the plan
    // from it would have put a cake baker on £20 a month.
    for (const trade of ['chef', 'cake', 'basket', 'other']) {
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

// ---------------------------------------------------------------------------
// WHERE THE CLOCK STARTS
//
// At the first enquiry sent to him, not at approval. The rule lives here so it
// is testable without a database; the write is in the enquiry route, guarded
// on the column still being null so two enquiries in the same second cannot
// both stamp.
// ---------------------------------------------------------------------------

test('the first enquiry to an approved subscription provider starts his clock', () => {
    assert.equal(
        shouldStartTrial({ plan: 'subscription', status: 'approved', trial_ends_at: null }),
        true
    );
});

test('a second enquiry does not restart anything', () => {
    // The expensive bug this prevents: every enquiry pushing the free period
    // another ninety days out, so a busy tradesman never pays at all.
    assert.equal(
        shouldStartTrial({
            plan: 'subscription',
            status: 'approved',
            trial_ends_at: '2026-11-25T00:00:00.000Z',
        }),
        false,
        'the date he already has is the date that stands'
    );
});

test('a commission provider never starts a clock, however many enquiries he gets', () => {
    assert.equal(
        shouldStartTrial({ plan: 'commission', status: 'approved', trial_ends_at: null }),
        false
    );
});

test('an enquiry to somebody not approved starts nothing', () => {
    // An enquiry should only ever reach an approved provider. If that stops
    // being true, this must not be the place that quietly starts charging
    // somebody who was taken down.
    for (const status of ['draft', 'pending_review', 'declined', 'hidden']) {
        assert.equal(
            shouldStartTrial({ plan: 'subscription', status, trial_ends_at: null }),
            false,
            status + ' does not start a free period'
        );
    }

    assert.equal(shouldStartTrial(null), false);
});

// The bug this exists to make impossible: telling a plumber who has never had
// an enquiry that his free period has ended. `trialActive` answers false for
// "ended" and for "not started" alike, and those need different words now that
// a provider can sit in the second one for months.
test('a trial that has not started is a different state from one that has ended', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');

    assert.equal(
        trialState({ plan: 'subscription', trial_ends_at: null }, now),
        'not_started',
        'approved, waiting for his first lead'
    );
    assert.equal(
        trialState({ plan: 'subscription', trial_ends_at: '2026-11-25T00:00:00.000Z' }, now),
        'running'
    );
    assert.equal(
        trialState({ plan: 'subscription', trial_ends_at: '2026-08-01T00:00:00.000Z' }, now),
        'ended'
    );
    assert.equal(
        trialState({ plan: 'commission', trial_ends_at: null }, now),
        'not_applicable',
        'a cleaner has no free period to be in a state about'
    );
    assert.equal(trialState(null, now), 'not_applicable');

    // An unreadable date must not read as "your free period is over".
    assert.equal(
        trialState({ plan: 'subscription', trial_ends_at: 'not a date' }, now),
        'not_started'
    );
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
