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
    capabilityFor,
    pricedOfferingsFor,
    showsRates,
    offerableSchemes,
    asksAboutSkills,
    asksAboutFuel,
    audienceForTrade,
    guestCategoryIsFood,
} from '@/lib/serviceProviders';

// The host trades keep 'trade' | 'business' | 'credentials' | 'prices' |
// 'finish'. The guest experience used to collapse ALL of its application into
// 'business' (one long scroll); it is now split into its own screens, each a
// 'g_' key. The guest keys are gated on the category and the booking shape, and
// they are OFF entirely unless the component passes a StepContext — so a guest
// with no context still sees the old trade/business/finish, and no host trade
// ever gains one. See stepApplies.
export type StepKey =
    | 'trade' | 'business'
    | 'g_about' | 'g_offer' | 'g_menu' | 'g_avail' | 'g_you' | 'g_diet' | 'g_area' | 'g_checks' | 'g_contact'
    | 'credentials' | 'prices' | 'finish';

// The guest-only steps, in flow order.
const GUEST_STEP_KEYS: StepKey[] = [
    'g_about', 'g_offer', 'g_menu', 'g_avail', 'g_you', 'g_diet', 'g_area', 'g_checks', 'g_contact',
];

// What a guest's later steps branch on. Both come from earlier answers —
// the category (its `food` flag) and the booking shape — never from a
// hand-coded per-category list.
export interface StepContext {
    category?: string | null;
    shape?: string | null;
}

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
    // The guest experience, split out of the old single 'business' step. Each
    // is one question a screen; which of them a given guest sees is decided by
    // stepApplies from the category and shape.
    { key: 'g_about', label: 'About', title: 'Tell guests what you do' },
    { key: 'g_offer', label: 'How', title: 'How do guests get it?' },
    { key: 'g_menu', label: 'Prices', title: 'What you offer, and what it costs' },
    { key: 'g_avail', label: 'When', title: 'When can guests book?' },
    { key: 'g_you', label: 'You', title: 'A bit about you' },
    { key: 'g_diet', label: 'Dietary', title: 'What can you cater for?' },
    { key: 'g_area', label: 'Area', title: 'How far will you travel?' },
    { key: 'g_checks', label: 'Checks', title: 'A few checks before we list you' },
    { key: 'g_contact', label: 'Contact', title: 'Where can we reach you?' },
    // Not "Registration". Registration and skills never co-occur across the
    // trade list — the electrician and plumber give numbers, the handyman gives
    // skills, nobody does both — so a step called Registration was wrong for
    // the handyman every single time. "What you do" is true of all three, and
    // of the capability lists that now sit here; the registration numbers keep
    // their own heading inside it, which is honest, because being registered is
    // a fact about what you are allowed to do.
    { key: 'credentials', label: 'What you do', title: 'What you do' },
    { key: 'prices', label: 'Prices', title: 'What you charge' },
    { key: 'finish', label: 'Finish', title: 'Photos and your account' },
];

// Whether a trade has anything to ask on a given step.
//
// Written as one function per step rather than a table, because each answer is
// a different question and a table would hide that behind a column of trues.
export function stepApplies(step: StepKey, trade: string, ctx?: StepContext): boolean {
    const key = String(trade || '');

    // Always. This is where the trade is chosen, so it cannot depend on one
    // having been chosen.
    if (step === 'trade') return true;

    // Always. Every business has a name and someone behind it.
    if (step === 'business') return true;

    // The guest-experience steps. Two gates before any per-step rule:
    //   1. only the guest audience has them — a host trade never does;
    //   2. only when a context is supplied — the component opts in by passing
    //      one, so a guest with no context still sees trade/business/finish
    //      (the old single-step flow) and nothing breaks mid-migration.
    if (GUEST_STEP_KEYS.indexOf(step) !== -1) {
        if (audienceForTrade(key) !== 'guest') return false;
        if (!ctx) return false;

        const shape = ctx.shape || null;
        switch (step) {
            // Asked of every guest.
            case 'g_about':
            case 'g_offer':
            case 'g_menu':
            case 'g_you':
            case 'g_checks':
            case 'g_contact':
                return true;
            // A schedule only where there is one: a slot is booked into a time,
            // a made-to-order needs a lead time. Someone who comes to the guest
            // (comes_to_you) arranges it on the enquiry, so no schedule screen.
            case 'g_avail':
                return shape === 'slot' || shape === 'made_to_order';
            // Dietary only for the food categories (chef, baking, hampers,
            // tastings), by the category's own `food` flag. A sauna never sees it.
            case 'g_diet':
                return guestCategoryIsFood(ctx.category);
            // Every guest needs a location — submitProblems requires at least one
            // area for anyone, and the marketplace has to know where they are.
            // The wording adapts (how far will you travel vs where is it), but
            // the step is always there; a slot that skipped it would strand the
            // provider on an areas error with no step to fix it on.
            case 'g_area':
                return true;
            default:
                return false;
        }
    }

    if (step === 'credentials') {
        // Gas and oil are asked before the number is, so the question counts
        // even when the answer is still no — a plumber who has not yet said
        // whether they do gas still has a step to see.
        if (asksAboutFuel(key)) return true;
        if (asksAboutSkills(key)) return true;

        // The electrician always needs a competent person scheme. Everybody
        // else with schemes on offer is covered by the fuel branch above.
        if (offerableSchemes({ trade: key, does_gas: true, does_oil: true }).length > 0) return true;

        // What has gone wrong, what you can do, how fast you turn out. This is
        // what brings the joiner, roofer and painter onto this step: they give
        // no registration and no skills, but they each carry nine to sixteen
        // capability entries that were filed under "What you charge", where
        // they set no price at all.
        return capabilityFor(key).length > 0;
    }

    if (step === 'prices') {
        if (bandsFor(key).length > 0) return true;

        // A call-out fee and an hourly rate. Read from serviceProviders rather
        // than recomputed here, so the step model and the form cannot disagree
        // about whether there is a rates section to show.
        if (showsRates(key)) return true;

        // Anything left that belongs beside a price: the pricing structures,
        // the gated groups, `about`, and the two genuinely priced entries the
        // electrician and roofer carry. Capability does NOT count towards this
        // any more — counting it was what put fifteen tick boxes about roofs
        // under a heading that promised the roofer prices.
        return pricedOfferingsFor(key).length > 0;
    }

    // Photos, the logo and the tick box that creates the account. Deliberately
    // the lightest step: it is the one somebody reaches when they have already
    // done the work, and it is the one where they agree to something.
    return true;
}

// The steps this trade actually has, in order. `ctx` carries the guest's
// category and shape; it is ignored for host trades and may be omitted.
export function stepsFor(trade: string, ctx?: StepContext): Step[] {
    return ALL_STEPS.filter((s) => stepApplies(s.key, trade, ctx));
}

// Where a step sits in the indicator, counting only the steps that exist.
// One-based, because it is shown to a person. Zero when the step is not part
// of this trade's flow at all.
export function stepNumber(trade: string, step: StepKey, ctx?: StepContext): number {
    return stepsFor(trade, ctx).findIndex((s) => s.key === step) + 1;
}

export function stepCount(trade: string, ctx?: StepContext): number {
    return stepsFor(trade, ctx).length;
}

// Moving about.
//
// Both return the step you are already on when there is nowhere to go, so a
// caller never has to hold a special case for the ends.
export function nextStep(trade: string, from: StepKey, ctx?: StepContext): StepKey {
    const steps = stepsFor(trade, ctx);
    const at = steps.findIndex((s) => s.key === from);
    if (at === -1 || at === steps.length - 1) return from;
    return steps[at + 1].key;
}

export function previousStep(trade: string, from: StepKey, ctx?: StepContext): StepKey {
    const steps = stepsFor(trade, ctx);
    const at = steps.findIndex((s) => s.key === from);
    if (at <= 0) return from;
    return steps[at - 1].key;
}

export function isLastStep(trade: string, step: StepKey, ctx?: StepContext): boolean {
    const steps = stepsFor(trade, ctx);
    return steps.length > 0 && steps[steps.length - 1].key === step;
}

// A step restored from a draft, made safe.
//
// Somebody can leave on step 4 as a plumber, come back having changed their
// trade to cleaner, and step 4 no longer exists. Rather than land them on a
// blank panel or throw, this falls back to the last step the trade does have,
// which is where their work actually got to.
export function resolveStep(trade: string, wanted: string | null | undefined, ctx?: StepContext): StepKey {
    const steps = stepsFor(trade, ctx);
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
    business: ['business_name', 'contact_email', 'description', 'areas', 'availability'],
    credentials: ['registration_'],
    prices: [
        'prices', 'price_', 'hours_', 'hourly_rate', 'callout_fee', 'extra_price_',
        // The cleaner's per-hour route.
        'billable_hourly_rate', 'covered_bands',
    ],
    // The guest steps' field ownership is filled in with the render + validation
    // slice, where stepForField also becomes context-aware (several fields —
    // description, contact_email, areas — move off 'business' for a guest). Empty
    // for now: the component does not yet drive these steps, so nothing maps here.
    g_about: [],
    g_offer: [],
    g_menu: [],
    g_avail: [],
    g_you: [],
    g_diet: [],
    g_area: [],
    g_checks: [],
    g_contact: [],
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
    problems: Problem[] | null | undefined,
    ctx?: StepContext
): StepKey | null {
    for (const step of stepsFor(trade, ctx)) {
        if (problemsOnStep(problems, step.key).length > 0) return step.key;
    }
    return null;
}

// ---------------------------------------------------------------------------
// WHICH STEP THE FORM OPENS ON
// ---------------------------------------------------------------------------
//
// This was a `useEffect` in ProviderSignUp, and it cost an evening.
//
// A successful application set `restored` back to false to clear the "your
// details have been saved" banner. That happened to be the one condition
// holding this rule back, so it ran again and moved the applicant to the
// business step — of a form that was now locked, with the panel confirming
// their application only rendering on the finish step. So it was never seen,
// and a sent application and a refused one ended on exactly the same screen.
//
// Indistinguishable success is the fault this whole flow exists to prevent, so
// the rule is out here where it can be tested rather than inferred from a
// dependency array.
//
// `null` means LEAVE THE STEP ALONE. It is a real answer and the common one:
// most renders must not move anybody.

export interface OpeningState {
    // The initial load has finished. Before that nothing is known and nothing
    // should move.
    hydrated: boolean;
    // A draft was found and has already decided where they are.
    restored: boolean;
    // The application has been sent. Nothing may move them off the screen that
    // says so.
    lodged: boolean;
    // The trade from the URL. Empty means step one has not been answered.
    trade: string;
    // A guest arrives with trade='guest' already in the URL, but the category is
    // the guest's version of step one and is not yet answered. When true, open on
    // the picker (the category grid) rather than skipping it as an answered trade.
    guestNeedsCategory?: boolean;
}

export function openingStep(state: OpeningState): StepKey | null {
    if (!state.hydrated) return null;

    // First, and before `restored`: sending clears the draft, so a lodged
    // application is never also a restored one, and the order has to say which
    // wins if that ever stops being true.
    if (state.lodged) return 'finish';

    if (state.restored) return null;

    // A guest whose trade is set but whose category is not has still not
    // answered step one — the category grid is their picker. Send them to it.
    if (state.guestNeedsCategory) return 'trade';

    // A trade in the URL means step one is already answered — they came back
    // through a link, or they have a saved record — so opening on the picker
    // would make them answer it twice.
    return state.trade ? 'business' : 'trade';
}

// What counts as already seen when opening there. Everything up to and
// including the step itself, so the step they land on shows its own errors
// rather than looking finished; steps ahead stay quiet.
export function openingVisited(state: OpeningState): StepKey[] | null {
    const step = openingStep(state);
    if (step === null) return null;
    if (step === 'trade') return [];
    if (step === 'finish') return stepsFor(state.trade).map((s) => s.key);
    return ['trade'];
}
