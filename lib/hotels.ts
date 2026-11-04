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

export const BED_TYPES = ['single', 'double', 'twin', 'king', 'super_king', 'bunk', 'sofa_bed'] as const;
export type BedType = (typeof BED_TYPES)[number];

export const BED_LABELS: Record<BedType, string> = {
    single: 'Single bed',
    double: 'Double bed',
    twin: 'Twin beds',
    king: 'King bed',
    super_king: 'Super king bed',
    bunk: 'Bunk bed',
    sofa_bed: 'Sofa bed',
};

export type BedConfigEntry = { type: BedType; count: number };

// ---------------------------------------------------------------------------
// DRAFT ROOM TYPE — what the wizard holds and the rules a room type must meet
// ---------------------------------------------------------------------------

export type DraftRoomType = {
    name: string;
    description?: string;
    inventory_count: number; // how many identical rooms of this type
    max_adults: number;
    max_children: number;
    max_occupancy: number; // Booking.com's rule: ≤ adults + children
    size_sqm?: number | null;
    bed_config: BedConfigEntry[];
    amenities?: string[];
    price_per_night: number; // phase-one base rate; moves to the rate plan later
    min_nights?: number;
};

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
    const occ = Number(r.max_occupancy);
    if (!Number.isInteger(occ) || occ < 1) return 'Set the maximum number of guests for this room.';
    if (occ > adults + children) return 'Maximum guests cannot be more than adults plus children.';
    const price = Number(r.price_per_night);
    if (!Number.isFinite(price) || price <= 0) return 'Give the room type a nightly price.';
    return null;
}

export const MIN_HOTEL_PHOTOS = 5;

// The whole hotel is ready to publish. Same shape as listingRules: first problem
// or null. Used by the publish route (server is the authority) and echoed by the
// wizard's Publish button.
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
    if (!h) return 'Nothing to publish yet.';
    if (!h.name || !h.name.trim()) return 'Give the hotel a name.';
    if (!isHotelPropertyType(h.property_type)) return 'Choose what kind of place this is.';
    if (!h.street_address || !h.street_address.trim()) return 'Add the address.';
    if (!h.check_in_time) return 'Set a check-in time.';
    if (!h.check_out_time) return 'Set a check-out time.';
    const photos = Array.isArray(h.images) ? h.images : [];
    if (photos.length < MIN_HOTEL_PHOTOS) return `Add at least ${MIN_HOTEL_PHOTOS} photos.`;
    const rooms = Array.isArray(h.roomTypes) ? h.roomTypes : [];
    if (rooms.length < 1) return 'Add at least one room type.';
    for (const r of rooms) {
        const p = roomTypeProblem(r);
        if (p) return `Room type "${r?.name || 'untitled'}": ${p}`;
    }
    return null;
}
