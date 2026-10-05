// The map point for an experience provider's venue — the "Where you'll be" map.
//
// A provider with a place guests come to (a set-times session at their venue or
// meeting point, or a made-to-order collection point) gets a point: the centroid
// of their collection postcode, rounded to three decimal places (~110m), the
// precision a cottage's public pin uses. A provider with no place (comes to the
// guest, delivery only) gets none, and the page shows no map.
//
// Stored on service_providers.venue_lat/venue_lng, written only here, with the
// service role (migration 20261005140000_provider_venue_point.sql). Callers:
//   - POST /api/services/venue-point, after the sign-up wizard saves;
//   - the listing editor's address save (/api/services/listing/save, 'where');
//   - admin approval, for anyone approved without one.
//
// BEST EFFORT. A geocoder failure leaves what was there and never fails the
// caller's save or approval — a missing map is survivable, a refused save isn't.

import { coordinatesForPostcode, type Coordinates } from './postcodeGeocode';

/** Whether this provider has a place a guest goes to. */
export function hasVenue(shape: string | null | undefined, fulfilment: string | null | undefined): boolean {
    const f = String(fulfilment || '');
    // A set-times session happens at the provider's place unless they travel
    // ('delivery'); an unset fulfilment on a slot is come-to-me (the default).
    if (shape === 'slot') return f !== 'delivery';
    // Made to order: only when guests can collect.
    if (shape === 'made_to_order') return f === 'collection' || f === 'both';
    return false;
}

/** ~110m, the public-pin precision (same as listings.approx_latitude). */
export function roundedPoint(c: Coordinates): { venue_lat: number; venue_lng: number } {
    return {
        venue_lat: Math.round(c.latitude * 1000) / 1000,
        venue_lng: Math.round(c.longitude * 1000) / 1000,
    };
}

export type VenueOutcome = 'set' | 'cleared' | 'kept' | 'no-postcode' | 'lookup-failed' | 'not-found';

/**
 * Bring a provider's venue point in line with their stored address.
 * `onlyIfMissing` (approval) leaves an existing point alone.
 */
export async function refreshVenuePoint(
    admin: any,
    providerId: string,
    opts: { onlyIfMissing?: boolean } = {},
): Promise<VenueOutcome> {
    try {
        const { data: p } = await admin
            .from('service_providers')
            .select('id, shape, fulfilment, collection_postcode, venue_lat, venue_lng')
            .eq('id', providerId)
            .maybeSingle();
        if (!p) return 'not-found';

        const hasPoint = p.venue_lat != null && p.venue_lng != null;

        if (!hasVenue(p.shape, p.fulfilment)) {
            // No place any more (switched to travelling) — no map, so no point.
            if (!hasPoint) return 'kept';
            await admin.from('service_providers').update({ venue_lat: null, venue_lng: null }).eq('id', providerId);
            return 'cleared';
        }

        if (opts.onlyIfMissing && hasPoint) return 'kept';

        const postcode = String(p.collection_postcode || '').trim();
        if (!postcode) return 'no-postcode';

        const coords = await coordinatesForPostcode(postcode);
        if (!coords) return 'lookup-failed';

        await admin.from('service_providers').update(roundedPoint(coords)).eq('id', providerId);
        return 'set';
    } catch {
        return 'lookup-failed';
    }
}

/**
 * Where the venue map points: the provider's own venue point first, otherwise a
 * real (non-zero) coordinate on one of their service_areas rows — the seeds'
 * older home for it. A guest's coverage REGION rows are written at 0,0 (the
 * column is NOT NULL and nothing reads them as a place), so 0,0 never counts:
 * picking it up pinned a studio-and-travel provider's map in the Atlantic.
 */
export function venueMapPoint(
    provider: { venue_lat?: any; venue_lng?: any } | null | undefined,
    areas: Array<{ centre_lat?: any; centre_lng?: any }> | null | undefined,
): { lat: number; lng: number } | null {
    const real = (lat: any, lng: any) => {
        if (lat == null || lng == null) return null;
        const a = Number(lat), b = Number(lng);
        if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
        return { lat: a, lng: b };
    };
    const own = provider ? real(provider.venue_lat, provider.venue_lng) : null;
    if (own) return own;
    for (const a of areas || []) {
        const p = real(a.centre_lat, a.centre_lng);
        if (p) return p;
    }
    return null;
}
