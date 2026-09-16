// The shape of a register-your-interest submission, and the one place that
// decides whether a raw body is a valid one. Kept out of the route so it can be
// unit-tested without a server — imports its sibling with a relative path
// because the @/ alias is unresolved at Node runtime under the test runner.
import { GUEST_REGIONS } from './strings';

// The three tiles, and the labels the notification email and the admin list
// read. Order is the fork's order: let, experience, service.
export const INTEREST_CATEGORIES = ['holiday_let', 'guest_experience', 'tradesman'] as const;
export type InterestCategory = (typeof INTEREST_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<InterestCategory, string> = {
    holiday_let: 'Holiday let',
    guest_experience: 'Guest experience',
    tradesman: 'Tradesman',
};

// The canonical region keys, straight from the picker the sign-up wizard uses —
// so a stored region sorts and reads the same as what they would pick signing
// up. 'all' ("Across Dumfries & Galloway") is a legitimate answer for someone
// not tied to one area.
export const REGION_KEYS = GUEST_REGIONS.map((r) => r.key);
export const REGION_LABEL: Record<string, string> = Object.fromEntries(
    GUEST_REGIONS.map((r) => [r.key, r.label])
);

// Length caps: generous for a human, a ceiling on a bot. Applied by trimming and
// slicing, the same way /api/services/wanted caps its free text.
const CAP = { name: 120, email: 200, phone: 40, notes: 1000 };

export interface InterestInput {
    category: InterestCategory;
    name: string;
    email: string;
    phone: string | null;
    region: string | null;
    // A holiday-let registrant answers a number of properties (stepper); the
    // guest-experience and tradesman paths answer free text. Exactly one of these
    // is set per row, by category.
    notes: string | null;
    propertyCount: number | null;
}

export type InterestParse = { ok: true; value: InterestInput } | { ok: false; error: string };

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate and normalise a raw submission body. Returns the clean row to store,
 * or the first reason it was rejected. Email is lowercased here so the dedupe
 * index (lower(email), category) and every read agree on one spelling.
 *
 * region is optional but, when given, must be a real GUEST_REGIONS key — a
 * client sending anything else is a bug or a poke at the route, not a person.
 */
export function parseInterest(body: any): InterestParse {
    const category = str(body?.category);
    if (!INTEREST_CATEGORIES.includes(category as InterestCategory)) {
        return { ok: false, error: 'Choose what you would like to register interest in.' };
    }

    const name = str(body?.name).slice(0, CAP.name);
    if (!name) return { ok: false, error: 'A name is needed.' };

    const email = str(body?.email).toLowerCase().slice(0, CAP.email);
    // The same low bar the other public routes use: an address has an @ with
    // something either side. Real deliverability is proved by the email landing.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { ok: false, error: 'A valid email is needed.' };
    }

    const phone = str(body?.phone).slice(0, CAP.phone) || null;

    const regionRaw = str(body?.region);
    const region = regionRaw ? regionRaw : null;
    if (region && !REGION_KEYS.includes(region)) {
        return { ok: false, error: 'That is not a Dumfries & Galloway region.' };
    }

    // By category: the holiday-let path carries a property count and no notes;
    // the others carry notes and no count. This is enforced here so the stored
    // row is clean whatever a client sends.
    let notes: string | null = null;
    let propertyCount: number | null = null;
    if (category === 'holiday_let') {
        const n = Math.round(Number(body?.propertyCount ?? body?.property_count));
        // The stepper starts at 1 and cannot go below it; a missing or junk value
        // falls back to 1 rather than rejecting a holiday-let registration.
        propertyCount = Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 1;
    } else {
        notes = str(body?.notes).slice(0, CAP.notes) || null;
    }

    return {
        ok: true,
        value: { category: category as InterestCategory, name, email, phone, region, notes, propertyCount },
    };
}
