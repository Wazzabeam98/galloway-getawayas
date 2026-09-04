// One place decides when a "Get directions" link is safe to offer, and where it
// points. The rule the arrival screen exists to enforce: never send a guest to
// the town centre. A link is only built when we can put them at the actual door
// — real COORDINATES, or a STREET address the maps app can geocode to the street.
// A listing that knows only its town gets NO directions link: a button that
// confidently drives to the wrong place is worse than no button, and the guest
// is shown the address (and told to ask the host) instead.
//
// This used to be inline in the home card and, via /api/trips, the trips card —
// each building the link from `[street_address, postcode, location]` joined,
// which silently includes the TOWN alone when the street parts are missing. That
// is exactly the wrong-place failure this prevents; the arrival page even carried
// a comment claiming directions "never" fell back to the town, while the code
// did. One function now, and it matches the comment.

export interface DirectionsParts {
    latitude?: number | null;
    longitude?: number | null;
    streetAddress?: string | null;
    postcode?: string | null;
    location?: string | null;
}

// A real pin — present, numeric, and not the null-island (0,0) a missing geocode
// leaves behind.
export function hasRealCoords(lat?: number | null, lng?: number | null): boolean {
    return lat != null && lng != null && !(Number(lat) === 0 && Number(lng) === 0);
}

// A maps directions URL to the actual door, or null when we cannot place them
// there. Coordinates win; failing that, a STREET address is geocodable; the town
// on its own is not a destination and returns null.
export function directionsUrl(p: DirectionsParts): string | null {
    const base = 'https://www.google.com/maps/dir/?api=1&destination=';
    if (hasRealCoords(p.latitude, p.longitude)) {
        return base + p.latitude + ',' + p.longitude;
    }
    if (p.streetAddress) {
        const dest = [p.streetAddress, p.postcode, p.location].filter(Boolean).join(', ');
        return base + encodeURIComponent(dest);
    }
    return null;
}

// Apple Maps, the same rule and the same guard — a pin or a STREET address only,
// never the town. `daddr` is Apple's destination; the https://maps.apple.com
// link opens the Maps app on an Apple device and the web map everywhere else,
// which is how the picker lets the OS choose without us sniffing for the app.
export function appleDirectionsUrl(p: DirectionsParts): string | null {
    const base = 'https://maps.apple.com/?daddr=';
    if (hasRealCoords(p.latitude, p.longitude)) {
        return base + p.latitude + ',' + p.longitude;
    }
    if (p.streetAddress) {
        const dest = [p.streetAddress, p.postcode, p.location].filter(Boolean).join(', ');
        return base + encodeURIComponent(dest);
    }
    return null;
}
