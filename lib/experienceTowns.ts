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
