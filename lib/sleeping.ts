// Per-room sleeping arrangements — the beds in each room, the way Airbnb's
// "Where you'll sleep" shows them. Stored in listings.sleeping_arrangements
// (jsonb). The flat `beds` and `bedrooms` integers are DERIVED from this
// (deriveCounts) so the listing cards, search and schema.org keep reading the
// same two numbers they always have — the host enters beds room by room, and
// the totals stay in sync rather than being typed a second time.
//
// Framework-free on purpose: the editor (client) and the listing page (server)
// both import it, so the one definition of "what a king bed is called" and
// "how many beds that adds up to" is shared.

export type Bed = { type: string; count: number };
export type RoomKind = 'bedroom' | 'common';
// `photo` is one of the listing's own image paths, chosen by the host for this
// room (Airbnb's "Where you'll sleep" shows a photo of each room). Null/absent
// falls back to the bed icon.
export type Room = { label: string; kind: RoomKind; beds: Bed[]; photo?: string | null };

// The bed types a host can pick, in the order they're offered — Airbnb's
// bed-type counters, UK wording. The stored `type` is this exact string, so
// never rename one that is live.
export const BED_TYPES: string[] = [
    'Single bed',
    'Double bed',
    'Small double bed',
    'King bed',
    'Bunk bed',
    'Sofa bed',
    'Sofa',
    'Floor mattress',
    'Air mattress',
    'Cot',
    'Toddler bed',
    'Hammock',
];

// A sofa bed or a floor mattress is still a bed to sleep in, so it counts toward
// the total the same as any other — this is just the whole list, named so the
// intent is obvious at the call sites.
export function isBedType(type: string): boolean {
    return BED_TYPES.indexOf(type) !== -1;
}

// "1 king bed", "2 single beds", "2 floor mattresses" — the label for one bed line.
export function bedLabel(bed: Bed): string {
    const one = bed.type.toLowerCase();
    const noun = bed.count === 1 ? one : one + (/(s|sh|ch|x)$/.test(one) ? 'es' : 's');
    return `${bed.count} ${noun}`;
}

// "1 king bed · 1 single bed" — the one-line summary under a room's name.
export function bedSummary(beds: Bed[]): string {
    const real = (beds || []).filter((b) => b && b.count > 0);
    if (real.length === 0) return 'No beds added yet';
    return real.map(bedLabel).join(' · ');
}

// Total beds across every room, and how many of the rooms are bedrooms. These
// are the two integers written back to listings.beds / listings.bedrooms, so a
// host never types them — the rooms below are the single source.
export function deriveCounts(rooms: Room[]): { bedrooms: number; beds: number } {
    let bedrooms = 0;
    let beds = 0;
    for (const room of rooms || []) {
        if (room.kind === 'bedroom') bedrooms += 1;
        for (const bed of room.beds || []) {
            if (bed && typeof bed.count === 'number' && bed.count > 0) beds += bed.count;
        }
    }
    return { bedrooms, beds };
}

// jsonb comes back as `any`; this is the one gate that turns it into Room[] we
// can trust — a bad shape (an old row, a hand-edit) becomes an empty list rather
// than throwing on the page.
export function normaliseArrangements(raw: any): Room[] {
    if (!Array.isArray(raw)) return [];
    const out: Room[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const kind: RoomKind = r.kind === 'common' ? 'common' : 'bedroom';
        const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : '';
        const beds: Bed[] = Array.isArray(r.beds)
            ? r.beds
                  .filter((b: any) => b && typeof b.type === 'string' && typeof b.count === 'number' && b.count > 0)
                  .map((b: any) => ({ type: b.type, count: Math.min(16, Math.max(1, Math.floor(b.count))) }))
            : [];
        const photo = typeof r.photo === 'string' && r.photo.trim() ? r.photo : null;
        out.push({ label, kind, beds, photo });
    }
    return out;
}

// A sensible starting point when a listing has no arrangements yet: one card per
// bedroom it already claims, each empty, so the host fills the beds in rather
// than rebuilding the room list. Common spaces (a sofa bed in the living room)
// are added by hand — most places don't have one.
export function roomsFromBedroomCount(bedrooms: number): Room[] {
    const n = Math.max(0, Math.min(20, Math.floor(bedrooms || 0)));
    const rooms: Room[] = [];
    for (let i = 0; i < n; i += 1) {
        rooms.push({ label: `Bedroom ${i + 1}`, kind: 'bedroom', beds: [] });
    }
    return rooms;
}

// What the editor writes to the listing when the host saves the rooms: the
// cleaned room list (beds with a zero count dropped; a common space with no
// beds dropped, but a bedroom with no beds kept) and the bedroom count derived
// from it. Whatever the host leaves is stored as-is — removing the last bed,
// emptying a room, or a studio with no bedrooms all persist.
//
// This is the one place that guarantees an emptied layout survives a save. A
// guard here once wrote the listing's PREVIOUS arrangements (and old bedroom
// count) back whenever no beds were left, so a host who removed the last bed
// saw it save and then watched the old layout reappear on reload — the empty
// arrangements never reached the row, and an unchanged bedroom count made
// roomsFromBedroomCount rebuild the rooms. The host's answer is the one to keep.
export function sleepingPatch(rooms: Room[]): { rooms: Room[]; bedrooms: number } {
    const clean = (rooms || [])
        .map((r) => ({ ...r, beds: (r.beds || []).filter((b) => b && b.count > 0) }))
        .filter((r) => r.kind === 'bedroom' || r.beds.length > 0);
    return { rooms: clean, bedrooms: deriveCounts(clean).bedrooms };
}

// The display label for a room — its own name if it has one, else a numbered
// fallback so a blank never reaches the page.
export function roomLabel(room: Room, indexAmongBedrooms: number): string {
    if (room.label) return room.label;
    return room.kind === 'common' ? 'Common space' : `Bedroom ${indexAmongBedrooms}`;
}

// How many of the listing's beds are still to be placed in a room. The total
// (listings.beds) is the cap: a 3-bed listing places exactly 3 across its rooms
// and every + greys out once they're all down.
export function bedsLeftToPlace(totalBeds: number, rooms: Room[]): number {
    return Math.max(0, Math.floor(totalBeds || 0) - deriveCounts(rooms).beds);
}
