// "Is this the right town?" — for the Location editor's Town box.
//
// Guests see the town a host types, and a host types the town in their
// postal address. Royal Mail's post town is often not the nearest town: every
// DG7 postcode is "Castle Douglas", so a cottage four miles from Gatehouse of
// Fleet was shown to guests as Castle Douglas, fifteen miles away (21 Oct
// 2026). Nothing checked the town against the postcode.
//
// This does. Given the town typed and the postcode's coordinates, it suggests
// the nearer of our main towns when the typed one is clearly the wrong
// neighbour: at least FAR_MILES away and at least twice as far as the nearest.
// A cottage on the edge of its own town, or a village we have no town for
// (Wanlockhead), gets nothing — it only speaks when it can be sure.
//
// Pure and import-free (the towns are passed in), so it is unit-tested as is.

export const FAR_MILES = 5;

export interface NudgeTown { key: string; label: string; lat: number; lng: number }

export interface TownNudge {
    typed: string;
    typedMiles: number;
    suggest: string;
    suggestMiles: number;
}

const letters = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function miles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function townNudge(typedTown: string, lat: number | null, lng: number | null, towns: readonly NudgeTown[]): TownNudge | null {
    if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
    const parts = String(typedTown || '').split(',').map(letters).filter(Boolean);
    const typed = towns.find((t) => parts.indexOf(letters(t.label)) !== -1);
    if (!typed) return null;
    let nearest: NudgeTown | null = null;
    let nearestMiles = Infinity;
    for (const t of towns) {
        const m = miles(lat, lng, t.lat, t.lng);
        if (m < nearestMiles) { nearest = t; nearestMiles = m; }
    }
    if (!nearest || nearest.key === typed.key) return null;
    const typedMiles = miles(lat, lng, typed.lat, typed.lng);
    if (typedMiles < FAR_MILES || typedMiles < 2 * nearestMiles) return null;
    return { typed: typed.label, typedMiles, suggest: nearest.label, suggestMiles: nearestMiles };
}
