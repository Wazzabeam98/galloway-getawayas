import { COVERAGE_TOWNS, milesBetween, townForLocation } from '@/lib/serviceProviders';

// "3.6 miles from Kirkcudbright" — for a cottage that is NOT in one of our main
// towns. Nothing for one that is.
//
// THE RULE FOR "OUTSIDE A TOWN"
//
// A listing is *in* a town when its address names one of the main towns the
// site runs an area page for — the same COVERAGE_TOWNS the search and the
// service coverage already measure from, matched with townForLocation (which
// checks every comma-separated part, so a named house like "Anchorlee,
// Gatehouse of Fleet" still counts as in Gatehouse). Those get no distance
// line: "0.4 miles from Kirkcudbright" on a Kirkcudbright cottage reads as a
// bug, not a help.
//
// Everything else is *outside* a town, and there the line earns its keep — it
// answers "how far is this from somewhere I have heard of". We measure the
// straight-line distance from the property's APPROXIMATE point (the ~110m
// public pair, never the exact one) to the nearest main-town centre.
export interface NearestTown {
    miles: number;
    town: string;
}

export function nearestTown(
    location: string | null | undefined,
    approxLat: number | string | null | undefined,
    approxLng: number | string | null | undefined,
): NearestTown | null {
    // Already in one of our towns — say nothing.
    if (townForLocation(location)) return null;

    const lat = Number(approxLat);
    const lng = Number(approxLng);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;

    let best: NearestTown | null = null;
    for (const t of COVERAGE_TOWNS) {
        const miles = milesBetween(lat, lng, t.lat, t.lng);
        if (!best || miles < best.miles) best = { miles, town: t.label };
    }
    return best;
}

// "3.6 miles from Kirkcudbright". One decimal — any more is false precision on
// a point already rounded to ~110m.
export function nearestTownLabel(n: NearestTown): string {
    return `${n.miles.toFixed(1)} miles from ${n.town}`;
}
