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
    isTradeComingSoon,
    comingSoonNote,
    pickerEntries,
    canBeBooked,
    planForTrade,
    pricingModelFor,
    commissionRateFor,
    trialEndsAt,
    trialActive,
    trialState,
    shouldStartTrial,
    planTerms,
    TRIAL_MONTHS,
    TRIAL_PERIOD_LABEL,
    SUBSCRIPTION_MONTHLY,
    slotAsksWhereFork,
    slotIsMeetingPoint,
    defaultSlotFulfilment,
} = require('@/lib/serviceProviders');

// The slot location fork, per category. Only three either-way categories are
// asked where it happens; the rest default to come-to-me. Two of those defaults
// are meeting points (a place, not premises) — copy only, but it drives which
// wording the address screen shows.
test('the slot where-fork is asked for exactly yoga, massage and painting', () => {
    for (const c of ['yoga', 'massage', 'painting']) {
        assert.equal(slotAsksWhereFork(c), true, c + ' is asked');
        assert.equal(defaultSlotFulfilment(c), '', c + ' has no default (the fork asks)');
    }
    // Every other slot category defaults to come-to-me and is not asked.
    for (const c of ['tastings', 'cooking', 'sauna', 'pottery', 'workshops', 'outdoors', 'water']) {
        assert.equal(slotAsksWhereFork(c), false, c + ' is not asked');
        assert.equal(defaultSlotFulfilment(c), 'collection', c + ' defaults to come-to-me');
    }
});

test('meeting-point copy is used for the two outdoor slot categories only', () => {
    assert.equal(slotIsMeetingPoint('outdoors'), true);
    assert.equal(slotIsMeetingPoint('water'), true);
    for (const c of ['tastings', 'cooking', 'sauna', 'pottery', 'workshops', 'yoga', 'massage', 'painting']) {
        assert.equal(slotIsMeetingPoint(c), false, c + ' is premises, not a meeting point');
    }
});

test('a non-slot category has no slot fulfilment default (its own fork or none)', () => {
    // Made-to-order forks on its own screen; comes-to-you doesn't use the field.
    assert.equal(defaultSlotFulfilment('chef'), '');        // comes_to_you
    assert.equal(defaultSlotFulfilment('food_order'), '');  // made_to_order
    assert.equal(defaultSlotFulfilment('other'), '');       // no shape
    assert.equal(defaultSlotFulfilment(null), '');
});

const complete = {
    business_name: 'Solway Joinery',
    trade: 'joiner',
    // A host trade no longer types a free-text description — its "about you" is
    // the expertise hub, whose required field is the professional title. The
    // stored description is derived from the hub. So a complete host application
    // gives a title, not a paragraph.
    professional_title: 'Joiner and kitchen fitter',
    contact_email: 'hello@solwayjoinery.test',
    audience: 'host',
    areaCount: 1,
    // Every trade needs a way to price now: a quote, an hourly rate or a flat
    // fee. See tests/service-pricing.test.ts for the rule itself.
    provides_quote: true,
};

test('a complete application can be sent', () => {
    assert.deepEqual(submitProblems(complete), []);
    assert.equal(canSubmit(complete), true);
});

test('each missing piece is named, and named once', () => {
    const problems = submitProblems({});
    const fields = problems.map((p: any) => p.field).sort();

    // No trade means no pricing shape, so pricing has nothing to complain about
    // yet — the trade problem stands in for it. An empty draft is treated as a
    // host trade (no guest sentinel), so its "about you" gate is the professional
    // title, not a description.
    assert.deepEqual(fields, ['areas', 'audience', 'business_name', 'contact_email', 'professional_title', 'trade']);
    assert.equal(new Set(fields).size, fields.length, 'no field should be reported twice');
});

test('covering nowhere is a problem — that is how a provider reaches nobody', () => {
    const problems = submitProblems({ ...complete, areaCount: 0 });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'areas');
});

test('a host trade with no professional title is refused', () => {
    // The host "about you" is the expertise hub now, and its one required field
    // is the professional title. A blank title is what a missing description used
    // to be — the thing that holds up an otherwise complete application.
    const problems = submitProblems({ ...complete, professional_title: '' });
    assert.equal(problems.some((p: any) => p.field === 'professional_title'), true);
    // A single character is not a title; two or more is fine.
    assert.equal(submitProblems({ ...complete, professional_title: 'x' }).some((p: any) => p.field === 'professional_title'), true);
    assert.deepEqual(submitProblems({ ...complete, professional_title: 'Roofer' }), []);
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
// The rule is now asserted as the rule: every host trade except cleaning is on
// the subscription (waste joined it on 28 September 2026). Looped over
// HOST_TRADES rather than a list, so a trade added to the picker cannot arrive
// without a plan.
test('every host trade except cleaning is on the subscription', () => {
    const exceptions = COMMISSION_HOST_TRADES as unknown as string[];

    for (const trade of HOST_TRADES as unknown as string[]) {
        const expected = exceptions.indexOf(trade) === -1 ? 'subscription' : 'commission';

        assert.equal(planForTrade(trade), expected,
            trade + ' is on the ' + expected + ' plan');
    }
});

test('the one exception is the one named, and it is a real host trade', () => {
    // Guards the exception list itself. Without this, emptying it would put
    // every host trade on the subscription and the loop above would still
    // pass, because it takes its expectation from the same list. Waste came off
    // this list on 28 September 2026, leaving cleaning alone.
    assert.deepEqual((COMMISSION_HOST_TRADES as unknown as string[]).slice().sort(), ['sponge']);

    for (const trade of COMMISSION_HOST_TRADES as unknown as string[]) {
        assert.equal((HOST_TRADES as unknown as string[]).indexOf(trade) !== -1, true,
            trade + ' is a host trade');
    }
});

test('ten host trades pay a subscription and one pays commission', () => {
    // The count, stated plainly, so a trade quietly changing sides shows up as
    // a number rather than as nothing. "Something else" (other) joined on the
    // subscription, so the split is ten to one now.
    const host = HOST_TRADES as unknown as string[];
    const subscription = host.filter((t) => planForTrade(t) === 'subscription');
    const commission = host.filter((t) => planForTrade(t) === 'commission');

    assert.equal(subscription.length, 10);
    assert.deepEqual(commission.sort(), ['sponge']);
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
    // returns 'quoted' for these as well, so deriving the plan from it would
    // have put a cake baker on £20 a month. ("Other" is a host trade and does
    // pay the subscription — it is exercised in the host-plan tests above.)
    for (const trade of ['chef', 'cake', 'basket']) {
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

test('the trial is six months, as a calendar span from the first enquiry', () => {
    // 27 August + 6 months = 27 February. It became six months on 28 September
    // 2026, and it is counted as calendar months so "six months" is literally
    // what a provider is given, not an approximate day count.
    assert.equal(trialEndsAt('2026-08-27T09:00:00.000Z'), '2027-02-27T09:00:00.000Z');
    assert.equal(TRIAL_MONTHS, 6);
    assert.equal(TRIAL_PERIOD_LABEL, 'six months');
});

test('six months clamps to the end of a short month rather than spilling over', () => {
    // 31 August + 6 months has no 31 February, so it lands on the last day of
    // February — the 28th, or the 29th in a leap year — not on 2 or 3 March.
    assert.equal(trialEndsAt('2026-08-31T00:00:00.000Z'), '2027-02-28T00:00:00.000Z');
    assert.equal(trialEndsAt('2027-08-31T00:00:00.000Z'), '2028-02-29T00:00:00.000Z');
});

test('the trial clock crosses a year end and a leap day without drifting', () => {
    assert.equal(trialEndsAt('2026-12-15T00:00:00.000Z'), '2027-06-15T00:00:00.000Z');
    assert.equal(trialEndsAt('2027-12-15T00:00:00.000Z'), '2028-06-15T00:00:00.000Z');
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
    assert.match(plumber, new RegExp(TRIAL_PERIOD_LABEL));
    assert.match(plumber, new RegExp('£' + String(SUBSCRIPTION_MONTHLY) + ' a month'));
    assert.equal(plumber.indexOf('10%'), -1, 'a subscription trade is not told about commission');

    const cleaner = planTerms('sponge');
    assert.match(cleaner, /10%/);
    assert.equal(cleaner.indexOf('a month'), -1, 'a commission trade is not told about a subscription');

    // Waste moved to the subscription on 28 September 2026, so it is told about
    // the £20 a month and never about a per-job commission.
    const waste = planTerms('bin');
    assert.match(waste, new RegExp('£' + String(SUBSCRIPTION_MONTHLY) + ' a month'));
    assert.equal(waste.indexOf('10%'), -1, 'waste is no longer told about a per-job commission');
});

// The two business decisions of 28 September 2026, pinned so neither can slide
// back unnoticed.
test('waste is on the subscription, exactly like the other subscription trades', () => {
    assert.equal(planForTrade('bin'), 'subscription', 'waste pays a subscription, not commission');
    assert.equal((COMMISSION_HOST_TRADES as unknown as string[]).indexOf('bin'), -1,
        'waste is not a commission host trade any more');
    // Same zero-per-job rate as every other subscription trade, even with a
    // stale 0.10 still sitting on the row.
    assert.equal(commissionRateFor({ trade: 'bin', commission_rate: 0.10 }), 0,
        'waste takes nothing per job');
});

test('cleaning is coming soon: browsable, but off the sign-up picker', () => {
    assert.equal(isTradeComingSoon('sponge'), true, 'cleaning is coming soon');
    assert.equal(isTradeComingSoon('bin'), false, 'waste is not coming soon');

    // Still a host trade, so it keeps appearing wherever trades are browsed.
    assert.equal((HOST_TRADES as unknown as string[]).indexOf('sponge') !== -1, true,
        'cleaning stays a host trade so it stays visible in the shop');
    assert.match(String(comingSoonNote('sponge')), /coming soon/i);

    // But it is not offered on the sign-up picker, so nobody new joins under it.
    const offered = pickerEntries([], 'host').map((e: any) => e.key);
    assert.equal(offered.indexOf('sponge'), -1, 'cleaning is not on the sign-up picker');
    assert.equal(offered.indexOf('bin') !== -1 || offered.indexOf('maintenance') !== -1, true,
        'other host trades are still offered');
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
