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

    // The expertise screen — a hub (Airbnb-style): a photo, a heading and a line
    // of subtext, then three rows that each open a small sub-flow modal.
    expertiseHeading: 'Tell guests about yourself',
    expertiseSubtext: 'A few lines about who you are and what you do.',

    // The "(optional)" suffix, in lighter grey beside a row label. Used on the
    // qualifications row where it isn't required, and always on recognition.
    optionalSuffix: '(optional)',

    // Row one: Intro — the title, the short line and the photo, in one modal.
    introRowLabel: 'Intro',
    introRowPrompt: 'Your title and a line about you',
    introModalTitle: 'Intro',
    titleLabel: 'Your title',
    titlePlaceholder: 'Private chef',
    aboutLineLabel: 'A short line about you',
    aboutLinePlaceholder: 'Kirkcudbright · cooking since 2019',
    photoLabel: 'A photo of you',

    // Row two: qualifications. Required for the four safety categories (no
    // suffix, gates Next), optional everywhere else (the suffix shows).
    qualsRowLabel: 'Qualifications',
    qualsRowPrompt: 'What qualifies you to do this',
    qualsModalTitle: 'Training and qualifications',
    qualsPlaceholder: 'Trained at Leiths, ten years in restaurant kitchens, Level 3 Food Hygiene. Say what qualifies you — a guest chooses you on this.',
    qualsRequiredNote: 'A guest is putting their safety in your hands, so for this kind of experience we do need it.',
    qualsOptionalNote: 'Not required — but it’s what a guest weighs you on, so it’s worth a line if you have one.',
    // The gate under a greyed Next on the hub when a required qualification is
    // still missing.
    qualsGate: 'Add your training or qualifications — for this kind of experience it’s required.',

    // Row three: endorsements — always optional, never gates Next.
    recognitionRowLabel: 'Endorsements',
    recognitionRowPrompt: 'Awards, career highlights, anything you’ve been recognised for.',
    recognitionModalTitle: 'Endorsements',
    recognitionPlaceholder: 'An award you’ve won, a mention in the local press, or a career highlight.',
    recognitionNote: 'Optional — anything that helps a guest choose you.',

    // Shown in the footer of the expertise hub when nothing is required — a nudge
    // rather than an "optional, skip it". Placeholder wording, rewritten at the end.
    expertiseFootnote: 'What you write here is what a guest reads when they’re choosing you.',

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
