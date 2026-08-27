// The shape of the provider sign-up: which steps a given trade actually has,
// and which step an error belongs on.
//
// Pure functions and constants, no queries and no React, for the same reason
// lib/serviceProviders.ts is — the step model is the part that has to be right,
// and it can be tested without a browser anywhere near it.
//
// THE RULE THAT MATTERS MOST HERE
//
// A step with nothing to ask does not render AND is not counted. A cleaner has
// no registration number and no skills, so she has four steps and the
// indicator says four — not five with one that flashes past, and not "step 4
// of 5" on the last page. An indicator that counts a step somebody never sees
// is worse than no indicator, because it tells them there is more coming when
// there is not.
//
// This is why the step list is computed from the trade rather than written
// down: every place that needs to know — the indicator, Next, Back, the
// restore, the validation — asks the same function, so none of them can
// disagree about how many steps there are.

import {
    bandsFor,
    pricingModelFor,
    extrasFor,
    offerableSchemes,
    asksAboutSkills,
    asksAboutFuel,
} from '@/lib/serviceProviders';

export type StepKey = 'trade' | 'business' | 'credentials' | 'prices' | 'finish';

export interface Step {
    key: StepKey;
    // What the indicator says. Short: it sits under a dot on a 375px screen.
    label: string;
    // The heading inside the step.
    title: string;
}

const ALL_STEPS: Step[] = [
    { key: 'trade', label: 'Trade', title: 'What do you do?' },
    { key: 'business', label: 'Business', title: 'Your business' },
    { key: 'credentials', label: 'Registration', title: 'Your registration' },
    { key: 'prices', label: 'Prices', title: 'What you charge' },
    { key: 'finish', label: 'Finish', title: 'Photos and your account' },
];

// Whether a trade has anything to ask on a given step.
//
// Written as one function per step rather than a table, because each answer is
// a different question and a table would hide that behind a column of trues.
export function stepApplies(step: StepKey, trade: string): boolean {
    const key = String(trade || '');

    // Always. This is where the trade is chosen, so it cannot depend on one
    // having been chosen.
    if (step === 'trade') return true;

    // Always. Every business has a name, an email, something to say about
    // itself and somewhere it works.
    if (step === 'business') return true;

    if (step === 'credentials') {
        // Gas and oil are asked before the number is, so the question counts
        // even when the answer is still no — a plumber who has not yet said
        // whether they do gas still has a step to see.
        if (asksAboutFuel(key)) return true;
        if (asksAboutSkills(key)) return true;

        // The electrician always needs a competent person scheme. Everybody
        // else with schemes on offer is covered by the fuel branch above.
        return offerableSchemes({ trade: key, does_gas: true, does_oil: true }).length > 0;
    }

    if (step === 'prices') {
        if (bandsFor(key).length > 0) return true;
        // A call-out fee and an hourly rate are two numbers, and they are the
        // whole of what a maintenance trade sets.
        if (pricingModelFor(key) === 'callout_hourly') return true;
        // A quoted trade sets no price, but it may still have extras to offer
        // — a roofer has sixteen. A chef has none, and has nothing to see.
        return extrasFor(key).length > 0;
    }

    // Photos, the logo and the tick box that creates the account. Deliberately
    // the lightest step: it is the one somebody reaches when they have already
    // done the work, and it is the one where they agree to something.
    return true;
}

// The steps this trade actually has, in order.
export function stepsFor(trade: string): Step[] {
    return ALL_STEPS.filter((s) => stepApplies(s.key, trade));
}

// Where a step sits in the indicator, counting only the steps that exist.
// One-based, because it is shown to a person. Zero when the step is not part
// of this trade's flow at all.
export function stepNumber(trade: string, step: StepKey): number {
    return stepsFor(trade).findIndex((s) => s.key === step) + 1;
}

export function stepCount(trade: string): number {
    return stepsFor(trade).length;
}

// Moving about.
//
// Both return the step you are already on when there is nowhere to go, so a
// caller never has to hold a special case for the ends.
export function nextStep(trade: string, from: StepKey): StepKey {
    const steps = stepsFor(trade);
    const at = steps.findIndex((s) => s.key === from);
    if (at === -1 || at === steps.length - 1) return from;
    return steps[at + 1].key;
}

export function previousStep(trade: string, from: StepKey): StepKey {
    const steps = stepsFor(trade);
    const at = steps.findIndex((s) => s.key === from);
    if (at <= 0) return from;
    return steps[at - 1].key;
}

export function isLastStep(trade: string, step: StepKey): boolean {
    const steps = stepsFor(trade);
    return steps.length > 0 && steps[steps.length - 1].key === step;
}

// A step restored from a draft, made safe.
//
// Somebody can leave on step 4 as a plumber, come back having changed their
// trade to cleaner, and step 4 no longer exists. Rather than land them on a
// blank panel or throw, this falls back to the last step the trade does have,
// which is where their work actually got to.
export function resolveStep(trade: string, wanted: string | null | undefined): StepKey {
    const steps = stepsFor(trade);
    const found = steps.filter((s) => s.key === wanted)[0];
    if (found) return found.key;

    // No trade chosen yet means there is nothing to come back to.
    if (!String(trade || '')) return 'trade';

    return steps.length > 0 ? steps[steps.length - 1].key : 'trade';
}

// ---------------------------------------------------------------------------
// WHICH STEP AN ERROR BELONGS ON
//
// submitProblems() returns every problem with the whole form in view. The
// stepped form needs the same answers sliced by step, so that Next can refuse
// on this step's problems only — and so that pressing send on the last step
// can say which step the outstanding problem is on rather than "something,
// somewhere, is wrong".
//
// Matched by prefix where the field is generated (price_beds_1_2,
// registration_gas_safe, extra_price_clean_oven), because the alternative is a
// list that goes stale the first time a band or a scheme is added.
// ---------------------------------------------------------------------------

const STEP_FIELDS: Record<StepKey, string[]> = {
    trade: ['trade', 'audience'],
    business: ['business_name', 'contact_email', 'description', 'areas'],
    credentials: ['registration_'],
    prices: ['prices', 'price_', 'hours_', 'hourly_rate', 'callout_fee', 'extra_price_'],
    finish: [],
};

export function stepForField(field: string): StepKey | null {
    const name = String(field || '');

    for (const key of Object.keys(STEP_FIELDS) as StepKey[]) {
        for (const match of STEP_FIELDS[key]) {
            // A bare name matches exactly; a name ending in _ is a prefix.
            const hit = match.charAt(match.length - 1) === '_'
                ? name.indexOf(match) === 0
                : name === match;

            if (hit) return key;
        }
    }

    return null;
}

export interface Problem { field: string; message: string }

export function problemsOnStep(problems: Problem[] | null | undefined, step: StepKey): Problem[] {
    return (problems || []).filter((p) => stepForField(p.field) === step);
}

// The first step that still has something wrong with it, so send can take
// somebody there rather than telling them to go and look.
export function firstStepWithProblem(
    trade: string,
    problems: Problem[] | null | undefined
): StepKey | null {
    for (const step of stepsFor(trade)) {
        if (problemsOnStep(problems, step.key).length > 0) return step.key;
    }
    return null;
}
