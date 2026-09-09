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
    openingStep,
    openingVisited,
    sectionsFor,
    sectionForStep,
} = require('@/lib/joinSteps');

const {
    TRADES, submitProblems, planForTrade,
    capabilityFor, pricedOfferingsFor, showsRates, extrasFor, bandsFor,
    asksAboutFuel, asksAboutSkills, offerableSchemes,
    guestAsksExpertise, guestQualificationsRequired, guestYearsRequired,
} = require('@/lib/serviceProviders');

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

test('the joiner, roofer and painter went from four steps to five', () => {
    // Approved as the correction rather than the cost: their capability lists
    // were on a step headed "What you charge" where they set no price.
    for (const trade of ['joiner', 'roofer', 'painter']) {
        assert.deepEqual(keys(trade), ['trade', 'business', 'credentials', 'prices', 'finish'],
            trade + ' has all five');
        assert.equal(stepCount(trade), 5);
    }
});

test('the "what you do" step is exactly the six maintenance trades', () => {
    const withCredentials = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => stepApplies('credentials', trade));

    // It was three: the electrician for Part P, the plumber for gas and oil,
    // the handyman for skills. It is six now, because the capability lists
    // moved here off the prices step — the joiner, roofer and painter give no
    // registration and no skills but carry nine to sixteen capability entries
    // each, which were filed under "What you charge" where they set no price.
    assert.deepEqual(withCredentials.sort(),
        ['electrician', 'handyman', 'joiner', 'painter', 'plumber', 'roofer']);
});

test('registration and skills are never asked of the same trade', () => {
    // Why the step is not called "Registration". The electrician and plumber
    // give numbers, the handyman gives skills, and nobody does both — so a
    // step titled Registration was wrong for the handyman every single time,
    // not merely sometimes.
    for (const trade of TRADES.map((t: any) => t.key)) {
        const hasRegistration = asksAboutFuel(trade)
            || offerableSchemes({ trade, does_gas: true, does_oil: true }).length > 0;

        assert.equal(hasRegistration && asksAboutSkills(trade), false,
            trade + ' is asked for registration or skills, never both');
    }
});

test('capability sits on the step somebody can see it on, not with the prices', () => {
    // The regression this replaces: for all six maintenance trades there is
    // not one priced extra, so the whole of what a roofer saw under "What you
    // charge" was a list of roofs he can do.
    for (const trade of ['electrician', 'plumber', 'handyman', 'joiner', 'roofer', 'painter']) {
        assert.equal(capabilityFor(trade).length > 0, true, trade + ' has capability entries');
        assert.equal(stepApplies('credentials', trade), true, trade + ' has a step for them');
    }

    // Four of the six have no priced extra at all. The electrician and roofer
    // have exactly one each and it stays with the prices -- the split is per
    // entry, by what the entry is, not "maintenance goes here".
    for (const trade of ['plumber', 'handyman', 'joiner', 'painter']) {
        assert.deepEqual(pricedOfferingsFor(trade), [],
            trade + ' had nothing on the prices step but capability');
    }

    for (const trade of ['electrician', 'roofer']) {
        assert.equal(pricedOfferingsFor(trade).length, 1, trade + ' keeps its one priced entry');
    }
});

test('the two lists never overlap, for any trade', () => {
    // The guard on the split itself. An entry counted by both would render
    // twice, on two different steps; one counted by neither would vanish.
    for (const trade of TRADES.map((t: any) => t.key)) {
        const cap = capabilityFor(trade).map((e: any) => e.key);
        const priced = pricedOfferingsFor(trade).map((e: any) => e.key);

        for (const key of cap) {
            assert.equal(priced.indexOf(key), -1, key + ' is on one step, not both');
        }

        assert.equal(cap.length + priced.length, extrasFor(trade).length,
            trade + ': every extra lands on exactly one step');
    }
});

test('the joiner, roofer and painter still have a prices step for the call-out fee', () => {
    // They set no band price and now have no extras on that step, but they do
    // charge to turn out. Losing the step would lose the fee.
    for (const trade of ['joiner', 'roofer', 'painter']) {
        assert.equal(stepApplies('prices', trade), true, trade + ' still sets a call-out fee');
        assert.equal(showsRates(trade), true);
    }
});

test('the cleaner keeps her two toggles beside her prices rather than gaining a step', () => {
    // `about` is not capability. Two tick boxes -- own equipment, reports
    // damage with photos -- that read correctly next to her laundry and hot
    // tub prices, and would otherwise be a fifth step carrying nothing else.
    assert.deepEqual(capabilityFor('sponge'), []);
    assert.equal(pricedOfferingsFor('sponge').length > 0, true);
    assert.equal(stepApplies('credentials', 'sponge'), false, 'no step gained');
    assert.deepEqual(keys('sponge'), ['trade', 'business', 'prices', 'finish']);
});

test('the guest trades have no prices step either, so they see four', () => {
    // A chef quotes per job and has no extras to offer. A step containing one
    // heading and nothing under it is the thing this rule is against.
    for (const trade of ['chef', 'cake', 'basket', 'other']) {
        assert.deepEqual(keys(trade), ['trade', 'business', 'finish'], trade + ' has three steps');
        assert.equal(stepCount(trade), 3);
    }
});

test('a quoted host trade keeps its prices step for the call-out fee', () => {
    // A roofer sets no price -- a re-slate cannot be sized in advance -- and
    // since the capability lists moved off this step there are no extras here
    // either. What is left is the fee he charges to turn out, which is real.
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.equal(stepApplies('prices', trade), true, trade + ' charges to turn out');
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

test('no trade gets a prices step only for entries that never render', () => {
    // The trap this guards. `priced` entries -- the electrician's EICR fee and
    // the roofer's survey -- are counted by pricedOfferingsFor but nothing on
    // the form draws them, on the long page either. That is a real gap and a
    // separate one; what must not happen is a step existing solely because of
    // them, which would be a whole step with nothing on it.
    //
    // Both trades keep their prices step for the call-out fee instead, so the
    // gap costs a field rather than a page.
    for (const trade of ['electrician', 'roofer']) {
        assert.equal(pricedOfferingsFor(trade).length, 1);
        assert.equal(showsRates(trade), true,
            trade + ' has a prices step for the call-out fee, not for the invisible entry');
    }

    for (const trade of TRADES.map((t: any) => t.key)) {
        if (!stepApplies('prices', trade)) continue;

        const standsAlone = bandsFor(trade).length === 0
            && !showsRates(trade);

        assert.equal(standsAlone, false,
            trade + ': the prices step is justified by a band or a rate, not by extras alone');
    }
});

// ---------------------------------------------------------------------------
// Which step the form opens on
// ---------------------------------------------------------------------------
//
// This rule was a useEffect, and it turned a working application into one that
// looked broken. A successful send cleared `restored` to take the "your details
// have been saved" banner down; that released the only condition holding the
// rule back, it ran again, and it moved the applicant to the business step. The
// panel confirming the application only renders on the finish step, so nobody
// ever saw it — and a sent application and a refused one ended on the same
// screen.
//
// Indistinguishable success is the thing this flow exists to prevent, so the
// rule is tested rather than inferred from a dependency array.

test('a lodged application is never moved off the screen that says so', () => {
    // The regression, stated directly. Every combination that used to move
    // them, with `lodged` true.
    for (const restored of [true, false]) {
        for (const trade of ['joiner', 'sponge', '']) {
            assert.equal(
                openingStep({ hydrated: true, restored, lodged: true, trade }),
                'finish',
                `lodged must win: restored=${restored} trade=${trade || 'none'}`
            );
        }
    }
});

test('clearing the restored banner cannot move a lodged applicant', () => {
    // The exact transition that caused it: lodged, and `restored` going from
    // true to false underneath.
    const before = openingStep({ hydrated: true, restored: true, lodged: true, trade: 'joiner' });
    const after = openingStep({ hydrated: true, restored: false, lodged: true, trade: 'joiner' });

    assert.equal(before, 'finish');
    assert.equal(after, 'finish', 'the banner going away is not a reason to move them');
});

test('nothing moves before the load has finished', () => {
    assert.equal(openingStep({ hydrated: false, restored: false, lodged: false, trade: 'joiner' }), null);
    assert.equal(openingStep({ hydrated: false, restored: false, lodged: true, trade: 'joiner' }), null);
});

test('a restored draft decides for itself', () => {
    // resolveStep put them somewhere from the draft. This must not overrule it.
    assert.equal(openingStep({ hydrated: true, restored: true, lodged: false, trade: 'joiner' }), null);
});

test('a trade in the URL means step one is already answered', () => {
    assert.equal(openingStep({ hydrated: true, restored: false, lodged: false, trade: 'joiner' }), 'business');
    assert.equal(openingStep({ hydrated: true, restored: false, lodged: false, trade: '' }), 'trade');
});

test('what counts as seen matches where they land', () => {
    // The step they open on shows its own errors; steps ahead stay quiet.
    assert.deepEqual(openingVisited({ hydrated: true, restored: false, lodged: false, trade: '' }), []);
    assert.deepEqual(openingVisited({ hydrated: true, restored: false, lodged: false, trade: 'joiner' }), ['trade']);
    assert.equal(openingVisited({ hydrated: true, restored: true, lodged: false, trade: 'joiner' }), null);

    // A lodged application has been through all of them.
    const seen = openingVisited({ hydrated: true, restored: false, lodged: true, trade: 'joiner' });
    assert.equal(Array.isArray(seen) && seen.indexOf('finish') !== -1, true);
});

test('a guest with no session opens on the verify gate, before the picker', () => {
    // The account moved to the very front. Trade ('guest') is in the URL, but
    // with no session the first screen is g_verify — ahead of the category
    // picker, whatever else is or isn't answered.
    assert.equal(
        openingStep({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: true }),
        'g_verify',
    );
    assert.equal(
        openingStep({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: false }),
        'g_verify',
        'still the gate first, even with a category already picked',
    );
    // Nothing is behind the gate when they land on it.
    assert.deepEqual(
        openingVisited({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: true }),
        [],
    );
});

test('a signed-in guest skips the gate — the picker if no category, else the first content screen', () => {
    // A returning applicant, already signed in: the gate is behind them, so they
    // open on the category picker (no category yet) or straight on the content.
    assert.equal(
        openingStep({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: true, hasSession: true }),
        'trade',
    );
    assert.equal(
        // First content screen is the About-you opener for an expertise category.
        openingStep({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: false, hasSession: true, category: 'chef' }),
        'g_you',
    );
    assert.equal(
        // A sauna skips the expertise screens, so it opens on Location (g_area) —
        // its where-and-when step, which holds the weekly schedule — never g_you,
        // a step it does not have. This is the returning-sauna reorder fix.
        openingStep({ hydrated: true, restored: false, lodged: false, trade: 'guest', guestNeedsCategory: false, hasSession: true, category: 'sauna' }),
        'g_area',
    );
});

// --- the guest-experience split -------------------------------------------
//
// The guest is the one trade 'guest'. Its later steps branch on the category
// (its food flag) and the booking shape, passed in a StepContext. Without a
// context the split stays off, so the flow is exactly what it was before —
// this is what lets the component adopt it a piece at a time without breaking.

const gkeys = (ctx: any) => stepsFor('guest', ctx).map((s: any) => s.key);

test('a guest with no context still sees the old three steps', () => {
    // The migration safety net: no context, no split.
    assert.deepEqual(stepsFor('guest').map((s: any) => s.key), ['trade', 'business', 'finish']);
});

// The rebuilt flow, reordered to Airbnb's sequence and with the account gate
// moved to the VERY FRONT (Sep 2026). g_verify — the verify-your-email gate that
// makes the account — is the first screen of all, before the category picker:
// picking "Host a guest experience" on the fork lands them straight on it, and
// nothing comes before the account. Then the picker ('trade' group grid),
// g_subtype, and the content: About you (g_you, g_creds), Location (g_area)
// straight after, Photos (g_photos) BEFORE the writing, Pricing (g_menu),
// Details (g_expect), and the Finish screen (the account). The booking shape is
// inferred from the category and never a step; availability folds into g_area;
// dietary folds into g_expect; the business step is host-only (a guest's title
// is derived from the account). There is NO naming step, NO contact step (a
// guest signs in up front, so the account address is the contact address, and
// the phone lives on the profile) and NO checks step (the per-category checks
// collapsed to one responsibility confirmation folded onto the finish screen).
// So an anonymous applicant with a sub-type walks these ten keys — g_verify
// leading, because they have no session yet. A signed-in applicant skips
// g_verify (see the test below).
const TEN = [
    'g_verify', 'trade', 'g_subtype', 'g_you', 'g_creds', 'g_area', 'g_photos',
    'g_menu', 'g_expect', 'finish',
];

// A comes-to-you or slot category also has a max-guests step (g_capacity) at the
// head of the Pricing section, just before g_menu. A made-to-order product
// (cakes, hampers) and 'other' have no guest count, so they keep the ten.
const withCapacity = (keys: string[]) => {
    const out = keys.slice();
    out.splice(out.indexOf('g_menu'), 0, 'g_capacity');
    return out;
};

test('a chef (food, comes to them) walks the flow, with a capacity step, and never sees the business step', () => {
    const ctx = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    assert.deepEqual(gkeys(ctx), withCapacity(TEN));
    // The old "how do guests get it?" screen is gone — the shape is inferred.
    assert.equal(stepApplies('business', 'guest', ctx), false, 'a guest names it on g_about, not a business step');
    assert.equal(stepApplies('g_capacity', 'guest', ctx), true, 'a chef sets a largest group');
});

test('the verify gate leads the flow for an anonymous applicant and is gone once signed in', () => {
    // The account moved to the very front: an applicant with no session verifies
    // their email before the category picker, and everything after runs
    // authenticated. A returning applicant who is already signed in never sees it.
    const anon = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    assert.equal(stepApplies('g_verify', 'guest', anon), true, 'anonymous applicant must verify');
    assert.equal(gkeys(anon).indexOf('g_verify'), 0, 'the gate is the very first screen, before the picker');

    const signedIn = { ...anon, hasSession: true };
    assert.equal(stepApplies('g_verify', 'guest', signedIn), false, 'a signed-in applicant skips it');
    assert.equal(gkeys(signedIn).indexOf('g_verify'), -1, 'the gate is not in a signed-in flow');
    // Everything else is unchanged — the signed-in flow is the thirteen (plus
    // the chef's capacity step) minus g_verify.
    assert.deepEqual(gkeys(signedIn), withCapacity(TEN).filter((k) => k !== 'g_verify'));
});

test('a signed-in applicant is never resolved onto the verify gate by a restored draft', () => {
    // The bug: the restore path resolved a saved step with a context that left
    // hasSession out, so g_verify counted as a live step and a signed-in user
    // with any draft landed on the email screen. With the session carried, the
    // gate is not a step for them, so a draft saved on it resolves to a real one.
    const signedIn = { group: 'food', category: 'chef', shape: 'comes_to_you', hasSession: true };
    assert.equal(stepsFor('guest', signedIn).some((s: any) => s.key === 'g_verify'), false);
    assert.notEqual(resolveStep('guest', 'g_verify', signedIn), 'g_verify');
    // Anonymous is unchanged — the gate is still a real step it can rest on.
    const anon = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    assert.equal(resolveStep('guest', 'g_verify', anon), 'g_verify');
});

test('a cake maker (made to order) gets the years and expertise screens too', () => {
    // Made-to-order food was cut from these screens for a while, then brought
    // back: a cake maker has a track record and a story worth showing. So it
    // walks the full flow now, with g_you and g_creds. The lead time it needs
    // lives inside the where-and-when step, not a screen of its own.
    const ctx = { group: 'food', category: 'food_order', shape: 'made_to_order' };
    assert.deepEqual(gkeys(ctx), TEN);
    assert.equal(stepApplies('g_you', 'guest', ctx), true, 'years asked');
    assert.equal(stepApplies('g_creds', 'guest', ctx), true, 'expertise asked');
    // Cakes and hampers have no guests, so no max-guests step.
    assert.equal(stepApplies('g_capacity', 'guest', ctx), false, 'made-to-order skips the capacity step');
});

test('a yoga instructor (not food, slot) walks the flow, with a capacity step and dietary folded away', () => {
    const ctx = { group: 'wellness', category: 'yoga', shape: 'slot' };
    assert.deepEqual(gkeys(ctx), withCapacity(TEN));
    assert.equal(stepApplies('g_capacity', 'guest', ctx), true, 'a slot sets how many the space holds');
    // Dietary is no longer a step — it renders inside g_expect for a food
    // category only, so a yoga class simply never sees that field.
    assert.equal(stepApplies('g_area', 'guest', ctx), true, 'a slot still needs a location, on the where-and-when step');
    // What guests can expect and the photos step are asked of everyone.
    assert.equal(stepApplies('g_expect', 'guest', ctx), true);
    assert.equal(stepApplies('g_photos', 'guest', ctx), true);
});

test('expertise and years are asked of every category except the sauna', () => {
    // Sauna is the only sub-type that skips them now — nobody books a hot barrel
    // for the owner's CV. Everyone else, including the crafts and made-to-order
    // food, gets both screens.
    for (const ctx of [
        { group: 'food', category: 'chef', shape: 'comes_to_you' },
        { group: 'food', category: 'food_order', shape: 'made_to_order' },
        { group: 'wellness', category: 'yoga', shape: 'slot' },
        { group: 'crafts', category: 'pottery', shape: 'slot' },
        { group: 'crafts', category: 'painting', shape: 'slot' },
        { group: 'crafts', category: 'workshops', shape: 'slot' },
        { group: 'other', category: 'other', shape: null },
    ]) {
        assert.equal(stepApplies('g_you', 'guest', ctx), true, JSON.stringify(ctx) + ' is asked years');
        assert.equal(stepApplies('g_creds', 'guest', ctx), true, JSON.stringify(ctx) + ' is asked for expertise');
        assert.equal(stepApplies('g_photos', 'guest', ctx), true, JSON.stringify(ctx) + ' has a photos step');
    }
    // Only the sauna skips both — and it still has a photos step.
    const sauna = { group: 'wellness', category: 'sauna', shape: 'slot' };
    assert.equal(stepApplies('g_you', 'guest', sauna), false, 'sauna skips years');
    assert.equal(stepApplies('g_creds', 'guest', sauna), false, 'sauna skips expertise');
    assert.equal(stepApplies('g_photos', 'guest', sauna), true, 'sauna still has photos');
});

// The per-category checks catalogue and its single-confirmation successor were
// both retired: a guest now agrees to the provider terms on the finish screen,
// recorded in the declarations jsonb (terms_version + terms_agreed_at). That
// acceptance lives in the component, not the pure step model, so it has no test
// here; the gating and the recorded stamp are covered live and by typecheck.

test('years and qualifications are required only where physical safety is at stake', () => {
    // The line, category by category (Sep 2026). The four where a guide holds
    // someone's safety require both; a private chef requires a track record but
    // not a certificate (food hygiene is a separate check); a made-to-order
    // product asks neither; everyone else asks, optionally.
    const REQUIRE_BOTH = ['outdoors', 'water', 'massage', 'yoga'];
    for (const c of REQUIRE_BOTH) {
        assert.equal(guestYearsRequired(c), true, c + ' requires years');
        assert.equal(guestQualificationsRequired(c), true, c + ' requires qualifications');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked');
    }

    // The food experiences where the person is the draw: years required,
    // qualifications optional. The private chef in your kitchen, the tasting host
    // whose knowledge is the product, and the cooking class you're paying to be
    // taught — none forced to hold a certificate (food hygiene is a check).
    for (const c of ['chef', 'tastings', 'cooking']) {
        assert.equal(guestYearsRequired(c), true, c + ' needs a track record');
        assert.equal(guestQualificationsRequired(c), false, c + ' is not forced to hold a qualification');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked');
    }

    // The optional middle — asked, qualifications never forced. The crafts and
    // made-to-order food are back in this group, and 'other' is the catch-all.
    for (const c of ['other', 'food_order', 'pottery', 'painting', 'workshops']) {
        assert.equal(guestQualificationsRequired(c), false, c + ' does not force qualifications');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked, qualifications optional');
    }

    // Skipped entirely: only the sauna. The years and expertise screens never
    // appear for it, because the answer changes neither the booking nor the
    // approval — a hot barrel is booked for being warm, clean and well-sited.
    assert.equal(guestAsksExpertise('sauna'), false, 'sauna skips the years and expertise screens');
});

test('the something-else group skips the sub-type screen', () => {
    // 'other' is alone under its group, so there is no screen two to show.
    const ctx = { group: 'other', category: 'other', shape: null };
    assert.equal(stepApplies('g_subtype', 'guest', ctx), false, 'other has no sub-type');
    // The ten minus the sub-type screen — the verify gate still leads, then
    // the picker, then straight into the content.
    assert.deepEqual(
        gkeys(ctx),
        ['g_verify', 'trade', 'g_you', 'g_creds', 'g_area', 'g_photos', 'g_menu', 'g_expect', 'finish'],
    );
});

test('the guest split never touches a host trade', () => {
    const ctx = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    // A guest context passed to a plumber changes nothing about the plumber.
    assert.deepEqual(
        stepsFor('plumber', ctx).map((s: any) => s.key),
        stepsFor('plumber').map((s: any) => s.key),
    );
    for (const k of ['g_subtype', 'g_verify', 'g_you', 'g_creds', 'g_capacity', 'g_menu', 'g_expect', 'g_photos', 'g_area']) {
        assert.equal(stepApplies(k as any, 'plumber', ctx), false, k + ' is off for a host trade');
    }
});

test('guest movement and the last step honour the context', () => {
    const ctx = { group: 'wellness', category: 'sauna', shape: 'slot' };
    assert.equal(nextStep('guest', 'g_menu', ctx), 'g_expect');
    assert.equal(previousStep('guest', 'g_expect', ctx), 'g_menu');
    assert.equal(isLastStep('guest', 'finish', ctx), true);
    assert.equal(isLastStep('guest', 'g_expect', ctx), false);
    // The business step is off for a guest-with-context, so it resolves back to
    // a real one rather than stranding them.
    assert.equal(resolveStep('guest', 'business', ctx), 'finish');
});

// --- the named sections (the progress rail) --------------------------------
//
// The flow is grouped into named sections, not a "Step 5 of 12" count. The rail
// and the per-screen eyebrow both read from sectionsFor / sectionForStep, so
// they can't disagree about the flow.

test('the guest flow is six named sections, in Airbnb order', () => {
    const ctx = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    const secs = sectionsFor('guest', ctx);
    // The old "Experience" section is gone: its only screen was the naming step,
    // which is now a pre-rail name-only step (g_about) and its description field
    // was cut. What is left is six sections.
    assert.deepEqual(secs.map((s: any) => s.key),
        ['about', 'location', 'photos', 'pricing', 'details', 'finish']);
    // About you pairs the years screen and the expertise hub; every other
    // content section is a single screen; Finish gathers the wrap-up.
    assert.deepEqual(secs.find((s: any) => s.key === 'about').steps, ['g_you', 'g_creds']);
    // Pricing leads with the capacity step, then the priced offerings.
    assert.deepEqual(secs.find((s: any) => s.key === 'pricing').steps, ['g_capacity', 'g_menu']);
    // Finish is now a single screen — the checks and contact steps that used to
    // share it are gone (checks folded to one box on the finish screen; contact
    // removed, the account address is the contact address).
    assert.deepEqual(secs.find((s: any) => s.key === 'finish').steps, ['finish']);
    // The rail jumps to a section's first live step.
    assert.equal(secs.find((s: any) => s.key === 'location').firstStep, 'g_area');
});

test('a section with no screens drops out of the rail entirely', () => {
    // The sauna skips BOTH the years screen and the expertise hub, so its About
    // you section has nothing in it — and a section with no live steps drops
    // out rather than sitting in the rail as a dead label. So the sauna's rail
    // is six sections, opening at Location.
    const sauna = sectionsFor('guest', { group: 'wellness', category: 'sauna', shape: 'slot' });
    assert.equal(sauna.some((s: any) => s.key === 'about'), false, 'sauna has no About you section');
    assert.deepEqual(sauna.map((s: any) => s.key),
        ['location', 'photos', 'pricing', 'details', 'finish']);
});

test('the pickers and the name step sit before the rail, in no section', () => {
    // The flow branches on the group and the sub-type, so the rail can't be
    // drawn until they're answered — and listing them would imply you can change
    // category mid-flow and invalidate everything after it.
    assert.equal(sectionForStep('trade'), null);
    assert.equal(sectionForStep('g_subtype'), null);
    // The verify-email gate is pre-rail too — the rail begins once the account
    // exists, at About you.
    assert.equal(sectionForStep('g_verify'), null);
    // The name step (g_about) sits right after the sub-type, before the rail
    // begins — it belongs to no section, like the pickers it follows.
    assert.equal(sectionForStep('g_about'), null);
    // A content screen carries its section; About you covers the first two.
    assert.equal(sectionForStep('g_you').key, 'about');
    assert.equal(sectionForStep('g_creds').key, 'about');
});

test('a host trade has no rail', () => {
    // The rail is guest-only. A plumber (or a guest with no context) gets none.
    assert.deepEqual(sectionsFor('plumber', { group: 'x', category: 'y', shape: null }), []);
    assert.deepEqual(sectionsFor('guest'), []);
});
