// Some listings store a full street address in `location`, others store only
// the town and region. Guests should never see the street, so the first part
// is dropped only when it actually looks like one — a house number, or a
// street-type word. "Kirkcudbright, Dumfries and Galloway" is left alone.
//
// This lived in the home page. It's here so the home page, the passport and
// anything else agree on what a place is called.

const STREET_WORDS = [
    'street', 'st', 'road', 'rd', 'lane', 'avenue', 'ave', 'drive', 'close',
    'place', 'terrace', 'court', 'crescent', 'way', 'row', 'gardens', 'park',
    'square', 'wynd', 'brae', 'vennel', 'loan', 'view', 'grove', 'walk',
];

export function looksLikeStreet(part: string): boolean {
    const clean = part.trim().toLowerCase();
    if (!clean) return false;

    // Starts with a house number, e.g. "28" or "57 St Cuthbert Street".
    if (/^[0-9]/.test(clean)) return true;
    if (/^(flat|apt|apartment|unit)\b/.test(clean)) return true;

    const words = clean.replace(/[.,]/g, '').split(/\s+/);
    const last = words[words.length - 1];
    return words.length > 1 && STREET_WORDS.indexOf(last) !== -1;
}

export function publicArea(location: string | null): string {
    if (!location) return 'Dumfries & Galloway';

    const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) return location;

    let start = 0;
    while (start < parts.length - 2 && looksLikeStreet(parts[start])) {
        start = start + 1;
    }
    if (start < parts.length - 1 && looksLikeStreet(parts[start])) {
        start = start + 1;
    }

    const kept = parts.slice(start);
    return correctRegion(kept.length ? kept.join(', ') : location);
}

// Just the town, for grouping stays by where they were. "18 Dovecroft,
// Kirkcudbright, Dumfries and Galloway" becomes "Kirkcudbright".
export function townOf(location: string | null): string {
    const area = publicArea(location);
    const first = area.split(',')[0].trim();
    return first || 'Dumfries & Galloway';
}

// Same town written two ways shouldn't earn two stamps.
export function townKey(location: string | null): string {
    return townOf(location).toLowerCase().replace(/[^a-z]/g, '');
}

// Every listing on this site sits in the Dumfries & Galloway council area, and
// the listings that already exist spell it this way. `location` has to match
// them, so this is the default the form offers rather than the postal county
// the address lookup returns (which here is usually the historic county —
// "Kirkcudbrightshire" and the like).
export const DEFAULT_REGION = 'Dumfries and Galloway';

// The one place `location` is assembled. Both the draft save and the publish
// used to build it separately from seven fields, in slightly different ways —
// only one of them trimmed, which is how a listing ended up stored as
// " , Kirkcudbright , United Kingdom, DG6 4JS, United Kingdom".
//
// Two parts, always. The street is deliberately not in here: it lives in its
// own column, so it cannot reach a screen that prints `location` raw.
export function buildLocation(town: string | null, region: string | null): string {
    return [town, region]
        .map((part) => (part || '').trim())
        .filter(Boolean)
        .join(', ');
}

// A listing's `location`: the host's town, always in Dumfries and Galloway.
// There is no region box any more — every property is in D&G — so both forms
// and the save route build it here, and the "Town, Dumfries and Galloway"
// every page reads stays exactly that.
//
// No town, no location: a bare "Dumfries and Galloway" would read as a town to
// the publish rule and let a listing through with none.
export function listingLocation(town: string | null): string {
    const t = (town || '').trim();
    return t ? buildLocation(t, regionForTown(t)) : '';
}

// The exceptions to "always Dumfries and Galloway". Galloway Forest Park runs
// north over the council boundary into Ayrshire, so a cottage on its northern
// edge can be in the park without being in D&G — and saying it is reads as a
// mistake to anybody who knows the area. Keyed by townKey. Add a town here
// only when a real listing needs it.
const REGION_OUTSIDE_DG: Record<string, string> = {
    straiton: 'South Ayrshire',
    dalmellington: 'East Ayrshire',
};

export function regionForTown(town: string | null): string {
    return REGION_OUTSIDE_DG[townKey(town)] || DEFAULT_REGION;
}

// A stored location read back for display, with the region put right for a
// town outside D&G. Rows saved before the exception existed still say
// "Straiton, Dumfries and Galloway"; this corrects them on the way out, so no
// data has to change and the next save stores the right one anyway.
export function correctRegion(location: string): string {
    const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return location;
    const actual = REGION_OUTSIDE_DG[townKey(parts[0])];
    if (!actual) return location;
    return [parts[0], actual].concat(parts.slice(2).filter((p) => !/dumfries/i.test(p))).join(', ');
}

// Reading a stored `location` back into the town and region boxes. Runs through
// publicArea first so an older row that still has its street on the front does
// not put the street into the town box.
export function splitLocation(location: string | null): { town: string; region: string } {
    if (!location) return { town: '', region: '' };

    const parts = publicArea(location)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

    if (!parts.length) return { town: '', region: '' };

    return {
        town: parts[0],
        // Anything after the town is the region. Joined rather than taking
        // parts[1] so "Town, Dumfries and Galloway, Scotland" keeps both.
        region: parts.slice(1).join(', '),
    };
}
