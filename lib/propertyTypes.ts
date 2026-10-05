// The property types a host picks on the first step of /addhome, and every
// word a type is shown as elsewhere — one list, so the picker, the editor,
// the card line ("Cottage in Kirkcudbright"), the listing title line ("Entire
// flat in Kirkcudbright"), the search filter and admin can never disagree.
//
// Pure constants and functions (no React), so it can be unit-tested and read
// on the server.
//
// THE STORED VALUE IS `name`, AND THE OLD SIX NEVER CHANGE.
// listings.property_type holds `name` as plain text. The first six types were
// marketing categories stored in the plural ('Cottages', 'Cabins & Pods'), and
// live listings carry those strings — so they stay exactly as they are and are
// only DISPLAYED in the singular. Types added on 5 Oct 2026 (Airbnb's list,
// UK wording, plus the UK holiday types) store their singular label.
//
// Three of the old six are not types at all ('Coastal Stays', 'Luxury Stays')
// or overlap the new list ('Cabins & Pods' is now Cabin and Glamping pod). They
// are `legacy`: still valid, still displayed and filterable, but no longer
// offered as a tile — except in the editor of a listing that already has one,
// so a host never sees their type silently unselected.

export type PropertyTypeGroup = 'common' | 'unique' | 'legacy';

export interface PropertyType {
    // What listings.property_type stores. Never rename one that is live.
    name: string;
    // The tile on the picker (Airbnb's wording, UK English).
    label: string;
    // The card line, Airbnb's "[Type] in [place]": "Flat in Kirkcudbright".
    card: string;
    // The title-line noun, Airbnb's "Entire [noun] in [place]".
    noun: string;
    // Key into PropertyTypeIcon.
    icon: string;
    group: PropertyTypeGroup;
    // No ordinary street address: a boat on a berth, a van or tent on a pitch,
    // a pod on a site. The address step asks for the pitch, berth or site name
    // in the street line instead (see addressLineLabel).
    site?: boolean;
}

export const PROPERTY_TYPES: PropertyType[] = [
    // ---- The common ones, first ------------------------------------------
    { name: 'Cottages', label: 'Cottage', card: 'Cottage', noun: 'cottage', icon: 'cottage', group: 'common' },
    { name: 'House', label: 'House', card: 'Home', noun: 'home', icon: 'house', group: 'common' },
    { name: 'Flat/apartment', label: 'Flat/apartment', card: 'Flat', noun: 'flat', icon: 'flat', group: 'common' },
    { name: 'Townhouses', label: 'Townhouse', card: 'Townhouse', noun: 'townhouse', icon: 'townhouse', group: 'common' },
    { name: 'Farmhouses', label: 'Farmhouse', card: 'Farmhouse', noun: 'farmhouse', icon: 'farmhouse', group: 'common' },
    { name: 'Cabin', label: 'Cabin', card: 'Cabin', noun: 'cabin', icon: 'cabin', group: 'common' },
    { name: 'Lodge', label: 'Lodge', card: 'Lodge', noun: 'lodge', icon: 'lodge', group: 'common' },
    { name: 'Static caravan', label: 'Static caravan', card: 'Static caravan', noun: 'static caravan', icon: 'static_caravan', group: 'common' },
    { name: 'Barn', label: 'Barn', card: 'Barn', noun: 'barn', icon: 'barn', group: 'common' },

    // ---- Unique stays: rarer, under their own heading --------------------
    { name: 'Glamping pod', label: 'Glamping pod', card: 'Glamping pod', noun: 'glamping pod', icon: 'pod', group: 'unique', site: true },
    { name: "Shepherd's hut", label: 'Shepherd’s hut', card: 'Shepherd’s hut', noun: 'shepherd’s hut', icon: 'shepherds_hut', group: 'unique' },
    { name: 'Tiny home', label: 'Tiny home', card: 'Tiny home', noun: 'tiny home', icon: 'tiny_home', group: 'unique' },
    { name: 'Boat', label: 'Boat', card: 'Boat', noun: 'boat', icon: 'boat', group: 'unique', site: true },
    { name: 'Houseboat', label: 'Houseboat', card: 'Houseboat', noun: 'houseboat', icon: 'houseboat', group: 'unique', site: true },
    { name: 'Campervan/motorhome', label: 'Campervan/motorhome', card: 'Campervan', noun: 'campervan', icon: 'campervan', group: 'unique', site: true },
    { name: 'Tent', label: 'Tent', card: 'Tent', noun: 'tent', icon: 'tent', group: 'unique', site: true },
    { name: 'Yurt', label: 'Yurt', card: 'Yurt', noun: 'yurt', icon: 'yurt', group: 'unique', site: true },
    { name: 'Dome', label: 'Dome', card: 'Dome', noun: 'dome', icon: 'dome', group: 'unique' },
    { name: 'Treehouse', label: 'Treehouse', card: 'Treehouse', noun: 'treehouse', icon: 'treehouse', group: 'unique' },
    // Airbnb shows a farm as "Farm stay in Preston".
    { name: 'Farm', label: 'Farm', card: 'Farm stay', noun: 'farm stay', icon: 'farm', group: 'unique' },
    { name: 'Castle', label: 'Castle', card: 'Castle', noun: 'castle', icon: 'castle', group: 'unique' },
    { name: 'Tower', label: 'Tower', card: 'Tower', noun: 'tower', icon: 'tower', group: 'unique' },

    // ---- Legacy: valid on old listings, not offered to new ones ----------
    { name: 'Cabins & Pods', label: 'Cabin or pod', card: 'Cabin', noun: 'cabin', icon: 'compass', group: 'legacy' },
    { name: 'Coastal Stays', label: 'Coastal stay', card: 'Coastal stay', noun: 'coastal home', icon: 'coastal', group: 'legacy' },
    { name: 'Luxury Stays', label: 'Luxury stay', card: 'Luxury stay', noun: 'home', icon: 'luxury', group: 'legacy' },
];

export const UNIQUE_STAYS_HEADING = 'Unique stays';

export function propertyTypeByName(name: string | null | undefined): PropertyType | null {
    if (!name) return null;
    return PROPERTY_TYPES.find((t) => t.name === name) || null;
}

/**
 * The tiles to show, in two groups. A legacy type appears only when it is the
 * listing's current one (the editor), at the top of the common group, so the
 * host sees it selected rather than losing it.
 */
export function pickerTypes(current?: string | null): { common: PropertyType[]; unique: PropertyType[] } {
    const legacy = PROPERTY_TYPES.filter((t) => t.group === 'legacy' && t.name === current);
    return {
        common: [...legacy, ...PROPERTY_TYPES.filter((t) => t.group === 'common')],
        unique: PROPERTY_TYPES.filter((t) => t.group === 'unique'),
    };
}

/** The card line's word: "Flat" in "Flat in Kirkcudbright". Unknown text passes through. */
export function propertyTypeLabel(type: string | null | undefined): string | null {
    if (!type) return null;
    const t = propertyTypeByName(type);
    return t ? t.card : type;
}

/** The title-line noun: "flat" in "Entire flat in Kirkcudbright". */
export function propertyNoun(type: string | null | undefined): string {
    const t = propertyTypeByName(type);
    return t ? t.noun : 'place';
}

/** "Entire flat", "Private room in a static caravan" — the title line before " in [place]". */
export function describePlace(privacyType: string | null | undefined, propertyType: string | null | undefined): string {
    const noun = propertyNoun(propertyType);
    if (privacyType === 'A private room') return `Private room in ${article(noun)} ${noun}`;
    if (privacyType === 'A shared room') return `Shared room in ${article(noun)} ${noun}`;
    return `Entire ${noun}`;
}

function article(noun: string): string {
    return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

/** True for a type that sits on a pitch, berth or site rather than a street. */
export function isSiteType(type: string | null | undefined): boolean {
    return !!propertyTypeByName(type)?.site;
}

/**
 * The address step's first line. A boat, campervan, tent, yurt or pod has no
 * street: the pitch, berth or site name plus the postcode is the address a
 * booked guest is sent to, and it fills the same (required) street line.
 */
export function addressLineLabel(type: string | null | undefined): { label: string; placeholder: string; hint: string | null } {
    if (isSiteType(type)) {
        return {
            label: 'Pitch, berth or site name',
            placeholder: 'e.g. Pitch 14, Brighouse Bay Holiday Park',
            hint: 'No street address? The pitch, berth or site name and the postcode are enough.',
        };
    }
    return { label: 'Street address', placeholder: 'e.g. 18 Dovecroft', hint: null };
}
