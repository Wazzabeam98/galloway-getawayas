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
    // of subtext, then rows that each open a small sub-flow modal.
    expertiseHeading: 'What makes you the person to do it?',
    expertiseSubtext: 'Guests choose a person as much as a service — this is where you give them a reason to choose you.',

    // Row one: about you — the title, the short line and the photo, in one modal.
    aboutRowLabel: 'About you',
    aboutRowPrompt: 'Your title, a line about you, and a photo',
    aboutModalTitle: 'About you',
    titleLabel: 'Your title',
    titlePlaceholder: 'Private chef',
    // The short line and the photo of the provider — collected in the About you
    // sub-flow, where the person's story belongs.
    aboutLineLabel: 'A short line about you',
    aboutLinePlaceholder: 'Kirkcudbright · cooking since 2019',
    photoLabel: 'A photo of you',

    // Row two: training and qualifications. Required for chef; the note that used
    // to sit on the hub now lives inside this sub-flow.
    qualsRowLabel: 'Training and qualifications',
    qualsRowPrompt: 'What qualifies you to do this',
    qualsModalTitle: 'Training and qualifications',
    qualsPlaceholder: 'Trained at Leiths, ten years in restaurant kitchens, Level 3 Food Hygiene. Say what qualifies you — a guest chooses you on this.',
    qualsRequiredNote: 'A guest is putting their safety in your hands, so for this kind of experience we do need it.',
    qualsOptionalNote: 'Not required — but it’s what a guest weighs you on, so it’s worth a line if you have one.',
    // The gate under a greyed Next on the hub when a required qualification is
    // still missing.
    qualsGate: 'Add your training or qualifications — for this kind of experience it’s required.',

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
