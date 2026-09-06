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
    yearsQuestion: 'How long have you been doing this?',

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
    sectionExperience: 'Experience',
    sectionFinish: 'Finish',

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
    menuPriceTypeLabel: 'How this is priced',
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

    // The photos screen. The gate is one photo, but the copy pushes for more —
    // a listing with several gets booked more, and someone who has no usable
    // photos finds that out here rather than after writing everything.
    photosLede: 'Real photos of the food, the room, the view — not a logo. The first one leads your listing.',
    photosMore: 'One photo is enough to list — but listings with several get booked more, so add a few if you can.',

    // Sub-flow modal.
    save: 'Save',
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
