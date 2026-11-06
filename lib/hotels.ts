// Hotels — a second kind of place a guest can book on Galloway Getaways.
//
// A cottage is ONE unit. A hotel is a property with several room types, each a
// count of identical rooms, sold per room type. This file holds the launch
// switch and the pure hotel domain rules (property types, what a room type
// needs, what a hotel needs to go live) — no queries, so the sign-up wizard,
// the save/publish routes and the tests all read the same rules. HOTELS-PLAN.md
// is the full design.
//
// Everything hotel-shaped is OFF production until hotelsOpen() says otherwise.

import { flagIsTrue } from '@/lib/serviceOrders';

// ---------------------------------------------------------------------------
// THE LAUNCH SWITCH
// ---------------------------------------------------------------------------
//
// Hotels are not visible or bookable on PRODUCTION until this says so. One env
// var, HOTELS_OPEN, read tolerantly (the same ' True '/quote/newline tolerance
// as businessSignupsOpen — a Sensitive Vercel variable cannot be read back, so
// a mistyped value must not silently hold the feature shut). Absent, or anything
// but 'true', means held — the safe direction.
//
// Read on the SERVER only — this is the lock, not the shop window, so it must
// not be a NEXT_PUBLIC_ value a browser could see or a UI that only hides a
// button. The pages AND the /api/hotels routes both consult it, so a direct API
// call is refused the same as a hidden click.
//
// Held on PRODUCTION only. Previews and local (VERCEL_ENV !== 'production')
// always return open, so the whole hotel surface — sign-up, the listing pages,
// booking — stays walkable on a preview and against TEST while it is gated for
// real visitors. Flipping it on Production takes a redeploy to bind, same as the
// other flags; /api/health/flags says whether it is set and how it reads,
// without the value.
export function hotelsOpen(): boolean {
    if (process.env.VERCEL_ENV !== 'production') return true;
    return flagIsTrue(process.env.HOTELS_OPEN);
}

// ---------------------------------------------------------------------------
// WHAT A HOTEL IS
// ---------------------------------------------------------------------------

export type HotelPropertyType = 'hotel' | 'bnb' | 'guesthouse' | 'inn' | 'aparthotel';

export const HOTEL_PROPERTY_TYPES: { value: HotelPropertyType; label: string; blurb: string }[] = [
    { value: 'hotel', label: 'Hotel', blurb: 'Rooms with front-desk service' },
    { value: 'bnb', label: 'Bed & breakfast', blurb: 'Rooms with breakfast, often family-run' },
    { value: 'guesthouse', label: 'Guest house', blurb: 'A small place letting several rooms' },
    { value: 'inn', label: 'Inn', blurb: 'Rooms above a pub or restaurant' },
    { value: 'aparthotel', label: 'Aparthotel', blurb: 'Serviced apartments let by the night' },
];

export function isHotelPropertyType(v: unknown): v is HotelPropertyType {
    return typeof v === 'string' && HOTEL_PROPERTY_TYPES.some((t) => t.value === v);
}

// The property-wide facilities tick-list (Booking.com keeps this spare and
// property-level, not per room). Kept short on purpose — the pages here "fail by
// being thorough rather than spare", so this is the common set, not everything.
export const HOTEL_FACILITIES: string[] = [
    'Free WiFi',
    'Parking',
    'Restaurant',
    'Bar',
    'Breakfast available',
    'Pets allowed',
    'Wheelchair accessible',
    'Family rooms',
    'Non-smoking rooms',
    'Room service',
    '24-hour front desk',
    'Garden',
    'Terrace',
    'Hot tub',
    'Swimming pool',
    'EV charging',
];

// The bed types a room can have (Liam's list). Each bed row in the editor is a
// type picked from here plus a count.
export const BED_TYPES = ['single', 'double', 'king', 'super_king', 'sofa_bed', 'bunk', 'cot'] as const;
export type BedType = (typeof BED_TYPES)[number];

export const BED_LABELS: Record<BedType, string> = {
    single: 'Single bed',
    double: 'Double bed',
    king: 'King bed',
    super_king: 'Super king bed',
    sofa_bed: 'Sofa bed',
    bunk: 'Bunk bed',
    cot: 'Cot',
};

export type BedConfigEntry = { type: BedType; count: number };

// ---------------------------------------------------------------------------
// DRAFT ROOM TYPE — what the wizard holds and the rules a room type must meet
// ---------------------------------------------------------------------------

export type DraftRoomType = {
    id?: string;
    name: string;
    description?: string;
    inventory_count: number; // how many identical rooms of this type
    max_adults: number;
    max_children: number;
    // Derived (max_adults + max_children), set on save — the wizard no longer
    // asks for it separately (Liam's walkthrough). Kept because availability and
    // the occupancy wall read it.
    max_occupancy?: number;
    size_sqm?: number | null;
    bed_config: BedConfigEntry[];
    bathroom_type?: string | null;
    bathroom_features?: string[];
    views?: string[];
    smoking?: string;
    accessibility?: string[];
    amenities?: string[]; // in-room amenities
    breakfast_included?: boolean;
    // When breakfast is NOT in the price, an optional paid extra: a price per
    // person per night the guest can add at booking (the cottage extras path).
    breakfast_price?: number | null;
    images?: string[];
    price_per_night: number; // phase-one base rate; moves to the rate plan later
    min_nights?: number;
};

// Sleeps = adults + children. The one place it is worked out, so the wizard, the
// save route and the occupancy wall agree.
export function occupancyOf(r: { max_adults?: number | null; max_children?: number | null }): number {
    return Math.max(1, (Number(r.max_adults) || 0) + (Number(r.max_children) || 0));
}

// A single room type is valid to publish. Returns a short human sentence naming
// the first problem, or null when it is fine — mirrors the cottage listingRules
// style so the wizard and the server both read the same decision.
export function roomTypeProblem(r: Partial<DraftRoomType> | null | undefined): string | null {
    if (!r) return 'Add at least one room type.';
    if (!r.name || !r.name.trim()) return 'Give the room type a name.';
    const count = Number(r.inventory_count);
    if (!Number.isInteger(count) || count < 1) return 'Say how many rooms of this type there are (at least 1).';
    const adults = Number(r.max_adults);
    if (!Number.isInteger(adults) || adults < 1) return 'A room type must sleep at least one adult.';
    const children = Number(r.max_children ?? 0);
    if (!Number.isInteger(children) || children < 0) return 'Children must be zero or more.';
    if (!Array.isArray(r.bed_config) || r.bed_config.length === 0) return 'Add at least one bed.';
    const price = Number(r.price_per_night);
    if (!Number.isFinite(price) || price <= 0) return 'Give the room type a nightly price.';
    return null;
}

export const MIN_HOTEL_PHOTOS = 5;

// The whole hotel is ready to publish. Same shape as listingRules: first problem
// or null. Used by the publish route (server is the authority).
export type PublishableHotel = {
    name?: string | null;
    property_type?: string | null;
    street_address?: string | null;
    location?: string | null;
    images?: string[] | null;
    roomTypes?: Partial<DraftRoomType>[] | null;
    check_in_time?: string | null;
    check_out_time?: string | null;
};

export function hotelPublishProblem(h: PublishableHotel | null | undefined): string | null {
    const p = firstHotelProblem(h);
    return p ? p.message : null;
}

// ---------------------------------------------------------------------------
// THE WIZARD RULE ENGINE — "what's missing", by step
// ---------------------------------------------------------------------------
//
// Mirrors lib/listingRules PUBLISH_RULES: each rule names the step it belongs to
// and the sentence to show. The wizard uses hotelProblemAtStep() to refuse Next
// with a worded reason, and firstHotelProblem() on the Review step to jump back
// to the exact step that is incomplete and explain it — never a disabled button.
// The STEP numbers are 1-indexed and match the wizard's step order.

export const HOTEL_STEPS = {
    TYPE: 1,
    NAME: 2,
    LOCATION: 3,
    ROOMS: 4,
    FACILITIES: 5,
    // Restaurant/bar opening hours are their own step, not tucked under
    // facilities — a hotel's dining hours are a thing guests scan for.
    RESTAURANT: 6,
    PHOTOS: 7,
    TIMES: 8,
    CANCELLATION: 9,
    REVIEW: 10,
} as const;
export const HOTEL_TOTAL_STEPS = 10;

type HotelRule = { step: number; message: string; failed: (h: PublishableHotel) => boolean };

export const HOTEL_PUBLISH_RULES: HotelRule[] = [
    { step: HOTEL_STEPS.TYPE, message: 'Choose what kind of place this is.', failed: (h) => !isHotelPropertyType(h.property_type) },
    { step: HOTEL_STEPS.NAME, message: 'Give the hotel a name.', failed: (h) => !h.name || !h.name.trim() },
    { step: HOTEL_STEPS.LOCATION, message: 'Add the address.', failed: (h) => !h.street_address || !h.street_address.trim() },
    { step: HOTEL_STEPS.LOCATION, message: 'Add the town.', failed: (h) => !h.location || !h.location.trim() },
    { step: HOTEL_STEPS.ROOMS, message: 'Add at least one room type.', failed: (h) => !Array.isArray(h.roomTypes) || h.roomTypes.length < 1 },
    {
        step: HOTEL_STEPS.ROOMS,
        message: 'One of your room types still needs finishing.',
        failed: (h) => (h.roomTypes || []).some((r) => roomTypeProblem(r) !== null),
    },
    { step: HOTEL_STEPS.PHOTOS, message: `Add at least ${MIN_HOTEL_PHOTOS} photos of the hotel.`, failed: (h) => (Array.isArray(h.images) ? h.images.filter(Boolean).length : 0) < MIN_HOTEL_PHOTOS },
    { step: HOTEL_STEPS.TIMES, message: 'Set a check-in time.', failed: (h) => !h.check_in_time },
    { step: HOTEL_STEPS.TIMES, message: 'Set a check-out time.', failed: (h) => !h.check_out_time },
];

// The first unmet rule anywhere, with its step — for the Review step's
// jump-and-explain. Null when ready to publish.
export function firstHotelProblem(h: PublishableHotel | null | undefined): { step: number; message: string } | null {
    if (!h) return { step: HOTEL_STEPS.TYPE, message: 'Nothing to publish yet.' };
    for (const rule of HOTEL_PUBLISH_RULES) {
        if (rule.failed(h)) {
            // For the generic "a room needs finishing" rule, surface the specific
            // room problem so the sentence is actionable.
            if (rule.step === HOTEL_STEPS.ROOMS && rule.message.startsWith('One of')) {
                const bad = (h.roomTypes || []).find((r) => roomTypeProblem(r) !== null);
                return { step: rule.step, message: `Room "${(bad && bad.name) || 'untitled'}": ${roomTypeProblem(bad)}` };
            }
            return { step: rule.step, message: rule.message };
        }
    }
    return null;
}

// The first unmet rule that belongs to a given step — for refusing Next.
export function hotelProblemAtStep(h: PublishableHotel | null | undefined, step: number): string | null {
    if (!h) return null;
    for (const rule of HOTEL_PUBLISH_RULES) {
        if (rule.step === step && rule.failed(h)) {
            if (rule.step === HOTEL_STEPS.ROOMS && rule.message.startsWith('One of')) {
                const bad = (h.roomTypes || []).find((r) => roomTypeProblem(r) !== null);
                return `Room "${(bad && bad.name) || 'untitled'}": ${roomTypeProblem(bad)}`;
            }
            return rule.message;
        }
    }
    return null;
}
