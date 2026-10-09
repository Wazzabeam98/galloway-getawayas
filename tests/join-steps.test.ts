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
    TRADES, submitProblems, planForTrade, audienceForTrade,
    capabilityFor, pricedOfferingsFor, showsRates, extrasFor, bandsFor,
    asksAboutFuel, asksAboutSkills, offerableSchemes,
    guestAsksExpertise, guestAsksQualifications, guestYearsRequired,
} = require('@/lib/serviceProviders');

const keys = (trade: string) => stepsFor(trade).map((s: any) => s.key);

// --- which steps exist ------------------------------------------------------

test('every host trade opens on the About-you screens now', () => {
    // The trades sign-up opens on the same years counter and expertise hub as the
    // guest experience, so every host trade gains g_you and g_creds at the front —
    // before the business screens. The old single business step is split one
    // question a screen: the name, then the coverage (b_area). There is no separate
    // contact screen — the email is the account's, and the phone moved to finish —
    // so with the credentials step (the services search) the cleaner is eight steps.
    assert.deepEqual(keys('sponge'),
        ['trade', 'g_you', 'g_creds', 'business', 'b_area', 'credentials', 'prices', 'finish']);
    assert.equal(stepCount('sponge'), 8);

    assert.equal(stepNumber('sponge', 'g_you'), 2);
    assert.equal(stepNumber('sponge', 'g_creds'), 3);
    assert.equal(stepNumber('sponge', 'business'), 4);
    assert.equal(stepNumber('sponge', 'b_area'), 5);
    assert.equal(stepNumber('sponge', 'finish'), 8);
});

test('a plumber sees all eight', () => {
    assert.deepEqual(keys('plumber'),
        ['trade', 'g_you', 'g_creds', 'business', 'b_area', 'credentials', 'prices', 'finish']);
    assert.equal(stepCount('plumber'), 8);
    assert.equal(stepNumber('plumber', 'finish'), 8);
});

test('the joiner, roofer and painter open on About-you too', () => {
    // Their capability lists sit on the credentials step; the About-you screens
    // (years, expertise hub) open the flow the same as every trade, and the two
    // business screens (name, coverage) follow.
    for (const trade of ['joiner', 'roofer', 'painter']) {
        assert.deepEqual(keys(trade),
            ['trade', 'g_you', 'g_creds', 'business', 'b_area', 'credentials', 'prices', 'finish'],
            trade + ' has all eight');
        assert.equal(stepCount(trade), 8);
    }
});

test('the "what you do" step is on every host trade now', () => {
    const withCredentials = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => stepApplies('credentials', trade));

    // Every host trade gets the credentials step now — it carries the services
    // search that replaced the per-trade capability checklist. Guests keep their
    // own flow and are not on this step.
    assert.deepEqual(withCredentials.sort(),
        ['bin', 'droplet', 'electrician', 'handyman', 'joiner', 'other', 'painter', 'plumber', 'roofer', 'sponge', 'trees']);
});

test('gas and electrical trades are asked for a registration number as well as services', () => {
    // The old rule was "registration OR skills, never both". It is both now: a
    // plumber gives a Gas Safe number AND lists the services it covers; an
    // electrician the same. Every host trade lists its services; gas and
    // electrical additionally give a registration number.
    for (const trade of TRADES.map((t: any) => t.key)) {
        if (audienceForTrade(trade) === 'host') {
            assert.equal(asksAboutSkills(trade), true, trade + ' lists its services');
        }
    }
    assert.equal(asksAboutFuel('plumber'), true, 'a plumber gives a registration number');
    assert.equal(asksAboutFuel('roofer'), false, 'a roofer does not');
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

test('the cleaner now has the credentials step for the services search', () => {
    // She has no pre-filled capability list (that was `about`, two tick boxes
    // that stay with her prices), but she still lists her services on the
    // credentials step like every other host trade.
    assert.deepEqual(capabilityFor('sponge'), []);
    assert.equal(pricedOfferingsFor('sponge').length > 0, true);
    assert.equal(stepApplies('credentials', 'sponge'), true, 'the services-search step');
    assert.deepEqual(keys('sponge'),
        ['trade', 'g_you', 'g_creds', 'business', 'b_area', 'credentials', 'prices', 'finish']);
});

test('the guest trades have no prices step either, so they see four', () => {
    // A chef quotes per job and has no extras to offer. A step containing one
    // heading and nothing under it is the thing this rule is against. ('other'
    // is a HOST trade now — "something else" — so it is not in this list.)
    for (const trade of ['chef', 'cake', 'basket']) {
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

test('next moves through the two business screens then credentials → prices', () => {
    // The business section is two screens now (name → coverage), and every host
    // trade has the credentials step, so Next walks all of them rather than
    // skipping to prices.
    assert.equal(nextStep('sponge', 'business'), 'b_area');
    assert.equal(nextStep('sponge', 'b_area'), 'credentials');
    assert.equal(nextStep('plumber', 'b_area'), 'credentials');
    assert.equal(nextStep('sponge', 'credentials'), 'prices');
});

test('back is the way in reversed', () => {
    assert.equal(previousStep('sponge', 'prices'), 'credentials');
    assert.equal(previousStep('plumber', 'prices'), 'credentials');
    assert.equal(previousStep('sponge', 'credentials'), 'b_area');
    assert.equal(previousStep('sponge', 'b_area'), 'business');
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
    // Left on a guest location step, came back having changed to a host trade.
    // That step is not in a host flow. Landing on a blank panel or throwing are
    // both worse than landing where their work actually got to.
    assert.equal(resolveStep('sponge', 'g_area'), 'finish');
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

    // The business section is two screens now: the name owns business_name and the
    // coverage screen owns areas, so each problem lands on its own screen rather
    // than piling onto one business step. contact_email is no longer asked (it is
    // the account email), so it is not in this set.
    assert.deepEqual(problemsOnStep(problems, 'business').map((p: any) => p.field),
        ['business_name']);
    assert.deepEqual(problemsOnStep(problems, 'b_area').map((p: any) => p.field),
        ['areas']);
    assert.deepEqual(problemsOnStep(problems, 'credentials').map((p: any) => p.field),
        ['registration_gas_safe']);
    assert.deepEqual(problemsOnStep(problems, 'prices').map((p: any) => p.field),
        ['price_beds_1_2', 'extra_price_clean_oven']);

    // The photos/tick are optional and none of the fields in this set map to
    // finish, so arriving there is not refused. (contact_email now maps to finish
    // as a defensive fallback, but the account always supplies it, so it is empty
    // here.)
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

test('a subscription trade that prices by quote is not held up on the prices step', () => {
    // These three are on the subscription and typically quote per job. With the
    // quote ticked they set no number and the prices step is satisfied.
    for (const trade of ['roofer', 'joiner', 'painter']) {
        assert.equal(planForTrade(trade), 'subscription');
        const problems = submitProblems({
            business_name: 'A Firm', trade,
            description: 'Long enough a description to pass the length check on the form itself.',
            contact_email: 'a@b.test', audience: 'host', areaCount: 1,
            provides_quote: true, callout_fee: '', hourly_rate: '', callout_waived: false, extras: {},
            does_gas: false, does_oil: false, registrations: [],
        });

        assert.deepEqual(problemsOnStep(problems, 'prices'), [],
            trade + ' prices by quote, so nothing is required on the prices step');
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
test('nothing moves before the load has finished', () => {
    assert.equal(openingStep({ hydrated: false, restored: false, trade: 'joiner' }), null);
});

test('a restored draft decides for itself', () => {
    // resolveStep put them somewhere from the draft. This must not overrule it.
    assert.equal(openingStep({ hydrated: true, restored: true, trade: 'joiner' }), null);
});

test('a trade in the URL means step one is already answered', () => {
    // A host trade opens on the About-you years counter now (g_you), the same
    // opener the guest flow uses — not the business step.
    assert.equal(openingStep({ hydrated: true, restored: false, trade: 'joiner' }), 'g_you');
    assert.equal(openingStep({ hydrated: true, restored: false, trade: '' }), 'trade');
});

test('what counts as seen matches where they land', () => {
    // The step they open on shows its own errors; steps ahead stay quiet.
    assert.deepEqual(openingVisited({ hydrated: true, restored: false, trade: '' }), []);
    assert.deepEqual(openingVisited({ hydrated: true, restored: false, trade: 'joiner' }), ['trade']);
    assert.equal(openingVisited({ hydrated: true, restored: true, trade: 'joiner' }), null);
});

test('a guest opens on the picker if no category, else the first content screen', () => {
    // They open on the category picker (no category yet) or straight on the content.
    assert.equal(
        openingStep({ hydrated: true, restored: false, trade: 'guest', guestNeedsCategory: true }),
        'trade',
    );
    assert.equal(
        // First content screen is the name step (g_title) now — it opens About you
        // and every guest has it, whatever their category.
        openingStep({ hydrated: true, restored: false, trade: 'guest', guestNeedsCategory: false, category: 'chef' }),
        'g_title',
    );
    assert.equal(
        // A sauna skips the expertise screens but still names its experience, so it
        // too opens on the name step (g_title) — a step it does have. The old
        // returning-sauna fix (open on a step it has, never g_you) still holds,
        // just landing on the name rather than Location now.
        openingStep({ hydrated: true, restored: false, trade: 'guest', guestNeedsCategory: false, category: 'sauna' }),
        'g_title',
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

// The rebuilt flow, reordered to Airbnb's sequence (Sep 2026). The account is
// made before the wizard renders at all (the shared email-first sign-in), so the
// flow opens on the picker ('trade' group grid), then g_subtype, and the content:
// About you — now opening with the NAMING step (g_title, what the experience/
// business is CALLED, written to business_name) ahead of the years (g_you) and
// expertise hub (g_creds) — then Location (g_area) straight after, Photos
// (g_photos) BEFORE the writing, Pricing (g_menu), Details (g_expect), and the
// Finish screen (the account). The naming step moved to the FRONT of About you on
// 7 Oct 2026 (a real provider was thrown by being asked the name after everything
// else); it used to sit late, opening the Details section. The booking shape is
// inferred from the category and never a step; availability folds into g_area;
// dietary folds into g_expect; the business step is host-only. The professional
// title is asked separately on g_creds and is NOT the listing name. There is NO
// contact step (a guest signs in up front, so the account address is the contact
// address, and the phone lives on the profile) and NO checks step (the
// per-category checks collapsed to one responsibility confirmation folded onto
// the finish screen). So an applicant with a sub-type walks these keys.
const TEN = [
    'trade', 'g_subtype', 'g_title', 'g_you', 'g_creds', 'g_area', 'g_photos',
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

test('how they charge is asked of "something else" only, and decides its capacity', () => {
    // The named categories infer their shape and units and are never asked
    // (Liam, 9 Oct 2026) — a chef keeps exactly the flow it had.
    const chef = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    assert.equal(stepApplies('g_charge', 'guest', chef), false, 'a chef is never asked how they charge');
    assert.equal(stepApplies('g_capacity', 'guest', { ...chef, chargeUnits: ['event'] }), true, 'a chef keeps its capacity step');
    for (const named of [
        { group: 'food', category: 'food_order', shape: 'made_to_order' },
        { group: 'outdoors', category: 'outdoors', shape: 'slot' },
        { group: 'wellness', category: 'massage', shape: 'slot' },
        { group: 'wellness', category: 'sauna', shape: 'slot' },
    ]) {
        assert.equal(stepApplies('g_charge', 'guest', named), false, named.category + ' is not asked');
    }
    // "Something else" that comes to the guest is asked, before capacity.
    const other = { group: 'other', category: 'other', shape: 'comes_to_you' };
    assert.equal(stepApplies('g_charge', 'guest', other), true, 'something else is asked how they charge');
    const keys = gkeys(other);
    assert.ok(keys.indexOf('g_charge') < keys.indexOf('g_capacity'), 'the unit comes before capacity');
    // A bouncy castle is per event however many come — no capacity question.
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: ['event'] }), false, 'per event only: no capacity');
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: ['item'] }), false, 'per item only: no capacity');
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: ['event', 'item'] }), false, 'per event and per item: no capacity');
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: ['event', 'person'] }), true, 'per person needs a capacity');
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: ['flat'] }), true, 'per group needs a capacity');
    assert.equal(stepApplies('g_capacity', 'guest', { ...other, chargeUnits: [] }), true, 'not yet answered: capacity stays');
    // Something else that is a session or made to order isn't asked here either:
    // the session's private/shared screen and the per-item menu cover it.
    assert.equal(stepApplies('g_charge', 'guest', { ...other, shape: 'slot' }), false);
    assert.equal(stepApplies('g_charge', 'guest', { ...other, shape: 'made_to_order' }), false);
});

test('a cake maker (made to order) gets the years and expertise screens too', () => {
    // Made-to-order food was cut from these screens for a while, then brought
    // back: a cake maker has a track record and a story worth showing. So it
    // walks the full flow now, with g_you and g_creds. Its notice period is
    // its OWN screen (g_notice) — split out of the old combined where-and-when
    // step, which promised a schedule it did not have. Since 5 Oct 2026 it comes
    // AFTER "How do guests get it?" (g_area), in the When section: a notice
    // period is a when, and asking it before the where read backwards. So a cake
    // maker walks the ten PLUS the notice screen, straight after g_area.
    const ctx = { group: 'food', category: 'food_order', shape: 'made_to_order' };
    const withNotice = TEN.slice();
    withNotice.splice(withNotice.indexOf('g_area') + 1, 0, 'g_notice');
    assert.deepEqual(gkeys(ctx), withNotice);
    assert.equal(stepApplies('g_notice', 'guest', ctx), true, 'made-to-order asks its notice, on its own screen');
    assert.equal(stepApplies('g_you', 'guest', ctx), true, 'years asked');
    assert.equal(stepApplies('g_creds', 'guest', ctx), true, 'expertise asked');
    // Cakes and hampers have no guests, so no max-guests step.
    assert.equal(stepApplies('g_capacity', 'guest', ctx), false, 'made-to-order skips the capacity step');
    // The notice screen is made-to-order only — a slot and a traveller never see it.
    assert.equal(stepApplies('g_notice', 'guest', { group: 'wellness', category: 'sauna', shape: 'slot' }), false, 'a slot has no notice screen');
    assert.equal(stepApplies('g_notice', 'guest', { group: 'food', category: 'chef', shape: 'comes_to_you' }), false, 'a traveller has no notice screen');
});

// The full slot flow, built from scratch (the request shapes splice into TEN;
// a slot restructures the middle too much for that). A slot carries:
//   - the LOCATION section: g_area (the place) — and, for the three either-way
//     categories, a come-to-me/travel fork (g_slot_where) before it;
//   - a WHEN section (slots only): g_slot_length (weekly hours moved to the
//     listing editor's Availability section, so they are no longer a wizard step);
//   - the PRICING section: g_slot_basis, g_capacity, then g_menu. (The per-person
//     minimum screen was removed at sign-up, Liam 9 Oct 2026.)
// `expertise` is true for every slot category except the sauna, which skips the
// years and expertise screens.
const slotFlow = (opts: { fork?: boolean; perPerson?: boolean; expertise?: boolean; perItemDuration?: boolean; mixed?: boolean } = {}) => {
    // g_title (the name) opens About you now, so it comes first — every guest has
    // it, including a sauna that skips the years/expertise screens below.
    const keys = ['trade', 'g_subtype', 'g_title'];
    if (opts.expertise !== false) keys.push('g_you', 'g_creds');
    if (opts.fork) keys.push('g_slot_where');
    keys.push('g_area');
    // The one-at-a-time shape (massage) asks length PER TREATMENT in the pricing
    // sub-flow, so it drops the single provider-length screen — the MIXED shape
    // keeps it (its group classes need one). WEEKLY HOURS are no longer a wizard
    // step: they moved to the listing editor's Availability section, so a slot
    // sets a length at sign-up and its hours in the editor after.
    if (!opts.perItemDuration) keys.push('g_slot_length');
    keys.push('g_photos');
    // massage drops the pricing BASIS and the capacity (both fixed for it). The
    // mixed shape drops the basis only — each item picks shared-class vs
    // one-at-a-time in its own sub-flow — but keeps the capacity for its classes.
    if (!opts.perItemDuration && !opts.mixed) keys.push('g_slot_basis');
    if (!opts.perItemDuration) keys.push('g_capacity');
    // The per-person minimum screen was removed at sign-up (Liam, 9 Oct 2026), so
    // no slot flow carries g_slot_min any more. perPerson/mixed are kept as options
    // only for the length/capacity/basis branching above.
    keys.push('g_menu', 'g_expect', 'finish');
    return keys;
};

test('a potter (slot, fixed come-to-me) walks the location + When split, no fork', () => {
    // Pottery is a come-to-me slot with no fork (studio, one honest answer), and
    // it is asked its expertise. Its location is g_area (the address) and its
    // When section is just the session length now (weekly hours moved to the
    // listing editor). It is now a MIXED shape
    // (a group wheel class AND private tuition), so it keeps the length and the
    // capacity but drops the provider basis — each item chooses shared vs 1:1.
    const ctx = { group: 'crafts', category: 'pottery', shape: 'slot' };
    assert.deepEqual(gkeys(ctx), slotFlow({ mixed: true }));
    assert.equal(stepApplies('g_slot_where', 'guest', ctx), false, 'a fixed come-to-me slot skips the where fork');
    assert.equal(stepApplies('g_slot_length', 'guest', ctx), true, 'a mixed slot keeps a session length for its classes');
    assert.equal(stepApplies('g_slot_hours', 'guest', ctx), false, 'weekly hours moved to the listing editor — not asked at sign-up');
    assert.equal(stepApplies('g_slot_basis', 'guest', ctx), false, 'a mixed slot decides shared-vs-1:1 per item, not a provider basis');
    assert.equal(stepApplies('g_capacity', 'guest', ctx), true, 'a mixed slot keeps a capacity for its classes');
    assert.ok(!gkeys(ctx).includes('g_slot_min'), 'the per-person minimum screen was removed at sign-up');
});

test('the come-to-me / travel fork is asked only for yoga, massage and painting', () => {
    // The three either-way categories get g_slot_where; every other slot defaults
    // and skips it.
    for (const cat of ['yoga', 'massage', 'painting']) {
        const ctx = { group: 'wellness', category: cat, shape: 'slot' };
        assert.equal(stepApplies('g_slot_where', 'guest', ctx), true, cat + ' is asked the fork');
        // Massage is pure one-at-a-time (per-treatment length, no basis/capacity).
        // Yoga and painting are MIXED: they keep the length and capacity (for their
        // group classes) but drop the basis (each item picks shared vs 1:1).
        assert.deepEqual(gkeys(ctx), slotFlow({ fork: true, perItemDuration: cat === 'massage', mixed: cat !== 'massage' }));
    }
    // Massage's dropped screens, stated: duration is asked per treatment (in the
    // item sub-flow), the basis is fixed private and the capacity fixed at one, so
    // none of the three is a screen — and weekly hours are no longer one either
    // (they moved to the listing editor).
    const massage = { group: 'wellness', category: 'massage', shape: 'slot' };
    assert.equal(stepApplies('g_slot_length', 'guest', massage), false, 'massage asks duration per treatment, not a provider length');
    assert.equal(stepApplies('g_slot_basis', 'guest', massage), false, 'massage is fixed private, not asked');
    assert.equal(stepApplies('g_capacity', 'guest', massage), false, 'massage is one at a time, not asked');
    assert.equal(stepApplies('g_slot_hours', 'guest', massage), false, 'weekly hours moved to the listing editor — not asked at sign-up');
    // A mixed category (yoga) keeps length + capacity but has no provider basis.
    // (No fulfilment ⇒ treated as come-to-me for the screens it declares.)
    const mixed = { group: 'wellness', category: 'yoga', shape: 'slot' };
    assert.equal(stepApplies('g_slot_basis', 'guest', mixed), false, 'a mixed slot has no provider basis — each item chooses shared vs 1:1');
    assert.equal(stepApplies('g_slot_length', 'guest', mixed), true, 'a mixed slot keeps a provider length for its classes');
    assert.equal(stepApplies('g_capacity', 'guest', mixed), true, 'a mixed slot keeps a capacity for its classes');
    assert.ok(!gkeys(mixed).includes('g_slot_min'), 'the per-person minimum screen was removed at sign-up');
    for (const cat of ['tastings', 'cooking', 'sauna', 'pottery', 'workshops', 'outdoors', 'water']) {
        const ctx = { group: 'x', category: cat, shape: 'slot' };
        assert.equal(stepApplies('g_slot_where', 'guest', ctx), false, cat + ' defaults, no fork');
    }
    // Non-slot shapes never see the fork.
    assert.equal(stepApplies('g_slot_where', 'guest', { category: 'chef', shape: 'comes_to_you' }), false);
    assert.equal(stepApplies('g_slot_where', 'guest', { category: 'food_order', shape: 'made_to_order' }), false);
});

test('a TRAVELLING mixed provider drops the session-length and capacity screens', () => {
    // Come-to-me: guests come to the studio, so its group classes need a length
    // and a capacity — both asked.
    const comeToMe = { group: 'wellness', category: 'yoga', shape: 'slot', fulfilment: 'collection' };
    assert.equal(stepApplies('g_slot_length', 'guest', comeToMe), true, 'come-to-me keeps the class length');
    assert.equal(stepApplies('g_capacity', 'guest', comeToMe), true, 'come-to-me keeps the class capacity');
    assert.ok(!gkeys(comeToMe).includes('g_slot_min'), 'the per-person minimum screen was removed at sign-up');
    // Travels to the guest: every item is a private session with its own length,
    // and nobody joins a class in someone's cottage — so both screens drop, the
    // same way the shared-vs-private question does.
    const travels = { group: 'wellness', category: 'yoga', shape: 'slot', fulfilment: 'delivery' };
    assert.equal(stepApplies('g_slot_length', 'guest', travels), false, 'a traveller sets the length per private session');
    assert.equal(stepApplies('g_capacity', 'guest', travels), false, 'a traveller declares no class capacity');
    assert.ok(!gkeys(travels).includes('g_slot_min'), 'the per-person minimum screen was removed at sign-up');
    assert.equal(stepApplies('g_slot_hours', 'guest', travels), false, 'weekly hours moved to the listing editor — not asked at sign-up');
    // The traveller rule is mixed-only — a non-mixed slot is unaffected.
    const tastingTravels = { group: 'food', category: 'tastings', shape: 'slot', fulfilment: 'delivery' };
    assert.equal(stepApplies('g_capacity', 'guest', tastingTravels), true, 'the traveller rule is mixed-only');
});

test('the per-person minimum screen is gone from every slot flow', () => {
    // The minimum-people screen was removed at sign-up (Liam, 9 Oct 2026): Airbnb
    // has no such setting and ours misled (the heading implied a session total
    // while it applied per booking). No shape, basis or direction brings it back.
    const shared = { group: 'food', category: 'tastings', shape: 'slot', slotOffer: 'shared' };
    const priv = { group: 'wellness', category: 'sauna', shape: 'slot', slotOffer: 'private' };
    const unanswered = { group: 'food', category: 'tastings', shape: 'slot' };
    // A per-person slot now goes straight g_capacity → g_menu, no minimum between.
    assert.ok(!gkeys(shared).includes('g_slot_min'), 'per person no longer has a minimum screen');
    assert.deepEqual(gkeys(shared), slotFlow({ perPerson: true }));
    assert.ok(!gkeys(priv).includes('g_slot_min'), 'private/whole-group has no minimum screen');
    assert.ok(!gkeys(unanswered).includes('g_slot_min'), 'no minimum screen whatever the basis');
    // The basis is still slot-only — a chef and a cake maker never see it, and the
    // minimum is gone for them too.
    for (const nonSlot of [
        { group: 'food', category: 'chef', shape: 'comes_to_you', slotOffer: 'shared' },
        { group: 'food', category: 'food_order', shape: 'made_to_order', slotOffer: 'shared' },
    ]) {
        assert.equal(stepApplies('g_slot_basis', 'guest', nonSlot), false, 'non-slot has no basis screen');
        assert.ok(!gkeys(nonSlot).includes('g_slot_min'), 'non-slot has no minimum screen');
    }
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

test('qualifications are prompted only where a formal qualification matters, and never required', () => {
    // Qualifications are always OPTIONAL now — no category forces one. We only
    // PROMPT for them (show the row) on the physical-safety categories, where a
    // guide holds someone's safety; everywhere else the row is not shown at all.
    const SAFETY = ['outdoors', 'water', 'massage', 'yoga'];
    for (const c of SAFETY) {
        assert.equal(guestYearsRequired(c), true, c + ' requires years');
        assert.equal(guestAsksQualifications(c), true, c + ' is prompted for qualifications');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked');
    }

    // The food experiences where the person is the draw: years required, and
    // qualifications not prompted (food hygiene is a separate check). The private
    // chef in your kitchen, the tasting host, the cooking class.
    for (const c of ['chef', 'tastings', 'cooking']) {
        assert.equal(guestYearsRequired(c), true, c + ' needs a track record');
        assert.equal(guestAsksQualifications(c), false, c + ' is not prompted for qualifications');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked');
    }

    // Everything else asks the expertise screen (title, years, endorsements) but
    // the qualifications row is not prompted — a potter's work speaks for itself.
    for (const c of ['other', 'food_order', 'pottery', 'painting', 'workshops']) {
        assert.equal(guestAsksQualifications(c), false, c + ' is not prompted for qualifications');
        assert.equal(guestAsksExpertise(c), true, c + ' is asked');
    }

    // Skipped entirely: only the sauna. The years and expertise screens never
    // appear for it, because the answer changes neither the booking nor the
    // approval — a hot barrel is booked for being warm, clean and well-sited.
    assert.equal(guestAsksExpertise('sauna'), false, 'sauna skips the years and expertise screens');
});

test('the something-else group skips the sub-type screen but is asked its shape', () => {
    // 'other' is alone under its group, so there is no sub-type screen to show —
    // and because it declares no shape, it never answered the booking shape a
    // sub-type pick settles for every other category. So it is asked g_shape
    // instead — straight after step one, before About you (5 Oct 2026), so "How
    // many years have you been doing this?" follows them saying what "this" is.
    const ctx = { group: 'other', category: 'other', shape: null };
    assert.equal(stepApplies('g_subtype', 'guest', ctx), false, 'other has no sub-type');
    assert.equal(stepApplies('g_shape', 'guest', ctx), true, 'other is asked its booking shape');
    // A real category, whose shape came from its sub-type, is never asked g_shape.
    assert.equal(stepApplies('g_shape', 'guest', { group: 'wellness', category: 'sauna', shape: 'slot' }), false, 'a real category already has a shape');
    // g_shape is the second picker, before About-you and the location step; the
    // naming step (g_title) opens About you, right after it.
    assert.deepEqual(
        gkeys(ctx),
        ['trade', 'g_shape', 'g_title', 'g_you', 'g_creds', 'g_area', 'g_photos', 'g_menu', 'g_expect', 'finish'],
    );
    // And like the other pickers it sits before the rail, in no section.
    assert.equal(sectionForStep('g_shape'), null, 'the shape picker is pre-rail');
});

test('the guest-only split never touches a host trade', () => {
    const ctx = { group: 'food', category: 'chef', shape: 'comes_to_you' };
    // A guest context passed to a plumber changes nothing about the plumber.
    assert.deepEqual(
        stepsFor('plumber', ctx).map((s: any) => s.key),
        stepsFor('plumber').map((s: any) => s.key),
    );
    // The genuinely guest-only steps stay off for a host trade. g_you and g_creds
    // are NO LONGER in this list — the years opener and the expertise hub are
    // shared, and a host trade now has both.
    for (const k of ['g_subtype', 'g_capacity', 'g_menu', 'g_title', 'g_expect', 'g_photos', 'g_area']) {
        assert.equal(stepApplies(k as any, 'plumber', ctx), false, k + ' is off for a host trade');
    }
    // And the shared About-you screens ARE on for the host trade.
    assert.equal(stepApplies('g_you', 'plumber', ctx), true, 'g_you is on for a host trade');
    assert.equal(stepApplies('g_creds', 'plumber', ctx), true, 'g_creds is on for a host trade');
});

test('guest movement and the last step honour the context', () => {
    const ctx = { group: 'wellness', category: 'sauna', shape: 'slot' };
    // The naming step (g_title) opens About you now, right after the sub-type —
    // a sauna skips the years/expertise screens, so from the name it goes on to
    // Location (g_area).
    assert.equal(nextStep('guest', 'g_title', ctx), 'g_area');
    assert.equal(previousStep('guest', 'g_title', ctx), 'g_subtype');
    // The Details section is now just what-happens, straight after the price.
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
    // Six sections. The naming step opens About you now (it used to open a
    // separate Details-leading step); Details is left with just what-happens.
    assert.deepEqual(secs.map((s: any) => s.key),
        ['about', 'location', 'photos', 'pricing', 'details', 'finish']);
    // About you opens with the name, then the years screen and the expertise hub;
    // every other content section is a single screen; Finish gathers the wrap-up.
    assert.deepEqual(secs.find((s: any) => s.key === 'about').steps, ['g_title', 'g_you', 'g_creds']);
    // Pricing leads with the capacity step, then the priced offerings.
    assert.deepEqual(secs.find((s: any) => s.key === 'pricing').steps, ['g_capacity', 'g_menu']);
    // Finish is now a single screen — the checks and contact steps that used to
    // share it are gone (checks folded to one box on the finish screen; contact
    // removed, the account address is the contact address).
    assert.deepEqual(secs.find((s: any) => s.key === 'finish').steps, ['finish']);
    // The rail jumps to a section's first live step.
    assert.equal(secs.find((s: any) => s.key === 'location').firstStep, 'g_area');
});

test('a section with no live screens drops out of the rail entirely', () => {
    // The sauna skips BOTH the years screen and the expertise hub, but it still
    // NAMES its experience — and the name step now opens About you — so its About
    // section survives with just that one screen (the dead-section drop-out is
    // proved by the When/notice cases below instead). As a slot it also has a When
    // section (session length), so its rail runs About → Location → When → …
    const sauna = sectionsFor('guest', { group: 'wellness', category: 'sauna', shape: 'slot' });
    const aboutSauna = sauna.find((s: any) => s.key === 'about');
    assert.deepEqual(aboutSauna ? aboutSauna.steps : null, ['g_title'], 'sauna About you is just the name');
    assert.deepEqual(sauna.map((s: any) => s.key),
        ['about', 'location', 'when', 'photos', 'pricing', 'details', 'finish']);
    // A made-to-order guest's When is its notice period (since 5 Oct 2026), and a
    // traveller has neither screen — proof the section still drops out for a
    // shape with nothing in it.
    const baker = sectionsFor('guest', { group: 'food', category: 'food_order', shape: 'made_to_order' });
    assert.deepEqual(baker.filter((s: any) => s.key === 'when').map((s: any) => s.steps), [['g_notice']], 'made-to-order: When is the notice');
    const chef = sectionsFor('guest', { group: 'food', category: 'chef', shape: 'comes_to_you' });
    assert.equal(chef.some((s: any) => s.key === 'when'), false, 'a traveller has no When section');
});

test('the pickers sit before the rail; the name step opens About you', () => {
    // The flow branches on the group and the sub-type, so the rail can't be
    // drawn until they're answered — and listing them would imply you can change
    // category mid-flow and invalidate everything after it.
    assert.equal(sectionForStep('trade'), null);
    assert.equal(sectionForStep('g_subtype'), null);
    // The retired g_about key belongs to no section.
    assert.equal(sectionForStep('g_about'), null);
    // The name step (g_title) now opens the About you section, ahead of the
    // years screen and the expertise hub.
    assert.equal(sectionForStep('g_title').key, 'about');
    assert.equal(sectionForStep('g_you').key, 'about');
    assert.equal(sectionForStep('g_creds').key, 'about');
});

test('a host trade now has its own rail; a guest with no context has none yet', () => {
    // A host trade walks the full-page wizard too, so it gets the trade rail
    // (TRADE_SECTIONS), filtered to the steps this trade actually has. It starts
    // with the About-you section (years + expertise hub, shared with the guest
    // flow) and ends with finish.
    const trade = sectionsFor('plumber', { group: 'x', category: 'y', shape: null });
    const keys = trade.map((s) => s.key);
    assert.ok(keys.length > 0, 'a host trade has sections');
    assert.equal(keys[0], 'about');
    assert.equal(keys[keys.length - 1], 'finish');

    // A guest needs a context before the rail can be drawn (the flow branches on
    // the category first); without one it is still empty.
    assert.deepEqual(sectionsFor('guest'), []);
});
