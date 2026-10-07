// Grouping for the listing's "Show all amenities" dialog, the way Airbnb groups
// it: Bathroom, Bedroom and laundry, and so on. This is a DISPLAY mapping, kept
// apart from the editor's own category list (Basics / Popular / Features …,
// which is organised for entering amenities, not reading them).
//
// Each known amenity belongs to exactly one group. Anything not listed here —
// an amenity added later, or a one-off — still shows, under "Other", so a new
// amenity is never silently dropped from the dialog.

import { ACCESSIBILITY_AMENITIES } from './listingFilters';

// The groups, in Airbnb's order, each with the amenities that belong to it.
// Labels are shown as the dialog's section headings.
const GROUP_DEFS: { label: string; items: string[] }[] = [
    { label: 'Bathroom', items: ['Hairdryer', 'Shampoo', 'Hot water', 'Outdoor shower'] },
    { label: 'Bedroom and laundry', items: ['Essentials', 'Hangers', 'Iron', 'Washing machine', 'Tumble dryer'] },
    { label: 'Entertainment', items: ['TV'] },
    { label: 'Family', items: ['Cot'] },
    { label: 'Heating and cooling', items: ['Air conditioning', 'Heating', 'Indoor fireplace'] },
    { label: 'Home safety', items: ['Smoke alarm', 'Carbon monoxide alarm'] },
    { label: 'Internet and office', items: ['Wifi', 'Dedicated workspace'] },
    { label: 'Kitchen and dining', items: ['Kitchen', 'Fridge', 'Coffee maker', 'Cooking basics', 'Dishwasher'] },
    { label: 'Location features', items: ['Beach access', 'Waterfront'] },
    { label: 'Outdoor', items: ['Outdoor furniture'] },
    { label: 'Parking and facilities', items: ['Free parking on premises', 'Free street parking', 'EV charger', 'Gym', 'Pool', 'Hot tub', 'Sauna', 'Cold plunge'] },
    { label: 'Services', items: ['Pets allowed'] },
    // Not one of the twelve, but a listing may carry step-free features and they
    // need a home; Airbnb keeps them in their own group too.
    { label: 'Accessibility features', items: [...ACCESSIBILITY_AMENITIES] },
];

// amenity name -> its group label, built once from the definitions above.
const GROUP_OF: Record<string, string> = {};
for (const g of GROUP_DEFS) {
    for (const name of g.items) GROUP_OF[name] = g.label;
}

export type AmenityGroup = { label: string; items: string[] };

// Turn a flat list of a listing's amenities into ordered groups, keeping only
// the groups that have something in them. Within a group the amenities keep the
// order the host stored them in. Anything unmapped lands in a trailing "Other".
export function groupAmenities(amenities: string[]): AmenityGroup[] {
    const byLabel = new Map<string, string[]>();
    const other: string[] = [];

    for (const name of amenities || []) {
        const label = GROUP_OF[name];
        if (!label) { other.push(name); continue; }
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label)!.push(name);
    }

    const out: AmenityGroup[] = [];
    for (const g of GROUP_DEFS) {
        const items = byLabel.get(g.label);
        if (items && items.length) out.push({ label: g.label, items });
    }
    if (other.length) out.push({ label: 'Other', items: other });
    return out;
}
