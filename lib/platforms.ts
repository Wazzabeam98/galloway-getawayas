// Which site an imported calendar came from, worked out from its export URL.
//
// Attribution comes from the FEED, not from the event text — the summary line
// in an iCal file is whatever that platform felt like writing ("Reserved",
// "CLOSED - Not available") and changes without notice.
//
// Plain colour values, not Tailwind class names, on purpose: Tailwind only
// generates CSS for classes it can find by scanning pages, components, app
// and src. A class name written in this folder is never seen, so it silently
// produces no styling at all.
//
// Their logos are deliberately not reproduced — a coloured chip with the name
// reads just as fast and avoids putting someone else's trademark in here.

export interface Platform {
    key: string;
    name: string;
    colour: string;
}

export const PLATFORMS: Record<string, Platform> = {
    airbnb: { key: 'airbnb', name: 'Airbnb', colour: '#FF5A5F' },
    // Booking.com, Vrbo and Google are all blue brands, and once the calendar
    // softens a bar ~78% towards white those blues collapse into one another —
    // Booking vs Vrbo rendered at ΔE 3 (invisible), all three within ΔE ~3–8.
    // Booking keeps the blue, since of the three it is the one whose identity IS
    // that blue. Vrbo and Google move to distinct hues so a host can actually
    // tell their channels apart: Google takes its own brand yellow, and Vrbo a
    // pink — a departure from its blue, for the same reason Hospitable took
    // purple — which pulls Booking↔Vrbo to ΔE ~19.
    booking: { key: 'booking', name: 'Booking.com', colour: '#003580' },
    vrbo: { key: 'vrbo', name: 'Vrbo', colour: '#DB2777' },
    google: { key: 'google', name: 'Google Calendar', colour: '#FBBC04' },
    // Hospitable's own brand is a raspberry pink, which on the calendar sits
    // right on top of Airbnb's coral once the bars are softened — the one thing
    // channel colours exist to avoid. So it takes a purple instead, a nod to
    // Hospitable's lavender accent and clearly its own next to every other
    // platform (and to the emerald of a direct booking and the black of a
    // minimum-stay night).
    hospitable: { key: 'hospitable', name: 'Hospitable', colour: '#7C3AED' },
    other: { key: 'other', name: 'Another calendar', colour: '#475569' },
};

export function platformFromUrl(url: string | null, label?: string | null): Platform {
    const haystack = ((url || '') + ' ' + (label || '')).toLowerCase();

    if (haystack.indexOf('airbnb') !== -1) return PLATFORMS.airbnb;
    if (haystack.indexOf('booking.com') !== -1 || haystack.indexOf('bstatic') !== -1) {
        return PLATFORMS.booking;
    }
    if (haystack.indexOf('vrbo') !== -1 || haystack.indexOf('homeaway') !== -1) {
        return PLATFORMS.vrbo;
    }
    if (haystack.indexOf('google.com/calendar') !== -1) return PLATFORMS.google;
    if (haystack.indexOf('hospitable') !== -1) return PLATFORMS.hospitable;

    // A host's own label is more use than "Another calendar", so keep it.
    if (label && label.trim()) {
        return { key: 'other', name: label.trim(), colour: PLATFORMS.other.colour };
    }

    return PLATFORMS.other;
}
