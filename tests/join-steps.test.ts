// The shape of the stepped sign-up.
//
// The rule this file exists for: a step with nothing to ask does not render
// and is not counted. A cleaner has no registration number and no skills, so
// she has four steps and the indicator says four.
//
// Worth testing before there is any UI on top, and worth testing here rather
// than in a browser: the indicator, Next, Back, the restore and the validation
// all ask the same functions, so if these are right the only thing left to
// check on screen is that it looks right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    stepsFor,
    stepApplies,
    stepCount,
    stepNumber,
    nextStep,
    previousStep,
    isLastStep,
    resolveStep,
    stepForField,
    problemsOnStep,
    firstStepWithProblem,
} = require('@/lib/joinSteps');

const { TRADES, submitProblems, planForTrade } = require('@/lib/serviceProviders');

const keys = (trade: string) => stepsFor(trade).map((s: any) => s.key);

// --- which steps exist ------------------------------------------------------

test('a cleaner sees four steps, and the missing one is not counted', () => {
    // The example the whole rule comes from. No registration number, no
    // skills, so no third step at all.
    assert.deepEqual(keys('sponge'), ['trade', 'business', 'prices', 'finish']);
    assert.equal(stepCount('sponge'), 4);

    // And the numbering closes up behind it. This is the part an indicator
    // gets wrong: "step 4 of 5" on the last page of four.
    assert.equal(stepNumber('sponge', 'prices'), 3);
    assert.equal(stepNumber('sponge', 'finish'), 4);
    assert.equal(stepNumber('sponge', 'credentials'), 0, 'a step she does not have has no number');
});

test('a plumber sees all five', () => {
    assert.deepEqual(keys('plumber'), ['trade', 'business', 'credentials', 'prices', 'finish']);
    assert.equal(stepCount('plumber'), 5);
    assert.equal(stepNumber('plumber', 'finish'), 5);
});

test('the three trades with paperwork or skills are the only ones with that step', () => {
    const withCredentials = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => stepApplies('credentials', trade));

    // The electrician for Part P, the plumber for gas and oil, the handyman
    // for skills. Nobody else is asked anything on that step, so nobody else
    // should be shown it.
    assert.deepEqual(withCredentials.sort(), ['electrician', 'handyman', 'plumber']);
});

test('the guest trades have no prices step either, so they see four', () => {
    // A chef quotes per job and has no extras to offer. A step containing one
    // heading and nothing under it is the thing this rule is against.
    for (const trade of ['chef', 'cake', 'basket', 'paw']) {
        assert.deepEqual(keys(trade), ['trade', 'business', 'finish'], trade + ' has three steps');
        assert.equal(stepCount(trade), 3);
    }
});

test('a quoted host trade keeps its prices step for the extras alone', () => {
    // A roofer sets no price -- a re-slate cannot be sized in advance -- but
    // has sixteen extras to say yes or no to, so there is a step's work there.
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.equal(stepApplies('prices', trade), true, trade + ' has extras to offer');
    }
});

test('every trade has a first and a last step and no empty flow', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        const steps = keys(trade);

        assert.equal(steps.length >= 3, true, trade + ' has at least three steps');
        assert.equal(steps[0], 'trade', trade + ' starts at the trade');
        assert.equal(steps[steps.length - 1], 'finish', trade + ' ends at the account');
        assert.equal(new Set(steps).size, steps.length, trade + ' has no step twice');
    }
});

test('the last step is the same one for everybody, whatever they skipped', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        assert.equal(isLastStep(trade, 'finish'), true, trade + ' finishes on the account step');
        assert.equal(isLastStep(trade, 'business'), false, trade + ' does not finish on the business step');
    }
});

// --- moving about -----------------------------------------------------------

test('next skips the step a cleaner does not have', () => {
    // The bug this is against: Next landing on a blank panel between the
    // business and the prices.
    assert.equal(nextStep('sponge', 'business'), 'prices');
    assert.equal(nextStep('plumber', 'business'), 'credentials');
});

test('back skips it too, so the way out is the way in reversed', () => {
    assert.equal(previousStep('sponge', 'prices'), 'business');
    assert.equal(previousStep('plumber', 'prices'), 'credentials');
});

test('the ends stay where they are rather than falling off', () => {
    assert.equal(previousStep('sponge', 'trade'), 'trade');
    assert.equal(nextStep('sponge', 'finish'), 'finish');
});

test('next and back are the exact reverse of one another, for every trade', () => {
    for (const trade of TRADES.map((t: any) => t.key)) {
        const steps = keys(trade);

        for (let i = 0; i < steps.length - 1; i++) {
            const forward = nextStep(trade, steps[i]);
            assert.equal(forward, steps[i + 1], trade + ': next from ' + steps[i]);
            assert.equal(previousStep(trade, forward), steps[i],
                trade + ': back from ' + forward + ' returns to ' + steps[i]);
        }
    }
});

// --- coming back ------------------------------------------------------------

test('somebody comes back to the step they left', () => {
    assert.equal(resolveStep('plumber', 'credentials'), 'credentials');
    assert.equal(resolveStep('sponge', 'prices'), 'prices');
});

test('a step that no longer exists lands on the last one that does', () => {
    // Left on the registration step as a plumber, came back having changed
    // trade to cleaner. The step is gone. Landing on a blank panel or throwing
    // are both worse than landing where their work actually got to.
    assert.equal(resolveStep('sponge', 'credentials'), 'finish');
});

test('a draft with no step and no trade starts at the beginning', () => {
    assert.equal(resolveStep('', null), 'trade');
    assert.equal(resolveStep('', 'prices'), 'trade');
    assert.equal(resolveStep('sponge', null), 'finish',
        'a saved draft with a trade has been worked on, so it does not restart');
});

test('nonsense in storage does not strand anybody', () => {
    assert.equal(resolveStep('sponge', 'not-a-step'), 'finish');
    assert.equal(resolveStep('sponge', undefined), 'finish');
});

// --- which step an error is on ----------------------------------------------

test('every field a validation can complain about belongs to a step', () => {
    // The guard. A problem whose field maps to no step would be an error
    // nothing displays and Next would never refuse on -- somebody would press
    // send on the last step and be told no, with nothing on screen saying why.
    //
    // Built from the worst draft there is: empty, for the trade that asks the
    // most, so every branch of submitProblems fires at once.
    const problems = submitProblems({
        business_name: '', trade: 'plumber', description: '', contact_email: '',
        audience: 'host', areaCount: 0, prices: {}, callout_fee: '', hourly_rate: '',
        callout_waived: false, extras: {}, does_gas: true, does_oil: true,
        registrations: [],
    });

    assert.equal(problems.length > 0, true, 'an empty form has problems');

    for (const problem of problems) {
        assert.notEqual(stepForField(problem.field), null,
            problem.field + ' has a step to appear on');
    }
});

test('problems are sliced by step, not shown all at once', () => {
    const problems = [
        { field: 'business_name', message: 'a' },
        { field: 'areas', message: 'b' },
        { field: 'registration_gas_safe', message: 'c' },
        { field: 'price_beds_1_2', message: 'd' },
        { field: 'extra_price_clean_oven', message: 'e' },
    ];

    assert.deepEqual(problemsOnStep(problems, 'business').map((p: any) => p.field),
        ['business_name', 'areas']);
    assert.deepEqual(problemsOnStep(problems, 'credentials').map((p: any) => p.field),
        ['registration_gas_safe']);
    assert.deepEqual(problemsOnStep(problems, 'prices').map((p: any) => p.field),
        ['price_beds_1_2', 'extra_price_clean_oven']);

    // Nothing is validated on the last step. The tick box is its own thing and
    // the photos are optional, so arriving there should never be refused.
    assert.deepEqual(problemsOnStep(problems, 'finish'), []);
});

test('the generated field names match by prefix rather than by a list', () => {
    // Bands, schemes and extras all generate their field names. A hardcoded
    // list would go stale the first time one is added.
    assert.equal(stepForField('price_beds_5_plus'), 'prices');
    assert.equal(stepForField('hours_plot_grounds'), 'prices');
    assert.equal(stepForField('registration_part_p'), 'credentials');
    assert.equal(stepForField('registration_oftec'), 'credentials');
    assert.equal(stepForField('extra_price_anything_at_all'), 'prices');
    assert.equal(stepForField('something_invented'), null);
});

test('send is told which step to open, and it is the earliest one', () => {
    const problems = [
        { field: 'price_beds_1_2', message: 'd' },
        { field: 'business_name', message: 'a' },
    ];

    // Earliest in the flow, not first in the list -- somebody sent to the
    // prices to fix a name would have to find their own way back.
    assert.equal(firstStepWithProblem('sponge', problems), 'business');
    assert.equal(firstStepWithProblem('sponge', []), null);
});

test('a problem on a step this trade skips is not lost silently', () => {
    // A cleaner has no credentials step, so a registration problem could never
    // be shown. It must also be impossible to produce -- otherwise send would
    // refuse with nowhere to send them.
    const problems = submitProblems({
        business_name: 'Solway Sparkle', trade: 'sponge',
        description: 'Changeover cleans for holiday cottages across the Stewartry, seven days.',
        contact_email: 'hello@solwaysparkle.test', audience: 'host', areaCount: 1,
        prices: { beds_1_2: { price: '80', typical_hours: '' } },
        callout_fee: '', hourly_rate: '', callout_waived: false, extras: {},
        does_gas: false, does_oil: false, registrations: [],
    });

    for (const problem of problems) {
        const step = stepForField(problem.field);
        assert.equal(stepApplies(step, 'sponge'), true,
            problem.field + ' is on a step a cleaner can actually see');
    }
});

test('a subscription trade is not asked for a price it does not set', () => {
    // Crossing the two models: these three are on the subscription and set no
    // band prices, so their prices step is extras and a call-out fee only.
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.equal(planForTrade(trade), 'subscription');
        const problems = submitProblems({
            business_name: 'A Firm', trade,
            description: 'Long enough a description to pass the length check on the form itself.',
            contact_email: 'a@b.test', audience: 'host', areaCount: 1, prices: {},
            callout_fee: '', hourly_rate: '', callout_waived: false, extras: {},
            does_gas: false, does_oil: false, registrations: [],
        });

        assert.deepEqual(problemsOnStep(problems, 'prices'), [],
            trade + ' is not held up over a price it never sets');
    }
});
