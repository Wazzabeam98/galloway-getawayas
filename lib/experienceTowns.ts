// WHICH EXPERIENCES BELONG ON A TOWN PAGE (/holiday-cottages/<slug>).
//
// Coverage is the five named regions a guest provider picks (GUEST_REGIONS),
// not the old town-and-radius circles — those are written as 0,0 for a guest
// provider and match nothing. So a town page asks three things:
//
//   1. COVERS ALL OF D&G   — "All of Dumfries & Galloway" puts a provider on
//                            every town page.
//   2. COVERS THIS REGION  — a provider who travels to The Stewartry is on the
//                            Kirkcudbright, Castle Douglas, Gatehouse and
//                            Dalbeattie pages, and no others.
//   3. BASED IN THIS TOWN  — a provider at one place (a sauna, a studio) is on
//                            that town's page: their based_line (derived from
//                            their collection town) is one of the page's towns.
//                            Not for a provider who only travels — their base
//                            is where they set out from, not where it happens.
//
// Pure, so it is tested without a database.

import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from './strings';
import { townKey } from './places';
import { areaForTownKey, areaBySlug } from '../config/areas';
import { COVERAGE_TOWNS, milesBetween } from './serviceProviders';

// The region each town page sits in — the same split GUEST_REGIONS' hints name.
export const REGION_FOR_AREA: Record<string, string> = {
    'kirkcudbright': 'stewartry',
    'castle-douglas': 'stewartry',
    'gatehouse-of-fleet': 'stewartry',
    'dalbeattie': 'stewartry',
    'newton-stewart': 'machars',
    'wigtown': 'machars',
    'dumfries': 'nithsdale',
    'moffat': 'annandale',
    'stranraer': 'rhins',
    'portpatrick': 'rhins',
};

export interface TownProvider {
    areas?: string[] | null;
    based_line?: string | null;
    shape?: string | null;
    fulfilment?: string | null;
}

// The region keys a provider's coverage labels name. Labels are stored as the
// region's label ("The Stewartry"); a legacy radius label names no region.
export function regionKeysOf(labels: (string | null | undefined)[] | null | undefined): string[] {
    const keys = new Set<string>();
    for (const raw of labels || []) {
        const label = String(raw || '').trim().toLowerCase();
        const region = GUEST_REGIONS.find((r) => r.label.toLowerCase() === label || r.key === label);
        if (region) keys.add(region.key);
    }
    return Array.from(keys);
}

// Only travels to the guest (a comes-to-you chef, a delivery-only maker) — no
// place of their own where the experience happens.
function travelsOnly(p: TownProvider): boolean {
    return p.shape === 'comes_to_you' || p.fulfilment === 'delivery';
}

export function servesTown(p: TownProvider, area: { slug: string; townKeys: string[] }): boolean {
    const keys = regionKeysOf(p.areas);
    if (keys.includes(GUEST_COVERAGE_ALL_KEY)) return true;
    const region = REGION_FOR_AREA[area.slug];
    if (region && keys.includes(region)) return true;
    if (!travelsOnly(p) && p.based_line && area.townKeys.includes(townKey(p.based_line))) return true;
    return false;
}

// The town page a PROPERTY belongs to, for its "Experiences nearby" — so a
// listing shows exactly what its town page shows. A property in one of the
// towns takes that town; one in a village takes the nearest town (by its public
// ~110m point) and its region, and keeps its own village too, so a provider
// based in that village still counts as based where the property is. Null with
// neither a known town nor a usable point.
export function experienceAreaForListing(
    location: string | null | undefined,
    approxLat: number | string | null | undefined,
    approxLng: number | string | null | undefined,
): { slug: string; townKeys: string[] } | null {
    const own = townKey(location || null);
    const inTown = areaForTownKey(own);
    if (inTown) return { slug: inTown.slug, townKeys: inTown.townKeys };

    const lat = Number(approxLat), lng = Number(approxLng);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
    let best: { key: string; miles: number } | null = null;
    for (const t of COVERAGE_TOWNS) {
        const miles = milesBetween(lat, lng, t.lat, t.lng);
        if (!best || miles < best.miles) best = { key: t.key, miles };
    }
    const near = best ? areaBySlug(best.key) : null;
    if (!near) return null;
    return { slug: near.slug, townKeys: own ? [...near.townKeys, own] : near.townKeys };
}
