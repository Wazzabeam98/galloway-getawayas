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
    guestAsksExpertise,
    guestNeedsShapeChoice,
    slotAsksWhereFork,
    slotDurationPerItem,
    slotMixedDuration,
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
    | 'trade' | 'g_subtype' | 'business' | 'b_area'
    | 'g_you' | 'g_creds' | 'g_about' | 'g_shape' | 'g_slot_basis' | 'g_capacity' | 'g_slot_min' | 'g_menu' | 'g_title' | 'g_expect' | 'g_photos' | 'g_notice' | 'g_slot_where' | 'g_area' | 'g_slot_length' | 'g_slot_hours'
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
// is captured by the shared email-first sign-in (EmailFirstStep), which is
// account information; a guest never sees the standalone 'business' step.
// Airbnb's host-an-experience sequence (Sep 2026): sub-type, then About you
// (years, expertise), then Location straight after — it matters more for us than
// for them, a chef in Carlisle should learn we only cover Dumfries & Galloway
// before writing anything — then Photos, Pricing, Details, and the Finish
// screen (the account, with a single responsibility confirmation folded in).
// There is no standalone checks step (collapsed to one confirmation that lives
// on the finish screen) and no contact step (a guest signs in up front, so the
// account address is the contact address, and the phone lives on the profile).
const GUEST_STEP_KEYS: StepKey[] = [
    'g_subtype',
    // g_slot_hours stays in this registry — it is what marks it a GUEST step and
    // gates it away from host trades (stepApplies returns false for non-guests on
    // a listed key). It is retired for guests too, by its case returning false and
    // by its removal from the When section rail; it is never shown, but it must
    // remain listed here or it leaks into host flows.
    'g_you', 'g_creds', 'g_shape', 'g_notice', 'g_slot_where', 'g_area', 'g_slot_length', 'g_slot_hours', 'g_photos', 'g_slot_basis', 'g_capacity', 'g_slot_min', 'g_menu', 'g_title', 'g_expect',
];

// What a guest's steps branch on, all from earlier answers: the top-level group
// (does it have a sub-type screen), the sub-type category (its `food` flag) and
// the booking shape. Never a hand-coded per-category list.
export interface StepContext {
    group?: string | null;
    category?: string | null;
    shape?: string | null;
    // What a slot provider offers: 'private' (the whole session for one group),
    // 'shared' (several people join, per person), 'both' (either — each time sold
    // as whichever books first), null = not yet answered. The per-person MINIMUM
    // screen (g_slot_min) exists only when a SHARED table is offered ('shared' or
    // 'both') — a whole-group flat price is one booking regardless of head count,
    // so a minimum-people rule is meaningless for private-only. Carried into the
    // context so the step model can add or drop that one screen, the same way
    // shape adds or drops g_capacity.
    slotOffer?: 'private' | 'shared' | 'both' | null;
    // How a slot is fulfilled: 'collection' (guests come to the provider),
    // 'delivery' (the provider travels to the guest), '' = not yet / n/a. A
    // MIXED provider (yoga, pottery, painting) who travels sells only private
    // sessions — no one books a place in a class held in someone's cottage — so
    // the provider-level session-length and capacity screens have no meaning and
    // drop, the same way the shared-vs-private question does. Carried here so the
    // step model can derive that, rather than the wizard hiding the screen while
    // still asking underneath.
    fulfilment?: string | null;
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
    // A guest's second screen: the narrower choices under the group they picked
    // (Airbnb's "How would you describe your experience?"). Off for 'other'.
    { key: 'g_subtype', label: 'Type', title: 'How would you describe it?' },
    // "Something else" has no sub-type screen, so this is its second picker: how
    // guests book it (set times / made to order / you go to them). It sits right
    // after step one, before About you, so "How many years have you been doing
    // this?" follows a provider having said what "this" is (Liam, 5 Oct 2026 —
    // it used to come after About you, under a "Location" eyebrow).
    // Everything after it (the location model, the When/Pricing screens, what's
    // stored) then follows exactly as for a real category of that shape. Only
    // shown for a null-shape category; every real one answered this at its pick.
    { key: 'g_shape', label: 'Format', title: GUEST_SCREEN_COPY.shapeQuestion },
    // About you (years, then the expertise hub), one question a screen, in
    // Airbnb's order. These come BEFORE the host 'business' step so a trade opens
    // on the years counter and the "Tell hosts about yourself" hub, the same way
    // a guest opens on the years counter and "Tell guests about yourself" — the
    // two flows share these screens now. For a guest the 'business' step below is
    // filtered out (stepApplies), so their order is unchanged; only host trades
    // gain these two, first. The `label` is the old per-dot label, superseded by
    // the named sections (see GUEST_SECTIONS / TRADE_SECTIONS).
    { key: 'g_you', label: 'You', title: GUEST_SCREEN_COPY.yearsQuestion },
    { key: 'g_creds', label: 'Expertise', title: GUEST_SCREEN_COPY.expertiseHeading },
    // The host 'business' section, split one question a screen the way the guest
    // experience is — a name screen, a coverage screen, a contact screen — rather
    // than four questions crammed onto one page. All three are host-only (a guest
    // carries its name on the account and its coverage on g_area), grouped under
    // the one "Your business" rail section (TRADE_SECTIONS). See stepApplies.
    { key: 'business', label: 'Business', title: 'What’s your business called?' },
    { key: 'b_area', label: 'Coverage', title: 'Where do you cover?' },
    // Slot only, and only the three either-way categories (yoga, massage,
    // painting): does the guest come to a place the host names, or does the host
    // travel to the guest's cottage? It sets `fulfilment` (collection vs delivery)
    // the way made-to-order's own fork does, so g_area then shows an address or
    // the coverage regions. The other slot categories default and skip it.
    { key: 'g_slot_where', label: 'Where', title: GUEST_SCREEN_COPY.slotWhereQuestion },
    // g_area is now purely the PLACE: an address (come-to-me) or the coverage
    // regions (travel). A slot's session length and weekly hours moved to their
    // own When section (g_slot_length, g_slot_hours), so the old "Where, and when"
    // heading no longer applies — the form picks an honest per-shape heading (see
    // the h1 logic). Made-to-order's fulfilment fork still lives on this screen.
    { key: 'g_area', label: 'Where', title: 'Where, and when, can guests get it?' },
    // Made-to-order only: the notice period. After "How do guests get it?"
    // (g_area) and in the When section — a notice period is a when, and it read
    // oddly first, under a "Location" eyebrow, before the where was settled.
    { key: 'g_notice', label: 'Notice', title: GUEST_SCREEN_COPY.noticeQuestion },
    // The When section (slots only), split out of the old overloaded schedule
    // screen so each label matches its one question: session length, then the
    // weekly hours (with the odd day off folded in as the hours' exception).
    { key: 'g_slot_length', label: 'Length', title: GUEST_SCREEN_COPY.slotLengthQuestion },
    { key: 'g_slot_hours', label: 'Hours', title: GUEST_SCREEN_COPY.slotHoursQuestion },
    { key: 'g_photos', label: 'Photos', title: 'Show guests what it looks like' },
    // The Pricing section opens with the capacity question (Airbnb's order),
    // then the priced offerings. Shown only where a group size is meaningful —
    // comes-to-you and slot — so a made-to-order product (cakes, hampers) and
    // 'other' skip it. The heading is worded per shape in the form.
    // Slot only, and the first screen of the Pricing section: whether a session
    // is private (the whole thing for one group, one flat booking) or shared
    // (several people join, priced per person). It sets the price UNIT that
    // g_menu reads and decides whether the per-person minimum screen exists at
    // all, so it comes before both. Lifted off g_area, where it used to crowd
    // the schedule; its own screen now, one question.
    { key: 'g_slot_basis', label: 'Basis', title: GUEST_SCREEN_COPY.slotBasisQuestion },
    { key: 'g_capacity', label: 'Guests', title: 'How many guests?' },
    // Per-person slots only: the smallest group a single booking may be. Its own
    // stepper screen (like years/guests), default 1 = no minimum. Sits between
    // the ceiling (g_capacity) and the price, so a host sets "up to N, at least
    // M" as one thought. Dropped entirely for a private/whole-group slot.
    { key: 'g_slot_min', label: 'Minimum', title: GUEST_SCREEN_COPY.slotMinQuestion },
    { key: 'g_menu', label: 'Price', title: 'What you offer, and what it costs' },
    // The listing's own name — what the EXPERIENCE is called, not what the person
    // is. It becomes business_name (the denormalised display copy the card, the
    // marketplace sort, the review queue and the order/emails all read), so the
    // guest's first line describes the thing they're buying; the professional
    // title moved to the About block as a credential. Its own step, first in the
    // Details section, near the end — the naming/describing moment the original
    // flow always placed here.
    { key: 'g_title', label: 'Title', title: GUEST_SCREEN_COPY.experienceTitleQuestion },
    { key: 'g_expect', label: 'Details', title: 'What can a guest expect?' },
    // Not "Registration". Registration and skills never co-occur across the
    // trade list — the electrician and plumber give numbers, the handyman gives
    // skills, nobody does both — so a step called Registration was wrong for
    // the handyman every single time. "What you do" is true of all three, and
    // of the capability lists that now sit here; the registration numbers keep
    // their own heading inside it, which is honest, because being registered is
    // a fact about what you are allowed to do.
    // The rail/eyebrow says the section ("What you do"); the on-screen heading has
    // to be a DIFFERENT question, the way every guest page's heading differs from
    // its section eyebrow — otherwise the same words show twice, as eyebrow and h1.
    { key: 'credentials', label: 'What you do', title: 'What kind of work do you do?' },
    { key: 'prices', label: 'Prices', title: 'What you charge' },
    { key: 'finish', label: 'Finish', title: 'Photos and your account' },
];

// Whether a trade has anything to ask on a given step.
//
// Written as one function per step rather than a table, because each answer is
// a different question and a table would hide that behind a column of trues.
// A mixed slot provider (yoga, pottery, painting) who TRAVELS to the guest sells
// only private sessions — nobody joins a class held in someone else's cottage —
// so the provider-level session-length and capacity screens have no meaning and
// drop. Come-to-me mixed providers keep both (their group classes need them).
function travellingMixedSlot(ctx: StepContext): boolean {
    return ctx.shape === 'slot' && slotMixedDuration(ctx.category) && ctx.fulfilment === 'delivery';
}

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

    // The coverage screen of the host 'business' section is host-only. A guest
    // carries its coverage on g_area, so it never appears for them; every host
    // trade has it. (It sits outside the GUEST_STEP_KEYS gate below, which would
    // otherwise let the trailing `return true` hand it to a guest.) There is no
    // separate contact screen any more — the email is the one they signed in with,
    // and the optional phone / don't-text tick moved to the finish screen.
    if (step === 'b_area') {
        return audienceForTrade(key) === 'host';
    }

    // The About-you screens (the years opener and the expertise hub) are the
    // one pair of g_ keys shared with the host trades. A host trade ALWAYS has
    // both — the trades sign-up now opens on the same years counter and the same
    // "Tell hosts about yourself" hub the guest experience uses. A guest gets
    // them for the categories that ask about the person (guestAsksExpertise);
    // without a context (the old single-step flow) a guest has neither. This sits
    // before the GUEST_STEP_KEYS gate below, which would otherwise refuse a g_
    // key for any non-guest.
    if (step === 'g_you' || step === 'g_creds') {
        const aud = audienceForTrade(key);
        // A host trade always has both (the years opener and the expertise hub).
        if (aud === 'host') return true;
        // A guest (trade='guest', category in ctx) has them for the categories
        // that ask about the person — and only once a context is supplied.
        if (aud === 'guest') return ctx ? guestAsksExpertise(ctx.category) : false;
        // Anything else — a bare category key, an unknown trade — has neither.
        return false;
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
            // g_you (years) and g_creds (the expertise hub) are handled ABOVE this
            // block, because they are shared with the host trades — for a guest
            // they follow guestAsksExpertise (shown for everyone except a
            // made-to-order product, where you buy a cake, not the maker). See the
            // g_you/g_creds branch before the GUEST_STEP_KEYS gate.
            // Asked of every guest: the price (g_menu), the listing's name
            // (g_title — what the experience is called), what a guest can expect
            // (g_expect) and the photos (g_photos). No contact step (the account
            // address is the contact address) and no checks step (collapsed to one
            // confirmation on the finish screen).
            case 'g_menu':
            case 'g_title':
            case 'g_expect':
            case 'g_photos':
                return true;
            // Maximum guests. Only where a group size means something: the
            // provider travels to the guest (comes_to_you) or the guests come to
            // a session (slot). A made-to-order product has no guests, and
            // 'other' has no shape, so both skip it.
            // The private/shared pricing basis — slot only. A made-to-order
            // product and a traveller price per item/enquiry, not per session.
            // The private/shared basis is fixed for the one-at-a-time shape (a
            // treatment is a whole-session price for one person) AND not asked for
            // the mixed shape (there each item picks shared-class vs one-at-a-time
            // in its own sub-flow) — so both skip it. Every other slot still asks.
            // Capacity stays asked for a COME-TO-ME mixed provider (its classes need
            // a size); a TRAVELLING mixed provider sells only private sessions, so
            // capacity is meaningless and drops — same as pure one-at-a-time.
            case 'g_slot_basis':
                return shape === 'slot' && !slotDurationPerItem(ctx.category) && !slotMixedDuration(ctx.category);
            case 'g_capacity':
                return shape === 'comes_to_you' || (shape === 'slot' && !slotDurationPerItem(ctx.category) && !travellingMixedSlot(ctx));
            // The per-person minimum — a slot that is priced per person (the
            // shared answer). A private/whole-group slot is one booking whatever
            // the head count, so it has no minimum-people rule and no screen.
            //
            // For a fixed-basis slot that answer is the provider-level slotOffer;
            // null (not yet answered) hides it too — the basis screen comes first.
            // A MIXED provider (yoga, pottery, painting) answers shared-vs-private
            // PER ITEM, so slotOffer is never set — but a come-to-me mixed provider
            // can still run a shared class (which is exactly why its capacity screen
            // is shown), and that class needs a minimum. The minimum is capacity's
            // twin, so it must appear on the same path. A TRAVELLING mixed provider
            // sells only private sessions, so it correctly keeps no minimum.
            case 'g_slot_min':
                return shape === 'slot' && (
                    ctx.slotOffer === 'shared' || ctx.slotOffer === 'both'
                    || (slotMixedDuration(ctx.category) && !travellingMixedSlot(ctx))
                );
            // The booking-shape question — only for a category that never declared
            // one ("something else"). A real sub-type settled its shape at the
            // picker, so it never sees this. Sits before the location step, which
            // reads the shape it sets.
            case 'g_shape':
                return guestNeedsShapeChoice(ctx.category);
            // The notice period, made-to-order only — its own screen before the
            // delivery areas. Other shapes have no notice (a slot has a schedule
            // inside g_area; a traveller arranges it on the enquiry).
            case 'g_notice':
                return shape === 'made_to_order';
            // The come-to-me / travel fork — slot only, and only the three
            // categories that genuinely go either way. The rest default to
            // come-to-me (see defaultSlotFulfilment) and never see this screen.
            case 'g_slot_where':
                return shape === 'slot' && slotAsksWhereFork(ctx.category);
            // The location (the PLACE), every guest. A made-to-order's notice
            // moved to g_notice; a slot's length and hours moved to the When
            // section; so this is now purely the address or the coverage regions.
            // Always present so nobody is stranded on an areas error with no
            // screen to fix it on.
            case 'g_area':
                return true;
            // The When section — slots only. Session length, then weekly hours.
            // The one-at-a-time shape asks length PER TREATMENT (in the item
            // sub-flow), so it skips the single provider-length screen; a
            // TRAVELLING mixed provider does too (every item is a private session
            // with its own length). Both still set weekly hours.
            case 'g_slot_length':
                return shape === 'slot' && !slotDurationPerItem(ctx.category) && !travellingMixedSlot(ctx);
            // g_slot_hours retired from the wizard — weekly hours are set in the
            // listing editor's Availability section, not at sign-up.
            case 'g_slot_hours':
                return false;
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
// section (About you is the years screen and the expertise hub; Finish is now
// the single account screen, with a responsibility confirmation folded in), and
// a section renders only when
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
    // g_shape is a picker now (it precedes the rail, like g_subtype) — the flow
    // branches on it, so it belongs to no section.
    { key: 'location', label: GUEST_SCREEN_COPY.sectionLocation, steps: ['g_slot_where', 'g_area'] },
    // Slots only: session length. Weekly HOURS have left the wizard — they live
    // in the listing editor's Availability section now (one home for the weekly
    // template), so a slot provider sets a length at create and their hours after,
    // in the editor. A section with no live steps drops out of the rail
    // (sectionsFor filters by stepApplies), so a made-to-order or comes-to-you
    // guest never sees a "When" section at all.
    // A made-to-order's notice period is its When.
    { key: 'when', label: GUEST_SCREEN_COPY.sectionWhen, steps: ['g_notice', 'g_slot_length'] },
    { key: 'photos', label: GUEST_SCREEN_COPY.sectionPhotos, steps: ['g_photos'] },
    { key: 'pricing', label: GUEST_SCREEN_COPY.sectionPricing, steps: ['g_slot_basis', 'g_capacity', 'g_slot_min', 'g_menu'] },
    { key: 'details', label: GUEST_SCREEN_COPY.sectionDetails, steps: ['g_title', 'g_expect'] },
    // Finish is now a single screen: the account, with one responsibility
    // confirmation folded in above submit. The old checks and contact steps that
    // shared this section are gone.
    { key: 'finish', label: GUEST_SCREEN_COPY.sectionFinish, steps: ['finish'] },
];

// The host-trade sections, the left-rail equivalent of GUEST_SECTIONS. A trade
// walks the same full-page wizard now, so its steps group into named sections
// too. The `trade` picker is pre-rail (like the guest pickers) — the flow
// branches on it — so it belongs to no section. A section whose only step
// doesn't apply to a given trade drops out (sectionsFor filters by stepApplies),
// e.g. a cleaner with no separate credentials step.
const TRADE_SECTIONS: { key: string; label: string; steps: StepKey[] }[] = [
    // About you comes first, the same as the guest rail: the years opener and the
    // "Tell hosts about yourself" expertise hub, shared with the guest flow.
    { key: 'about', label: GUEST_SCREEN_COPY.sectionAboutYou, steps: ['g_you', 'g_creds'] },
    // One section, three screens — the same shape as the guest "About you"
    // (years + expertise) or "Location" (several screens): the name, then the
    // coverage, then the contact details, one question a screen.
    { key: 'business', label: 'Your business', steps: ['business', 'b_area'] },
    { key: 'credentials', label: 'What you do', steps: ['credentials'] },
    { key: 'prices', label: 'What you charge', steps: ['prices'] },
    { key: 'finish', label: 'Finish', steps: ['finish'] },
];

export interface FlowSection {
    key: string;
    label: string;
    // The steps of this section that this guest actually has, in flow order.
    steps: StepKey[];
    // Where clicking the section in the rail takes them: its first live step.
    firstStep: StepKey;
}

// The sections this applicant actually walks, in order, each carrying only the
// steps that apply. Guests use GUEST_SECTIONS (and need a context); a host trade
// uses TRADE_SECTIONS. Empty only for a guest with no context yet.
export function sectionsFor(trade: string, ctx?: StepContext): FlowSection[] {
    const isGuest = audienceForTrade(String(trade || '')) === 'guest';
    if (isGuest && !ctx) return [];
    const catalogue = isGuest ? GUEST_SECTIONS : TRADE_SECTIONS;
    const present = stepsFor(trade, ctx).map((s) => s.key);
    const out: FlowSection[] = [];
    for (const sec of catalogue) {
        const steps = sec.steps.filter((k) => present.indexOf(k) !== -1);
        if (steps.length > 0) out.push({ key: sec.key, label: sec.label, steps, firstStep: steps[0] });
    }
    return out;
}

// The section a given step sits in, or null for the pre-rail pickers. Used for
// the eyebrow at the top of each screen. Searches the trade sections first for a
// host step and the guest sections for a guest step; 'finish' is shared and
// resolves to the same "Finish" label either way.
export function sectionForStep(step: StepKey): { key: string; label: string } | null {
    for (const sec of [...TRADE_SECTIONS, ...GUEST_SECTIONS]) {
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
    // 'description' has moved off the business step: a host's "about you" is now
    // the expertise hub (g_creds), whose required field is the professional
    // title. The old single business step is split one question a screen: the
    // name here and the coverage on b_area — so a greyed Next and "go to first
    // problem" each land on the screen that owns the field. (There is no contact
    // screen; the email is the account's and maps to finish as a fallback below.)
    business: ['business_name'],
    b_area: ['areas', 'availability'],
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
    g_you: [],
    // The expertise hub's one required field, for a host trade: the professional
    // title. (A guest's g_creds gates on the title in the form directly, not via
    // a submitProblems field, so its guest map entry stays empty.)
    g_creds: ['professional_title'],
    g_about: [],
    g_shape: [],
    g_slot_basis: [],
    g_capacity: [],
    g_slot_min: [],
    g_menu: [],
    g_title: [],
    g_expect: [],
    g_photos: [],
    g_notice: [],
    g_slot_where: [],
    g_area: [],
    g_slot_length: [],
    g_slot_hours: [],
    // The email is taken from the account they signed in with (not asked), so a
    // contact_email problem can only mean the session carried no address; it lands
    // on the finish screen, the last thing before submit, rather than the contact
    // step that no longer exists.
    finish: ['contact_email'],
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
    // g_area is the PLACE: the coverage regions (travel), the fulfilment fork
    // and the collection/come-to-me address. The weekly hours ('availability')
    // moved to its own When-section screen, g_slot_hours, so its error lands
    // there rather than back on the location screen.
    g_area: ['areas', 'fulfilment', 'collection_address'],
    g_slot_hours: ['availability'],
    // The per-person minimum must not exceed the capacity ceiling; that problem
    // belongs to the minimum screen, so a greyed Next and "go to first problem"
    // both land here.
    g_slot_min: ['slot_min'],
    // The priced-item requirement belongs to the pricing step, so a greyed Next
    // and "go to first problem" both land here.
    g_menu: ['menu'],
    // "What happens" IS a guest's description, and it is required (a sentence or
    // two) — so its problem belongs on the Details screen. Until 5 Oct 2026 the
    // description had no step and no field feeding it, and Send for review
    // silently did nothing for every new provider.
    g_expect: ['description'],
    // No contact step: contact_email is derived from the account at submit (so
    // submitProblems no longer raises it for a guest) and the phone lives on the
    // profile — neither belongs to a step's Next.
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
    // The trade from the URL. Empty means step one has not been answered.
    trade: string;
    // A guest arrives with trade='guest' already in the URL, but the category is
    // the guest's version of step one and is not yet answered. When true, open on
    // the picker (the category grid) rather than skipping it as an answered trade.
    guestNeedsCategory?: boolean;
    // The guest's chosen category. Decides their first content screen: the
    // About-you opener (g_you) for a category that asks about expertise, else
    // Location (g_area), which every guest has. Without it a category that skips
    // the expertise screens (a sauna) would open on g_you, a step it does not
    // have.
    category?: string | null;
}

export function openingStep(state: OpeningState): StepKey | null {
    if (!state.hydrated) return null;

    if (state.restored) return null;

    // A guest whose trade is set but whose category is not has still not
    // answered step one — the category grid is their picker. Send them to it.
    if (state.guestNeedsCategory) return 'trade';

    // A trade in the URL means step one is already answered — they came back
    // through a link, or they have a saved record — so opening on the picker
    // would make them answer it twice. Both flows open on the About-you opener
    // (g_you, the years counter) now: a host trade always has it, and a guest has
    // it for a category that asks about the person — otherwise the guest opens on
    // Location (g_area), the same rule the forward flow uses after the sub-type
    // pick, so a returning sauna owner lands on the where-and-when step rather
    // than a step it does not have.
    if (!state.trade) return 'trade';
    if (audienceForTrade(state.trade) !== 'guest') return 'g_you';
    return guestAsksExpertise(state.category) ? 'g_you' : 'g_area';
}

// What counts as already seen when opening there. Everything up to and
// including the step itself, so the step they land on shows its own errors
// rather than looking finished; steps ahead stay quiet.
export function openingVisited(state: OpeningState): StepKey[] | null {
    const step = openingStep(state);
    if (step === null) return null;
    // The trade picker is the first thing a person sees, so nothing is behind
    // it yet.
    if (step === 'trade') return [];
    return ['trade'];
}
