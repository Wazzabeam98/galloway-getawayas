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
    return kept.length ? kept.join(', ') : location;
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
