import { COVERAGE_TOWNS, milesBetween, townForLocation } from '@/lib/serviceProviders';

// "3.6 miles from Kirkcudbright" — for a cottage that is NOT in one of our main
// towns (or names one but sits well outside it). Nothing for one that is.
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
//
// ONE EXCEPTION: NAMED FOR A TOWN, BUT OUT OF IT. An address names its town,
// but a cottage four miles up the coast from Gatehouse of Fleet still says
// "Gatehouse of Fleet" — and a guest reading only that expects to walk to the
// shops. So when the named town's centre is IN_TOWN_MILES or more away, the
// line comes back, measured from the town the listing names ("4.3 miles from
// Gatehouse of Fleet"), as Airbnb does (Liam, 21 Oct 2026). Under that, it is
// in town and says nothing, as before.
export const IN_TOWN_MILES = 2;

export interface NearestTown {
    miles: number;
    town: string;
}

export function nearestTown(
    location: string | null | undefined,
    approxLat: number | string | null | undefined,
    approxLng: number | string | null | undefined,
): NearestTown | null {
    const lat = Number(approxLat);
    const lng = Number(approxLng);
    const placed = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);

    // Named for one of our towns: nothing while it is in that town, the
    // distance from it once it is well outside.
    const named = townForLocation(location);
    if (named) {
        if (!placed) return null;
        const miles = milesBetween(lat, lng, named.lat, named.lng);
        return miles >= IN_TOWN_MILES ? { miles, town: named.label } : null;
    }

    if (!placed) return null;

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
