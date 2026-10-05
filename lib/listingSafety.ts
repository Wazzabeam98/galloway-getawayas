// Guest safety, checkout instructions and pets for a holiday let — the lists
// and the cleaning rules in one place, so the editor, the save route, the
// public listing, the booking card and checkout all read the same answers.
// Framework-free and relative imports only (unit-tested).

// ---------------------------------------------------------------------------
// PETS
//
// "Pets allowed" stays an AMENITY (the badge, the Dog friendly filter, the
// amenities list and the listing's "Pets allowed" line all read it), but it is
// set in House rules, with a maximum. A listing that allowed pets before the
// maximum existed was backfilled to the top of Airbnb's range, so nothing that
// could be booked before is refused now.
// ---------------------------------------------------------------------------

export const PETS_AMENITY = 'Pets allowed';
export const MAX_PETS_CAP = 5;
export const DEFAULT_MAX_PETS = 1;

export function petsAllowed(listing: { amenities?: string[] | null }): boolean {
    return Array.isArray(listing.amenities) && listing.amenities.indexOf(PETS_AMENITY) !== -1;
}

/** How many pets a booking may bring: 0 when the house rules say no pets. */
export function petLimit(listing: { amenities?: string[] | null; max_pets?: number | null }): number {
    if (!petsAllowed(listing)) return 0;
    const n = Math.floor(Number(listing.max_pets || 0));
    return n >= 1 ? Math.min(n, MAX_PETS_CAP) : MAX_PETS_CAP;
}

/** The amenities with "Pets allowed" switched to match the house rule. */
export function withPetsAmenity(amenities: string[], allowed: boolean): string[] {
    const rest = (amenities || []).filter((a) => a !== PETS_AMENITY);
    return allowed ? [...rest, PETS_AMENITY] : rest;
}

export function clampMaxPets(n: unknown): number {
    const v = Math.floor(Number(n));
    if (!(v >= 1)) return DEFAULT_MAX_PETS;
    return Math.min(v, MAX_PETS_CAP);
}

export function petsProblem(pets: number, limit: number): string | null {
    if (pets <= 0) return null;
    if (limit <= 0) return 'This place doesn’t allow pets.';
    if (pets > limit) return `This place allows up to ${limit} pet${limit === 1 ? '' : 's'}.`;
    return null;
}

// ---------------------------------------------------------------------------
// CHECKOUT INSTRUCTIONS — Airbnb's tick-list, plus a note.
// ---------------------------------------------------------------------------

export const CHECKOUT_TASKS: { key: string; label: string }[] = [
    { key: 'towels', label: 'Gather used towels' },
    { key: 'rubbish', label: 'Throw rubbish away' },
    { key: 'turn_off', label: 'Turn things off' },
    { key: 'lock_up', label: 'Lock up' },
    { key: 'return_keys', label: 'Return keys' },
];
export const CHECKOUT_NOTE_MAX = 500;

export function cleanCheckoutTasks(raw: unknown): string[] {
    const keys = new Set(CHECKOUT_TASKS.map((t) => t.key));
    const picked = Array.isArray(raw) ? raw.map(String) : [];
    return CHECKOUT_TASKS.map((t) => t.key).filter((k) => keys.has(k) && picked.indexOf(k) !== -1);
}

export function cleanCheckoutNote(raw: unknown): string | null {
    const s = String(raw ?? '').trim().slice(0, CHECKOUT_NOTE_MAX);
    return s ? s : null;
}

export function checkoutTaskLabels(keys: string[] | null | undefined): string[] {
    const on = new Set(keys || []);
    return CHECKOUT_TASKS.filter((t) => on.has(t.key)).map((t) => t.label);
}

export function hasCheckoutInstructions(tasks: string[] | null | undefined, note: string | null | undefined): boolean {
    return checkoutTaskLabels(tasks).length > 0 || !!(note && note.trim());
}

// ---------------------------------------------------------------------------
// GUEST SAFETY — Airbnb's three lists, each item ✗ / ✓ with optional details.
//
// Stored in listings.guest_safety as { [key]: { yes: boolean, details?: string } };
// an item absent is unanswered. The two alarms are stored as AMENITIES (where
// every listing's answer already lives and the public page reads them); their
// ✗ is kept in guest_safety so it reads back as ✗ rather than unanswered.
// ---------------------------------------------------------------------------

export type SafetyItem = { key: string; label: string; amenity?: string; detailsRequired?: boolean };
export type SafetyGroup = { key: string; title: string; items: SafetyItem[] };

export const SAFETY_GROUPS: SafetyGroup[] = [
    {
        key: 'considerations',
        title: 'Safety considerations',
        items: [
            { key: 'not_for_children', label: 'Not a good fit for children 2–12' },
            { key: 'not_for_infants', label: 'Not a good fit for infants under 2' },
            { key: 'pool_no_gate', label: 'Pool or hot tub without a gate or lock' },
            { key: 'nearby_water', label: 'Nearby water, like a lake or river' },
            { key: 'climbing_structures', label: 'Climbing or play structure' },
            { key: 'heights_no_rails', label: 'Heights without rails or protection' },
        ],
    },
    {
        key: 'devices',
        title: 'Safety devices',
        items: [
            { key: 'security_camera', label: 'Exterior security camera', detailsRequired: true },
            { key: 'noise_monitor', label: 'Noise decibel monitor' },
            { key: 'co_alarm', label: 'Carbon monoxide alarm', amenity: 'Carbon monoxide alarm' },
            { key: 'smoke_alarm', label: 'Smoke alarm', amenity: 'Smoke alarm' },
        ],
    },
    {
        key: 'property',
        title: 'Property info',
        items: [
            { key: 'stairs', label: 'Guests must climb stairs' },
            { key: 'noise', label: 'Potential noise during stays' },
            { key: 'pets_on_property', label: 'Pets live at the property' },
            { key: 'no_parking', label: 'No parking on the property' },
            { key: 'shared_spaces', label: 'Property has shared spaces' },
            { key: 'limited_amenities', label: 'Limited essential amenities' },
            { key: 'weapons', label: 'Weapons on the property' },
        ],
    },
];

export const SAFETY_DETAILS_MAX = 300;
export type SafetyAnswer = { yes: boolean; details?: string };
export type GuestSafety = Record<string, SafetyAnswer>;

const ALL_ITEMS: SafetyItem[] = SAFETY_GROUPS.flatMap((g) => g.items);

/** A private or shared room has shared spaces, whatever was answered. */
export function sharedSpacesForced(privacyType: string | null | undefined): boolean {
    return privacyType === 'A private room' || privacyType === 'A shared room';
}

/** Only known items, booleans and trimmed details; shared spaces follows the listing type. */
export function cleanGuestSafety(raw: unknown, privacyType?: string | null): GuestSafety {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
    const out: GuestSafety = {};
    for (const item of ALL_ITEMS) {
        const a = src[item.key];
        if (!a || typeof a !== 'object' || typeof a.yes !== 'boolean') continue;
        const details = String(a.details ?? '').trim().slice(0, SAFETY_DETAILS_MAX);
        out[item.key] = a.yes && details ? { yes: true, details } : { yes: a.yes };
    }
    if (sharedSpacesForced(privacyType)) {
        out.shared_spaces = { yes: true, ...(out.shared_spaces?.details ? { details: out.shared_spaces.details } : {}) };
    }
    return out;
}

export function guestSafetyProblem(safety: GuestSafety): string | null {
    for (const item of ALL_ITEMS) {
        if (item.detailsRequired && safety[item.key]?.yes && !safety[item.key]?.details) {
            return `Say where the ${item.label.toLowerCase()} is.`;
        }
    }
    return null;
}

/** The answer for an item: the alarms from the amenities, the rest from guest_safety. */
export function safetyAnswer(item: SafetyItem, safety: GuestSafety | null | undefined, amenities: string[] | null | undefined): SafetyAnswer | null {
    if (item.amenity) {
        if ((amenities || []).indexOf(item.amenity) !== -1) return { yes: true, ...(safety?.[item.key]?.details ? { details: safety![item.key].details } : {}) };
        return safety?.[item.key] && safety[item.key].yes === false ? { yes: false } : null;
    }
    return safety?.[item.key] || null;
}

/** The amenities with the two alarms switched to match the safety answers. */
export function withAlarmAmenities(amenities: string[], safety: GuestSafety): string[] {
    let out = [...(amenities || [])];
    for (const item of ALL_ITEMS) {
        if (!item.amenity) continue;
        const a = safety[item.key];
        if (!a) continue;
        out = out.filter((x) => x !== item.amenity);
        if (a.yes) out.push(item.amenity);
    }
    return out;
}

/** What the public listing shows under Safety & property: the ticked items, with details. */
export function tickedSafety(safety: GuestSafety | null | undefined, amenities: string[] | null | undefined): { key: string; label: string; details?: string }[] {
    const out: { key: string; label: string; details?: string }[] = [];
    for (const item of ALL_ITEMS) {
        if (item.amenity) continue; // the alarms have their own rows already
        const a = safetyAnswer(item, safety, amenities);
        if (a && a.yes) out.push({ key: item.key, label: item.label, ...(a.details ? { details: a.details } : {}) });
    }
    return out;
}
