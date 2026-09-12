// Turning an Ideal Postcodes resolved address into the boxes on the address
// forms. (Was getAddress.io until it ceased trading on 4 Feb 2026; Ideal is
// licensed directly from Royal Mail's PAF, so the field names below are theirs.)
//
// Kept out of the route file because a Next.js route may only export handlers,
// and kept in one function because the old mapping was spread across a .map(),
// a click handler and two fallbacks — which is how the postcode ended up in the
// street box and the county in the town box.

interface IdealAddressResult {
    postcode?: string;
    latitude?: number;
    longitude?: number;
    // PAF premise/thoroughfare lines, already composed by Ideal.
    line_1?: string;
    line_2?: string;
    line_3?: string;
    post_town?: string;
    dependant_locality?: string;
    // Ideal returns several county flavours; administrative_county is the modern
    // council-ish one, county the postal one. Either is "not the street".
    county?: string;
    administrative_county?: string;
    sub_building_name?: string;
    building_name?: string;
    building_number?: string;
}

function clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

// "dg71ab" -> "DG7 1AB". Same rule the form already used, applied at the point
// the address enters the system so every listing reads the same way.
export function tidyPostcode(raw: string): string {
    const squashed = raw.replace(/\s+/g, '').toUpperCase();
    if (squashed.length < 5) return raw.trim().toUpperCase();
    return squashed.slice(0, squashed.length - 3) + ' ' + squashed.slice(squashed.length - 3);
}

export function mapAddress(result: IdealAddressResult) {
    const town = clean(result.post_town);
    const county = clean(result.administrative_county) || clean(result.county);
    const locality = clean(result.dependant_locality);

    // Anything that is really the town, the county or the locality must not
    // also be treated as part of the street — that is exactly how the postcode
    // and the county each ended up in two boxes before.
    const notThePlace = [town, county, locality]
        .filter(Boolean)
        .map((v) => v.toLowerCase());

    const streetParts: string[] = [];
    for (const line of [result.line_1, result.line_2, result.line_3]) {
        const part = clean(line);
        if (!part) continue;
        if (notThePlace.indexOf(part.toLowerCase()) !== -1) continue;
        // A line repeated by the source shouldn't become a repeated segment.
        if (streetParts.some((p) => p.toLowerCase() === part.toLowerCase())) continue;
        streetParts.push(part);
    }

    // A flat or sub-building is its own box on the form. When the source has
    // put it at the front of line_1 as well, the street keeps the rest.
    const flat = clean(result.sub_building_name);
    const street = streetParts
        .filter((p) => !flat || p.toLowerCase() !== flat.toLowerCase())
        .join(', ');

    const rawPostcode = clean(result.postcode);

    return {
        flat,
        street,
        town,
        // The county flavours in this part of Scotland are usually the historic
        // one ("Kirkcudbrightshire") rather than the council area. Passed through
        // so it can be seen, but the form defaults the Region box to the council
        // area instead, because that is what the existing listings use and what
        // `location` has to match.
        county,
        postcode: rawPostcode ? tidyPostcode(rawPostcode) : '',
        latitude: typeof result.latitude === 'number' ? result.latitude : null,
        longitude: typeof result.longitude === 'number' ? result.longitude : null,
    };
}


// The private address line, assembled from the three boxes that are not the
// town, the region or the postcode. This is what goes in `street_address` —
// "Flat 2, Rose Cottage, 18 Dovecroft". None of it reaches a guest-facing
// screen; `location` is the public one.
export function buildStreetAddress(
    flat: string | null,
    propertyName: string | null,
    street: string | null,
): string {
    const parts: string[] = [];
    for (const raw of [flat, propertyName, street]) {
        const part = (raw || '').trim();
        if (!part) continue;
        // A host who typed the property name into the street box too shouldn't
        // get it stored twice.
        if (parts.some((p) => p.toLowerCase() === part.toLowerCase())) continue;
        parts.push(part);
    }
    return parts.join(', ');
}

// What actually went wrong upstream, safe to hand back to a signed-in host.
//
// These routes used to collapse every upstream failure into "Address search is
// unavailable just now", which is polite and tells you nothing — a wrong key, a
// spent allowance and an outage all looked identical.
//
// The key travels in the query string, so anything the provider echoes back
// could carry it. It is redacted defensively even though the error bodies seen
// so far do not include it.
export async function upstreamDetail(response: Response, key: string): Promise<string> {
    let body = '';
    try {
        body = (await response.text()).slice(0, 300).trim();
    } catch {
        body = '';
    }
    if (key && body) body = body.split(key).join('<redacted>');
    return `address lookup returned ${response.status}${body ? ': ' + body : ''}`;
}
