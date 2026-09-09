// User-facing wording, kept apart from the rules that use it.
//
// The point of this file is a single place to rewrite the words in Liam's voice
// at the end, without touching logic. Everything here is text a guest or a
// provider reads; nothing here decides behaviour. A key is stable and internal;
// only its `label` and `hint` are the copy.
//
// THE PRINCIPLE FOR A SUB-TYPE LABEL: name what the GUEST is buying, not the
// provider's job title. "Dining & private chef" over "Private chef & catering";
// "Food to order" over "Cakes & baking". Keep this when the other categories'
// wording moves here too.
//
// Started with the Food & drink sub-types (Sep 2026). The other guest
// categories still carry their wording inline in lib/serviceProviders.ts and can
// move here the same way when they are reworded.

export interface CategoryCopy {
    label: string;
    hint: string;
}

// Guest wizard screen copy. Moved here as each screen is touched (the years
// opener and the two fields that moved off it, Sep 2026); the rest still reads
// from the step model and inline until reworded.
export const GUEST_SCREEN_COPY = {
    // The years opener — one question, one number, Airbnb-style. The unit lives
    // in the question, so the stepper shows no label and no suffix.
    yearsQuestion: 'How many years have you been doing this?',

    // The named sections the flow is grouped into, Airbnb-style, shown as an
    // eyebrow above each screen's question and as a left rail on wide screens.
    // The two pickers (group, sub-type) precede the rail and carry no section —
    // the flow branches on them, so the rail can't be drawn until they're
    // answered. Checks, contact and the account screen fold into one Finish.
    sectionAboutYou: 'About you',
    sectionLocation: 'Location',
    sectionPhotos: 'Photos',
    sectionPricing: 'Pricing',
    sectionDetails: 'Details',
    sectionFinish: 'Finish',

    // The verify-email screen (g_verify) — the opening screen, where a guest signs
    // in with a one-time code. Two fields: name and email.
    // Name placeholder is DELIBERATELY EMPTY. An example name ("Rosa Muir") reads
    // as a value already filled in rather than as a hint, and the "(optional)"
    // label already says what the field is for. Leave it blank.
    verifyNamePlaceholder: '',
    // Email keeps an example: an address format reads unmistakably as a hint, not
    // as a filled-in value.
    verifyEmailPlaceholder: 'you@example.com',

    // The finish screen: a short summary of what they're submitting, then the
    // provider terms in a scrollable panel, then the agree box. The terms TEXT
    // lives in lib/providerTerms.ts (one source, swap-in-one-place); only the UI
    // chrome copy is here.
    finishSummaryHeading: 'What you’re submitting',
    finishSummaryTitle: 'Listing',
    finishSummaryCategory: 'Experience',
    finishSummaryPrice: 'Price',
    finishSummaryWhere: 'Where and when',
    finishSummaryPhotos: 'Photos',
    // The agree box beneath the terms panel. Required to send — someone who
    // won't agree to the terms shouldn't be listed. No scroll gate: the panel is
    // the opportunity to read; forcing a scroll is friction, not consent.
    termsAgreeLabel: 'I have read and agree to the provider terms and conditions.',
    termsGate: 'Agree to the provider terms and conditions before you send.',

    // The expertise screen — a hub (Airbnb-style): a photo, a heading and a line
    // of subtext, then rows that each open their own single-field sub-flow modal.
    expertiseHeading: 'Tell guests about yourself',
    expertiseSubtext: 'A few lines about who you are and what you do.',

    // The "(optional)" suffix, in lighter grey beside a row label. On every
    // optional row; the only sometimes-required one is qualifications.
    optionalSuffix: '(optional)',

    // Row: your title — one field, no caption, a 0/40 counter.
    titleRowLabel: 'Intro',
    titleRowPrompt: 'Add your professional title',
    // The gate under a greyed Next when the (now required) professional title is
    // still empty — shown for every category.
    titleGate: 'Add your professional title — it’s the first thing a guest reads.',
    titleModalTitle: 'Add your professional title',
    titlePlaceholder: 'Chef and restaurant owner',

    // Row: qualifications. Required for the four safety categories (no
    // suffix, gates Next), optional everywhere else (the suffix shows).
    qualsRowLabel: 'Qualifications',
    qualsRowPrompt: 'Add your training and qualifications',
    qualsModalTitle: 'Training and qualifications',
    qualsPlaceholder: 'Trained at Leiths, ten years in restaurant kitchens, Level 3 Food Hygiene. Say what qualifies you — a guest chooses you on this.',
    qualsRequiredNote: 'A guest is putting their safety in your hands, so for this kind of experience we do need it.',
    qualsOptionalNote: 'Anything you’ve trained in or worked at — it all helps.',
    // The gate under a greyed Next on the hub when a required qualification is
    // still missing.
    qualsGate: 'Add your training or qualifications — for this kind of experience it’s required.',

    // Row three: endorsements — always optional, never gates Next.
    recognitionRowLabel: 'Endorsements',
    recognitionRowPrompt: 'Anything you’ve been recognised for.',
    recognitionModalTitle: 'Endorsements',
    recognitionPlaceholder: 'A mention in the local press, or anything else you’ve been recognised for.',
    recognitionNote: 'Optional — anything that helps a guest choose you.',

    // Shown in the footer of the expertise hub when nothing is required — a nudge
    // rather than an "optional, skip it". Placeholder wording, rewritten at the end.
    expertiseFootnote: 'What you write here is what a guest reads when they’re choosing you.',

    // The maximum-guests screen (g_capacity), first in the Pricing section. One
    // centred question, one number, the big stepper. Worded by shape: where the
    // provider travels to the guest the room is the guest's problem, so it's the
    // largest group they'll take; where guests come to them it's what the space
    // or session holds. For a shared slot this number becomes sellable seats.
    capacityHeadingTravel: 'What’s the largest group you’ll take?',
    capacitySubtextTravel: 'The room is the guest’s to sort — this is just how many you’ll cook for or work with.',
    capacityHeadingVenue: 'How many can it hold?',
    capacitySubtextVenue: 'The most guests your space or session fits at once.',
    capacitySuffix: 'guests',

    // The price screen (g_menu) — rebuilt as a hub: a centred question, then each
    // priced thing as a borderless row (name + price + thumbnail), an add row at
    // the bottom, and a per-item sub-flow of one question a screen. The payout is
    // a quiet "You keep £X" line that expands to the maths. Copy only — the
    // pricing model (units, commission) is unchanged.
    menuHeading: 'What you offer, and what it costs',
    menuSubtext: 'Add each thing a guest can book.',
    menuHeadingSlot: 'Your session, and what it costs',
    menuSubtextSlot: 'One session, priced the way you set it up.',
    menuAddRow: 'Add an item',
    menuRowPrompt: 'Name it and set a price',
    menuUntitled: 'Untitled item',
    menuSlotRowLabel: 'Your session',

    // The per-item sub-flow, one thing a screen (Airbnb's itinerary shape).
    menuNameTitle: 'What are you offering?',
    menuNamePlaceholder: 'Five-course tasting menu',
    menuNameTitleSlot: 'Name your session',
    menuNamePlaceholderSlot: 'Lochside sauna session',
    menuPriceTitle: 'What does it cost?',
    menuPricePlaceholder: '45',        // the big numeral's placeholder — an example price
    menuPriceTypeLabel: 'How this is priced',   // the current-choice row on the price step
    menuPriceTypeTitle: 'How is this priced?',  // the basis picker's heading
    // The six pricing bases, in ORDER_UNITS order. The labels live here so the
    // wording is changed in one place; the keys are the logic and stay in code.
    priceUnitLabels: {
        flat: 'One set price',
        person: 'Per person',
        night: 'Per night',
        hour: 'Per hour',
        ticket: 'Per ticket',
        item: 'Per item',
    } as Record<string, string>,
    menuDescTitle: 'Add a short description',
    menuDescPlaceholder: 'A line about what’s included.',
    menuPhotoTitle: 'Add a photo',
    menuPhotoPrompt: 'A real photo of the food or the setting sells it best.',
    menuNext: 'Next',

    // The payout, presented Airbnb-style: calm by default, the maths on request.
    payoutKeepLine: 'You keep',       // rendered as "You keep £X"
    payoutRowPrice: 'Price',
    payoutRowCommission: 'Our commission',
    payoutRowKeep: 'You keep',

    // The Details screen (g_expect), rebuilt as a hub — one thing at a time in a
    // sub-flow, no stacked boxes. "What happens" is shown on the experience page;
    // dietary is food-only and shown too (What's included / What a guest brings
    // were cut — the item description and price already cover them).
    expectRowLabel: 'What happens',
    expectRowPrompt: 'Walk a guest through it, start to finish',
    expectModalTitle: 'What happens?',
    expectPlaceholder: 'I arrive at 6, cook three courses while you relax, serve at the table and clear everything away by 9.',
    dietaryRowLabel: 'Dietary',
    dietaryRowPrompt: 'What you can cater for',
    dietaryModalTitle: 'What can you cater for?',
    dietaryNoteLabel: 'In your own words',   // the always-visible note under the ticks
    dietaryPlaceholder: 'Which ones, anything you can’t work around, and how much notice you need — a guest needs to know before they book.',
    dietaryModalNote: 'Leave it blank and your listing tells guests you haven’t said, so they know to ask.',

    // The location screen, for a travelling (comes-to-you) provider. Radii are
    // gone: coverage is a fixed list of regions the provider ticks, and it is
    // informational now — a signal on the listing, not a filter that hides
    // anyone — so the wording says "guests see this", not "who we show you to".
    // The slot and made-to-order shapes keep the generic step title, which
    // carries a real "when" (a schedule, a notice period); only the traveller,
    // who has no when, gets this where-only heading.
    locationHeadingTravel: 'Which parts of Dumfries & Galloway do you cover?',
    locationSubtextTravel: 'Pick the areas you’ll travel to — guests see this on your listing.',
    locationAddRow: 'Add an area',
    locationAddPrompt: 'Pick a region you cover',
    locationPickerTitle: 'Where do you cover?',
    locationPickerDone: 'Done',
    // The gate under a greyed Next when no area is picked. Guest wording; the
    // host trades keep their own "who to show you to" line, which is still true
    // for them because their coverage does filter.
    locationAreaGate: 'Add at least one area you cover — guests see it on your listing.',

    // The photos screen. An instruction, not a slogan — it names the task rather
    // than describing the outcome. The single line asks for three (what makes a
    // decent listing) but the gate stays at one photo — the ask and the gate are
    // deliberately different, so this line is NOT wired to the Next gate.
    photosHeading: 'Add photos of your experience',
    photosAsk: 'Add at least 3 photos.',
    // Shown above the editable grid once photos exist. Order and cover are the
    // same thing on the guest side — the first photo is the cover — so the line
    // says exactly that; dragging to the front is how you set it.
    photosReorderHint: 'Drag to reorder — the first photo is your cover.',

    // Sub-flow modal.
    save: 'Save',
};

// The tradesman (host-trade) location screen, rebuilt in the guest flow's craft:
// borderless rows + a sub-flow modal, one row per area. Unlike the guest side,
// the model is unchanged — a town from the known list plus a radius, because the
// radius is a live precision filter behind the directory (five regions would be
// too coarse). Restricting to the known list also fixes a latent bug: a
// free-typed off-list town got centre 0,0 and so never matched the directory,
// i.e. it was invisible. Only towns with real coordinates can be picked now.
export const HOST_LOCATION_COPY = {
    heading: 'Where do you cover?',
    subtext: 'The towns you work in and how far you travel from each. Add more than one if you cover separate areas.',
    addRow: 'Add an area',
    addPrompt: 'Pick a town and how far you travel',
    modalTitle: 'Where do you cover?',
    townLabel: 'Which town?',
    radiusLabel: 'How far will you travel from it?',
    radiusSuffix: 'miles',
    // Composed as "within 10 miles" on a chosen row.
    rowWithin: 'within',
};

// The Food & drink sub-types. Keyed by the category key in GUEST_CATEGORIES.
//   - chef        a chef comes to the cottage (comes-to-you)
//   - food_order  made and collected or dropped off — the old Cakes & baking and
//                 Hampers & local produce merged, since they were the same shape,
//                 the same skipped screens and the same declarations; which one
//                 it is gets asked further down, not forked here (made-to-order)
//   - tastings    a booked tasting session (slot)
//   - cooking     a booked cooking class (slot)
export const GUEST_CATEGORY_COPY: Record<string, CategoryCopy> = {
    chef: {
        label: 'Dining & private chef',
        hint: 'A chef cooks at the cottage — dinners, grazing tables',
    },
    food_order: {
        label: 'Food to order',
        hint: 'Made to order and collected or dropped off — cakes, hampers, local produce',
    },
    tastings: {
        label: 'Tastings',
        hint: 'A guided tasting — whisky, gin, wine',
    },
    cooking: {
        label: 'Cooking class',
        hint: 'Learn to cook a dish or a menu, hands-on',
    },
};

// The coverage regions a travelling provider ticks. A single level — regions
// only, never towns — for three reasons: coverage is informational now (it does
// not filter who a guest sees), so town precision buys nothing; a flat region
// list makes the containment trap impossible by construction (you cannot tick
// both "Kirkcudbright" and "The Stewartry" if towns are not in the list); and it
// reads cleanly on a listing. The boundary is hard at Dumfries & Galloway — a
// border chef still shows to every D&G cottage regardless, so a cross-border
// option would be a signal with no audience until Cumbrian cottages list.
//
// "All of Dumfries & Galloway" is pinned first and is mutually exclusive with
// the individual regions: choosing it clears the individual picks, and choosing
// an individual clears it. The hints name the towns each region holds, so a
// provider recognises which one is theirs without the towns being tickable.
export interface RegionCopy {
    key: string;
    label: string;
    hint: string;
}

/** The key of the "everywhere" option, handled specially by the picker. */
export const GUEST_COVERAGE_ALL_KEY = 'all';

export const GUEST_REGIONS: RegionCopy[] = [
    { key: 'all', label: 'All of Dumfries & Galloway', hint: 'You travel anywhere in the region' },
    { key: 'rhins', label: 'The Rhins', hint: 'Stranraer, Portpatrick' },
    { key: 'machars', label: 'The Machars', hint: 'Wigtown, Whithorn, Newton Stewart' },
    { key: 'stewartry', label: 'The Stewartry', hint: 'Kirkcudbright, Castle Douglas, Gatehouse, Dalbeattie' },
    { key: 'nithsdale', label: 'Dumfries & Nithsdale', hint: 'Dumfries, Thornhill' },
    { key: 'annandale', label: 'Annandale & Eskdale', hint: 'Annan, Lockerbie, Moffat, Langholm' },
];
