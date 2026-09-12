// A postcode becomes coordinates.
//
// WHY THIS EXISTS
//
// Publishing has required a postcode since 28 August 2026, and until now
// nothing did anything with it. Coordinates had exactly one writer in the whole
// codebase — the address lookup in the wizard — so a host who typed their
// postcode by hand (the only path add-a-property offers now) and published
// passed every rule and still had no coordinates.
//
// That path is not hypothetical. The wizard offers it, and it is what happens
// whenever the address lookup is down or out of quota.
//
// Nothing is BROKEN by a missing coordinate today: `pointForListing` falls back
// to the town centre, and the listing page geocodes its location string for the
// map. Checked against production on 1 September 2026 — two of the three
// published listings have no coordinates and both still match a provider's
// coverage circle correctly. This is about the six-month version of the
// problem: the day something sorts by distance, town-centre for half the
// properties is wrong in a way nobody will think to check.
//
// WHY postcodes.io
//
// It is keyless, free, unlimited, and does exactly this one thing for UK
// postcodes, returning the centroid of the postcode unit — usually a handful of
// houses. The two alternatives already in reach are worse for this job:
//
//   Ideal Postcodes  the address lookup, but it resolves an address id rather
//                    than a postcode, and a fallback that shares a failure (or a
//                    bill) with the thing it backs up is not a fallback. It is
//                    also now the D&G region gate here — see adminDistrictForPostcode.
//   Nominatim        already used by the listing page for the map, but it is a
//                    general geocoder whose postcode results are less reliable,
//                    and its usage policy discourages automated lookups.
//
// BEST EFFORT, ALWAYS. A failure here returns null and the save proceeds. A
// host must never be unable to save their own listing because a third party is
// having a bad minute, and the town fallback means null is survivable.

import { tidyPostcode } from '@/lib/address';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

/**
 * The centroid of a UK postcode, or null.
 *
 * Never throws. Every failure — a malformed postcode, a 404, an outage, a
 * timeout — is the same answer, because the caller does the same thing with all
 * of them.
 */
export async function coordinatesForPostcode(
    postcode: string | null | undefined
): Promise<Coordinates | null> {
    const tidy = tidyPostcode(String(postcode || '').trim());
    if (!tidy) return null;

    try {
        // Six seconds. This sits inside a save, and a host waiting on a
        // third party to decide whether their listing saves is the failure
        // being avoided rather than one worth introducing.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(
            'https://api.postcodes.io/postcodes/' + encodeURIComponent(tidy),
            { signal: controller.signal, cache: 'no-store' }
        );
        clearTimeout(timer);

        if (!res.ok) return null;

        const body = await res.json();
        const lat = body && body.result && body.result.latitude;
        const lng = body && body.result && body.result.longitude;

        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        // 0,0 is the Atlantic. It is what a broken lookup looks like, and
        // pointForListing already treats it as absent.
        if (lat === 0 && lng === 0) return null;

        return { latitude: lat, longitude: lng };
    } catch (err) {
        return null;
    }
}

/**
 * The council area (administrative district) a UK postcode sits in, or null.
 *
 * Same keyless postcodes.io source as coordinatesForPostcode, used to gate an
 * address to Dumfries & Galloway by the REAL boundary rather than a postcode
 * prefix — DG16 runs into Cumbria and genuine D&G addresses sit in CA/KA/ML/TD,
 * so "starts with DG" is wrong both ways. `admin_district` is the council area
 * ("Dumfries and Galloway", "Cumberland", "South Ayrshire", …).
 *
 * Never throws: any failure returns null, and the caller decides what an unknown
 * district means (here, we refuse rather than guess an address into the region).
 */
export async function adminDistrictForPostcode(
    postcode: string | null | undefined
): Promise<string | null> {
    const tidy = tidyPostcode(String(postcode || '').trim());
    if (!tidy) return null;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(
            'https://api.postcodes.io/postcodes/' + encodeURIComponent(tidy),
            { signal: controller.signal, cache: 'no-store' }
        );
        clearTimeout(timer);
        if (!res.ok) return null;
        const body = await res.json();
        const district = body && body.result && body.result.admin_district;
        return typeof district === 'string' && district.trim() ? district.trim() : null;
    } catch {
        return null;
    }
}

/** The one council area this site covers, as postcodes.io spells it. */
export const DG_ADMIN_DISTRICT = 'Dumfries and Galloway';

/**
 * What to add to a listing patch so its coordinates match its postcode.
 *
 * WHEN IT FILLS, AND WHEN IT LEAVES WELL ALONE
 *
 *   no coordinates, a postcode          fill them
 *   the postcode is changing            re-fill them
 *   coordinates already, same postcode  leave them
 *
 * The middle case is the arguable one. Coordinates from the address lookup are
 * more precise than a postcode centroid, so re-filling is a small downgrade —
 * but coordinates left over from a PREVIOUS postcode are simply wrong, and a
 * centroid at the right address beats a rooftop at the wrong one.
 *
 * Returns an empty object when there is nothing to do, so a caller can spread
 * it unconditionally.
 */
export async function coordinatePatchFor(
    before: { postcode?: string | null; latitude?: number | null; longitude?: number | null },
    patch: { postcode?: string | null }
): Promise<Partial<Coordinates>> {
    const nextPostcode = patch.postcode === undefined ? before.postcode : patch.postcode;
    if (!nextPostcode) return {};

    const hasCoordinates =
        typeof before.latitude === 'number' && typeof before.longitude === 'number';

    const postcodeChanging =
        patch.postcode !== undefined
        && tidyPostcode(String(patch.postcode || '')) !== tidyPostcode(String(before.postcode || ''));

    if (hasCoordinates && !postcodeChanging) return {};

    const found = await coordinatesForPostcode(nextPostcode);
    return found ? { latitude: found.latitude, longitude: found.longitude } : {};
}
