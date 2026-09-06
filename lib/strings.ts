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
    // The short line and the photo of the provider — moved off the years screen
    // onto the expertise screen, where the person's story belongs.
    aboutLineLabel: 'A short line about you',
    aboutLinePlaceholder: 'Kirkcudbright · cooking since 2019',
    photoLabel: 'A photo of you',
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
