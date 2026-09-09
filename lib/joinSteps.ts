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
    checksFor,
    guestAsksExpertise,
} from '@/lib/serviceProviders';
import { GUEST_SCREEN_COPY } from '@/lib/strings';

// The host trades keep 'trade' | 'business' | 'credentials' | 'prices' |
// 'finish'. The guest experience used to collapse ALL of its application into
// 'business' (one long scroll); it is now split into its own screens, each a
// 'g_' key. The guest keys are gated on the category and the booking shape, and
// they are OFF entirely unless the component passes a StepContext — so a guest
// with no context still sees the old trade/business/finish, and no host trade
// ever gains one. See stepApplies.
export type StepKey =
    | 'trade' | 'g_subtype' | 'g_verify' | 'business'
    | 'g_you' | 'g_creds' | 'g_about' | 'g_capacity' | 'g_menu' | 'g_expect' | 'g_photos' | 'g_area' | 'g_checks' | 'g_contact'
    | 'credentials' | 'prices' | 'finish';

// The guest-only steps, in flow order. Rebuilt against Airbnb's host-an-
// experience flow (Sep 2026): the booking shape is inferred from the category
// and never asked (the old g_offer is gone), availability folds into the
// where-and-when step (the old g_avail), dietary folds into "what guests can
// expect" (the old g_diet), and three screens Airbnb has and we lacked are
// added — expertise/qualifications (g_creds), what-to-expect (g_expect) and a
// real photos step (g_photos). There is NO naming step: a guest experience is a
// person, so the listing title is their account name (or a trading name they set
// later in account settings), derived at submit — never asked. The name itself
// is captured at the account step (the g_verify gate), which is account
// information; a guest never sees the standalone 'business' step.
// Airbnb's host-an-experience sequence (Sep 2026): sub-type, then About you
// (years, expertise), then Location straight after — it matters more for us than
// for them, a chef in Carlisle should learn we only cover Dumfries & Galloway
// before writing anything — then Photos, Pricing, Details, and the Finish
// wrap-up (checks, contact, account).
const GUEST_STEP_KEYS: StepKey[] = [
    'g_verify', 'g_subtype',
    'g_you', 'g_creds', 'g_area', 'g_photos', 'g_capacity', 'g_menu', 'g_expect', 'g_checks', 'g_contact',
];

// What a guest's steps branch on, all from earlier answers: the top-level group
// (does it have a sub-type screen), the sub-type category (its `food` flag) and
// the booking shape. Never a hand-coded per-category list.
export interface StepContext {
    group?: string | null;
    category?: string | null;
    shape?: string | null;
    // Whether a verified session already exists. The guest flow now signs the
    // applicant in up front (email OTP), right after the category pick, so the
    // rest of the wizard runs authenticated — photos upload, everything saves to
    // the database, and the finish screen is a real submit. The verify step
    // (g_verify) only exists while there is NO session: a returning applicant
    // who is already signed in never sees it.
    hasSession?: boolean;
}

export interface Step {
    key: StepKey;
    // What the indicator says. Short: it sits under a dot on a 375px screen.
    label: string;
    // The heading inside the step.
    title: string;
}

const ALL_STEPS: Step[] = [
    // The verify-your-email gate is the guest's FIRST screen — before the
    // category picker, before anything. Picking "Host a guest experience" on
    // the fork lands them here; nothing comes before the account. Guest-only
    // and off once a session exists, so a host trade still opens on 'trade' and
    // a returning applicant skips straight past. See stepApplies / openingStep.
    { key: 'g_verify', label: 'Account', title: 'Verify your email to carry on' },
    { key: 'trade', label: 'Trade', title: 'What do you do?' },
    // A guest's second screen: the narrower choices under the group they picked
    // (Airbnb's "How would you describe your experience?"). Off for 'other'.
    { key: 'g_subtype', label: 'Type', title: 'How would you describe it?' },
    { key: 'business', label: 'Business', title: 'Your business' },
    // The guest experience, one question a screen, in Airbnb's order (see
    // GUEST_STEP_KEYS for the reasoning): About you (years, expertise), then
    // Location, then Photos before the writing, then Pricing and Details, then
    // the naming/describing near the end, then the Finish wrap-up. Which of them
    // a given guest sees is decided by stepApplies from the category and shape;
    // the standalone 'business' step above is host-only. The `label` is the old
    // per-dot label, now superseded by the named sections (see GUEST_SECTIONS);
    // it is kept for the host trades and harmless for guests.
    { key: 'g_you', label: 'You', title: GUEST_SCREEN_COPY.yearsQuestion },
    { key: 'g_creds', label: 'Expertise', title: GUEST_SCREEN_COPY.expertiseHeading },
    { key: 'g_area', label: 'Where', title: 'Where, and when, can guests get it?' },
    { key: 'g_photos', label: 'Photos', title: 'Show guests what it looks like' },
    // The Pricing section opens with the capacity question (Airbnb's order),
    // then the priced offerings. Shown only where a group size is meaningful —
    // comes-to-you and slot — so a made-to-order product (cakes, hampers) and
    // 'other' skip it. The heading is worded per shape in the form.
    { key: 'g_capacity', label: 'Guests', title: 'How many guests?' },
    { key: 'g_menu', label: 'Price', title: 'What you offer, and what it costs' },
    { key: 'g_expect', label: 'Details', title: 'What can a guest expect?' },
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

    // Every host business has a name and someone behind it, on its own step.
    // A guest carries the name on g_about ("Name it, and tell guests what it
    // is"), so once the guest split is on (a context is passed) the standalone
    // business step falls away for them — otherwise they'd name it twice.
    if (step === 'business') {
        if (audienceForTrade(key) === 'guest' && ctx) return false;
        return true;
    }

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
            // The sub-type screen, only when the chosen group has one. 'other'
            // is alone under its group, so it goes straight to the business step.
            case 'g_subtype':
                return !!ctx.group && ctx.group !== 'other';
            // The verify-your-email gate — the guest's FIRST screen, before the
            // category picker. Every guest passes through it EXCEPT one who is
            // already signed in (a returning applicant). No category or shape
            // gate, because it runs before either is picked: making the account
            // is the same question whatever they go on to list.
            case 'g_verify':
                return !ctx.hasSession;
            // The years opener (g_you) and the expertise screen (g_creds) are
            // shown for everyone EXCEPT a made-to-order product — you're buying a
            // cake or a hamper, not the maker, so we don't ask about the person.
            // guestAsksExpertise decides; the required-vs-optional split within
            // the "asked" set is a Next-gate in the form, not a step gate.
            case 'g_you':
            case 'g_creds':
                return guestAsksExpertise(ctx.category);
            // Asked of every guest: the price (g_menu), what a guest can expect
            // (g_expect), the photos (g_photos) and how to reach them (g_contact).
            // There is no naming step — the title is derived from the account.
            case 'g_menu':
            case 'g_expect':
            case 'g_photos':
            case 'g_contact':
                return true;
            // Maximum guests. Only where a group size means something: the
            // provider travels to the guest (comes_to_you) or the guests come to
            // a session (slot). A made-to-order product has no guests, and
            // 'other' has no shape, so both skip it.
            case 'g_capacity':
                return shape === 'comes_to_you' || shape === 'slot';
            // The checks sub-flow: the declarations this category has to
            // confirm. Always at least the two universal ones (insurance and
            // accuracy), so it is on for every guest — but computed from
            // checksFor so it would fall away by itself if a category ever had
            // nothing to ask, rather than a hand-set true.
            case 'g_checks':
                return checksFor(ctx.category).length > 0;
            // Where and when, in one step. Every guest needs a location —
            // submitProblems requires at least one area for anyone, and the
            // marketplace has to know where they are. The wording adapts (how
            // far will you travel vs where is it), and the shape decides whether
            // a schedule shows inside it: a slot picks weekly hours, a
            // made-to-order sets a lead time, a comes-to-you arranges it on the
            // enquiry. The step is always there so nobody is stranded on an
            // areas or availability error with no screen to fix it on.
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

// ---------------------------------------------------------------------------
// NAMED SECTIONS (the guest progress rail)
//
// Airbnb shows a handful of named sections, not a "Step 5 of 12" count. The
// guest flow groups its screens the same way: a couple of screens can share a
// section (About you is the years screen and the expertise hub; Finish is the
// checks, the contact and the account screen), and a section renders only when
// at least one of its steps applies to this guest — the same rule that governs
// the steps themselves, so the rail can never name a section nobody reaches.
//
// The two pickers (trade, g_subtype) precede the rail and belong to no section:
// the flow BRANCHES on those two answers, so the rail can't sensibly be drawn
// until they're made, and listing them as jump-back targets would imply you can
// change category mid-flow and invalidate everything after it.
// ---------------------------------------------------------------------------

const GUEST_SECTIONS: { key: string; label: string; steps: StepKey[] }[] = [
    { key: 'about', label: GUEST_SCREEN_COPY.sectionAboutYou, steps: ['g_you', 'g_creds'] },
    { key: 'location', label: GUEST_SCREEN_COPY.sectionLocation, steps: ['g_area'] },
    { key: 'photos', label: GUEST_SCREEN_COPY.sectionPhotos, steps: ['g_photos'] },
    { key: 'pricing', label: GUEST_SCREEN_COPY.sectionPricing, steps: ['g_capacity', 'g_menu'] },
    { key: 'details', label: GUEST_SCREEN_COPY.sectionDetails, steps: ['g_expect'] },
    { key: 'finish', label: GUEST_SCREEN_COPY.sectionFinish, steps: ['g_checks', 'g_contact', 'finish'] },
];

export interface FlowSection {
    key: string;
    label: string;
    // The steps of this section that this guest actually has, in flow order.
    steps: StepKey[];
    // Where clicking the section in the rail takes them: its first live step.
    firstStep: StepKey;
}

// The sections this guest actually walks, in order, each carrying only the
// steps that apply. Empty for a host trade or a guest with no context (the
// rail is guest-only) — callers fall back to the old indicator in that case.
export function sectionsFor(trade: string, ctx?: StepContext): FlowSection[] {
    if (audienceForTrade(String(trade || '')) !== 'guest' || !ctx) return [];
    const present = stepsFor(trade, ctx).map((s) => s.key);
    const out: FlowSection[] = [];
    for (const sec of GUEST_SECTIONS) {
        const steps = sec.steps.filter((k) => present.indexOf(k) !== -1);
        if (steps.length > 0) out.push({ key: sec.key, label: sec.label, steps, firstStep: steps[0] });
    }
    return out;
}

// The section a given step sits in, or null for the pre-rail pickers. Used for
// the eyebrow at the top of each screen.
export function sectionForStep(step: StepKey): { key: string; label: string } | null {
    for (const sec of GUEST_SECTIONS) {
        if (sec.steps.indexOf(step) !== -1) return { key: sec.key, label: sec.label };
    }
    return null;
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
    g_subtype: [],
    g_verify: [],
    g_you: [],
    g_creds: [],
    g_about: [],
    g_capacity: [],
    g_menu: [],
    g_expect: [],
    g_photos: [],
    g_area: [],
    g_checks: [],
    g_contact: [],
    finish: [],
};

// The guest field→step map. Only the fields submitProblems can actually raise
// for a guest are listed (business_name, description, areas, availability for a
// slot, contact_email) — everything else the guest form collects (shape, menu,
// dietary, headshot) is non-blocking, so it belongs to no step's Next. Several
// of these fields sit on 'business' for a host but move to their own screen for
// a guest, which is the whole reason stepForField takes a context.
const GUEST_STEP_FIELDS: Partial<Record<StepKey, string[]>> = {
    trade: ['trade', 'audience'],
    // No naming step for a guest: business_name is derived from the account at
    // submit, not asked, so it belongs to no step's Next.
    // Location and the weekly hours both live on the where-and-when step.
    g_area: ['areas', 'availability'],
    g_contact: ['contact_email', 'contact_phone'],
};

// Which step an error belongs on. With a guest context, the guest map is used
// (the split moves description/areas/contact off 'business'); without one, the
// host map — so a trade's validation is byte-for-byte what it was.
export function stepForField(field: string, ctx?: StepContext): StepKey | null {
    const name = String(field || '');
    const map: Partial<Record<StepKey, string[]>> = ctx ? GUEST_STEP_FIELDS : STEP_FIELDS;

    for (const key of Object.keys(map) as StepKey[]) {
        for (const match of (map[key] || [])) {
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

export function problemsOnStep(problems: Problem[] | null | undefined, step: StepKey, ctx?: StepContext): Problem[] {
    return (problems || []).filter((p) => stepForField(p.field, ctx) === step);
}

// The first step that still has something wrong with it, so send can take
// somebody there rather than telling them to go and look.
export function firstStepWithProblem(
    trade: string,
    problems: Problem[] | null | undefined,
    ctx?: StepContext
): StepKey | null {
    for (const step of stepsFor(trade, ctx)) {
        if (problemsOnStep(problems, step.key, ctx).length > 0) return step.key;
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
    // Whether a verified session already exists. A guest with none opens on the
    // verify gate — the first screen, before the category picker. Nothing comes
    // before the account.
    hasSession?: boolean;
    // The guest's chosen category. Decides their first content screen: the
    // About-you opener (g_you) for a category that asks about expertise, else
    // Location (g_area), which every guest has. Without it a category that skips
    // the expertise screens (a sauna) would open on g_you, a step it does not
    // have.
    category?: string | null;
}

export function openingStep(state: OpeningState): StepKey | null {
    if (!state.hydrated) return null;

    // First, and before `restored`: sending clears the draft, so a lodged
    // application is never also a restored one, and the order has to say which
    // wins if that ever stops being true.
    if (state.lodged) return 'finish';

    if (state.restored) return null;

    // A guest who is not signed in opens on the verify gate — the first screen,
    // before the category picker. This is ahead of the category check below: the
    // account comes before anything they might pick.
    if (audienceForTrade(state.trade) === 'guest' && !state.hasSession) return 'g_verify';

    // A guest whose trade is set but whose category is not has still not
    // answered step one — the category grid is their picker. Send them to it.
    if (state.guestNeedsCategory) return 'trade';

    // A trade in the URL means step one is already answered — they came back
    // through a link, or they have a saved record — so opening on the picker
    // would make them answer it twice. A guest has no business step; their first
    // content screen is the About-you opener (g_you), or Location (g_area) for a
    // category that skips the expertise screens — the same rule the forward flow
    // uses after the sub-type pick, so a returning sauna owner lands on the
    // where-and-when step (its schedule) rather than a step it does not have.
    if (!state.trade) return 'trade';
    if (audienceForTrade(state.trade) !== 'guest') return 'business';
    return guestAsksExpertise(state.category) ? 'g_you' : 'g_area';
}

// What counts as already seen when opening there. Everything up to and
// including the step itself, so the step they land on shows its own errors
// rather than looking finished; steps ahead stay quiet.
export function openingVisited(state: OpeningState): StepKey[] | null {
    const step = openingStep(state);
    if (step === null) return null;
    // The verify gate and the trade picker are both the first thing a person
    // sees on their respective flows, so nothing is behind them yet.
    if (step === 'g_verify' || step === 'trade') return [];
    if (step === 'finish') return stepsFor(state.trade).map((s) => s.key);
    return ['trade'];
}
