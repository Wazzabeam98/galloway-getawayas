// The property-grid filters — Airbnb's Filters panel, cut down to what our
// listings actually carry. ONE rule, shared by the server (app/page.tsx narrows
// the grid with it) and the browser (the panel's "Show N places" count), so the
// number on the button is always the number of cards you get.
//
// Pure, no '@/' imports: it runs in the browser and on the server alike.

// Step-free and adapted features, worded as Airbnb words them. Hosts tick these
// in the listing wizard and editor (app/addhome, app/edit-listing) under
// "Accessibility"; they are ordinary amenity strings, so no new column.
export const ACCESSIBILITY_AMENITIES = [
    'Step-free guest entrance',
    'Disabled parking spot',
    'Guest entrance wider than 81cm',
    'Step-free bedroom access',
    'Step-free bathroom access',
    'Step-free shower',
    'Toilet grab bar',
    'Shower grab bar',
] as const;

// Airbnb's "Amenities" section of the panel, in Airbnb's order, limited to
// labels our wizard offers. The panel only shows the ones at least one listing
// in the grid has — a filter that can only ever return nothing does not earn a
// place. (Accessibility is the exception: always shown, because a guest who
// needs step-free access should see that we ask, not that we don't.)
export const FILTER_AMENITIES = [
    'Hot tub',
    'Sauna',
    'Cold plunge',
    'Outdoor shower',
    'Free parking on premises',
    'Wifi',
    'Heating',
    'Indoor fireplace',
    'Kitchen',
    'Washing machine',
    'Tumble dryer',
    'EV charger',
    'Dedicated workspace',
    'Cot',
    'Beach access',
    'Waterfront',
    'Pool',
] as const;

// The quick chips beside the Filters button — Airbnb puts the few most-used
// filters one tap away. Each is an amenity the panel also offers.
export const QUICK_CHIPS: { amenity: string; label: string }[] = [
    { amenity: 'Pets allowed', label: 'Dog friendly' },
    { amenity: 'Hot tub', label: 'Hot tub' },
    { amenity: 'Sauna', label: 'Sauna' },
    { amenity: 'Cold plunge', label: 'Cold plunge' },
    { amenity: 'Outdoor shower', label: 'Outdoor shower' },
    { amenity: 'Step-free guest entrance', label: 'Step-free access' },
    { amenity: 'Indoor fireplace', label: 'Fireplace' },
    { amenity: 'Free parking on premises', label: 'Free parking' },
    { amenity: 'Waterfront', label: 'Waterfront' },
];

// The "Recommended" tiles at the top of the panel — Airbnb's row of four, picked
// for a Galloway cottage break rather than copied: dogs, a hot tub, a fire and
// somewhere to leave the car are what guests here choose on. The panel shows
// the first four that a listing in view has; Wifi and an EV charger stand in if
// one is missing. Wifi is last on purpose — almost every place has it, so as a
// filter it rarely narrows anything.
export const RECOMMENDED: { amenity: string; label: string }[] = [
    { amenity: 'Pets allowed', label: 'Dog friendly' },
    { amenity: 'Hot tub', label: 'Hot tub' },
    { amenity: 'Indoor fireplace', label: 'Fireplace' },
    { amenity: 'Free parking on premises', label: 'Free parking' },
    { amenity: 'EV charger', label: 'EV charger' },
    { amenity: 'Wifi', label: 'Wifi' },
];

// Shorter words for the panel's pills, where the wizard's label is too long to
// sit in an even grid. The stored string is unchanged.
export const AMENITY_LABELS: Record<string, string> = {
    'Free parking on premises': 'Free parking',
};

export interface FilterState {
    amenities: string[];      // every one must be present
    types: string[];          // any one (property_type, the wizard's category name)
    minPrice: number | null;  // per night
    maxPrice: number | null;
    bedrooms: number;         // 0 = any
    beds: number;
    bathrooms: number;
    instantBook: boolean;
    selfCheckIn: boolean;
}

export const EMPTY_FILTERS: FilterState = {
    amenities: [], types: [], minPrice: null, maxPrice: null,
    bedrooms: 0, beds: 0, bathrooms: 0, instantBook: false, selfCheckIn: false,
};

// What a card needs for the rule — the columns the grid already selects.
export interface FilterFacts {
    amenities: string[] | null;
    property_type: string | null;
    price_per_night: number | string | null;
    bedrooms: number | null;
    beds: number | null;
    bathrooms: number | string | null;
    instant_book: boolean | null;
    self_check_in: boolean;
}

export function matchesFilters(l: FilterFacts, f: FilterState): boolean {
    const have = l.amenities || [];
    if (f.amenities.some((a) => have.indexOf(a) === -1)) return false;
    if (f.types.length && f.types.indexOf(l.property_type || '') === -1) return false;
    const price = Number(l.price_per_night) || 0;
    if (f.minPrice != null && price < f.minPrice) return false;
    if (f.maxPrice != null && price > f.maxPrice) return false;
    if (f.bedrooms && (Number(l.bedrooms) || 0) < f.bedrooms) return false;
    if (f.beds && (Number(l.beds) || 0) < f.beds) return false;
    if (f.bathrooms && (Number(l.bathrooms) || 0) < f.bathrooms) return false;
    if (f.instantBook && l.instant_book !== true) return false;
    if (f.selfCheckIn && !l.self_check_in) return false;
    return true;
}

export function activeFilterCount(f: FilterState): number {
    return f.amenities.length + f.types.length
        + (f.minPrice != null || f.maxPrice != null ? 1 : 0)
        + (f.bedrooms ? 1 : 0) + (f.beds ? 1 : 0) + (f.bathrooms ? 1 : 0)
        + (f.instantBook ? 1 : 0) + (f.selfCheckIn ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The URL. Filters live in the query string, like the hero's where/when/who,
// so a filtered grid is a link that can be shared and survives a reload.
//   am=<amenity> (repeated)   type=<category> (repeated)
//   pmin / pmax   bedrooms / beds / baths   ib=1   selfci=1
// The hero's `pets=1` is the same thing as am=Pets allowed and is read as one.

type Params = { [key: string]: string | string[] | undefined };

function list(v: string | string[] | undefined): string[] {
    if (v == null) return [];
    return (Array.isArray(v) ? v : [v]).filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 80);
}
function num(v: string | string[] | undefined): number | null {
    const s = Array.isArray(v) ? v[0] : v;
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

export function readFilters(p: Params): FilterState {
    const amenities = list(p.am);
    if (p.pets === '1' && amenities.indexOf('Pets allowed') === -1) amenities.push('Pets allowed');
    return {
        amenities,
        types: list(p.type),
        minPrice: num(p.pmin),
        maxPrice: num(p.pmax),
        bedrooms: Math.min(num(p.bedrooms) || 0, 20),
        beds: Math.min(num(p.beds) || 0, 20),
        bathrooms: Math.min(num(p.baths) || 0, 20),
        instantBook: p.ib === '1',
        selfCheckIn: p.selfci === '1',
    };
}

// Writes the filters onto a copy of the current params, keeping where/when/who.
export function writeFilters(base: URLSearchParams, f: FilterState): URLSearchParams {
    const out = new URLSearchParams(base.toString());
    ['am', 'type', 'pmin', 'pmax', 'bedrooms', 'beds', 'baths', 'ib', 'selfci', 'pets'].forEach((k) => out.delete(k));
    f.amenities.forEach((a) => out.append('am', a));
    f.types.forEach((t) => out.append('type', t));
    if (f.minPrice != null) out.set('pmin', String(f.minPrice));
    if (f.maxPrice != null) out.set('pmax', String(f.maxPrice));
    if (f.bedrooms) out.set('bedrooms', String(f.bedrooms));
    if (f.beds) out.set('beds', String(f.beds));
    if (f.bathrooms) out.set('baths', String(f.bathrooms));
    if (f.instantBook) out.set('ib', '1');
    if (f.selfCheckIn) out.set('selfci', '1');
    return out;
}

// The card's "[Type] in [place]" word — kept exported from here for the
// callers that already import it; the words live in lib/propertyTypes.ts.
export { propertyTypeLabel } from './propertyTypes';
