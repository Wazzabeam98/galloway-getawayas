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
    booking: { key: 'booking', name: 'Booking.com', colour: '#003580' },
    vrbo: { key: 'vrbo', name: 'Vrbo', colour: '#0F5B99' },
    google: { key: 'google', name: 'Google Calendar', colour: '#4285F4' },
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

    // A host's own label is more use than "Another calendar", so keep it.
    if (label && label.trim()) {
        return { key: 'other', name: label.trim(), colour: PLATFORMS.other.colour };
    }

    return PLATFORMS.other;
}
