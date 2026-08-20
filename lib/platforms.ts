// Which site an imported calendar came from, worked out from its export URL.
//
// Attribution comes from the FEED, not from the event text — the summary line
// in an iCal file is whatever that platform felt like writing ("Reserved",
// "CLOSED - Not available") and changes without notice.
//
// Colours are each platform's own, so a host reading the calendar recognises
// them at a glance. Their logos are deliberately not reproduced: a coloured
// chip with the name reads just as fast and avoids using someone else's
// trademark inside our product.

export interface Platform {
    key: string;
    name: string;
    // Tailwind classes rather than hex, so the calendar stays consistent.
    bg: string;
    border: string;
    text: string;
    dot: string;
}

export const PLATFORMS: Record<string, Platform> = {
    airbnb: {
        key: 'airbnb',
        name: 'Airbnb',
        bg: 'bg-rose-500',
        border: 'border-rose-500',
        text: 'text-white',
        dot: 'bg-rose-500',
    },
    booking: {
        key: 'booking',
        name: 'Booking.com',
        bg: 'bg-[#003580]',
        border: 'border-[#003580]',
        text: 'text-white',
        dot: 'bg-[#003580]',
    },
    vrbo: {
        key: 'vrbo',
        name: 'Vrbo',
        bg: 'bg-sky-700',
        border: 'border-sky-700',
        text: 'text-white',
        dot: 'bg-sky-700',
    },
    google: {
        key: 'google',
        name: 'Google Calendar',
        bg: 'bg-blue-600',
        border: 'border-blue-600',
        text: 'text-white',
        dot: 'bg-blue-600',
    },
    other: {
        key: 'other',
        name: 'Another calendar',
        bg: 'bg-slate-600',
        border: 'border-slate-600',
        text: 'text-white',
        dot: 'bg-slate-600',
    },
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
        return { ...PLATFORMS.other, name: label.trim() };
    }

    return PLATFORMS.other;
}
