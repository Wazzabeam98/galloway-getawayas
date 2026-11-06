// Hotel availability is COUNTING, not uniqueness.
//
// A cottage is booked at most once for a set of nights — the GiST exclusion
// constraint on bookings makes "this listing, these nights" unique. A hotel room
// type has N identical rooms, so the same room type for the same nights is fine
// up to N. This module answers "are there rooms of this type free across every
// night of this stay?" by counting the hotel bookings that overlap each night
// against the room type's inventory_count.
//
// It is the hotel replacement for the single-unit clash check in the cottage
// checkout route — and it does NOT touch that constraint or that route. A hotel
// booking leaves listing_id NULL, so it never takes part in the cottage
// exclusion constraint at all.

import { dateFromKey } from '@/lib/pricing';

// pending_payment bookings created within this window still hold a room, the
// same 30-minute hold the cottage checkout uses, so two guests paying at once
// cannot both take the last room.
export const HOLD_MINUTES = 30;

export interface OverlapBooking {
    check_in: string; // 'yyyy-mm-dd'
    check_out: string;
    rooms_booked: number | null;
    status: string;
    created_at?: string | null;
}

// Every night key in [checkIn, checkOut). Half-open: the checkout morning is not
// a night.
export function nightsOf(checkInKey: string, checkOutKey: string): string[] {
    const out: string[] = [];
    let cursor = dateFromKey(checkInKey);
    const end = dateFromKey(checkOutKey);
    while (cursor.getTime() < end.getTime()) {
        out.push(keyOf(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return out;
}

function keyOf(d: Date): string {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

// The largest number of rooms of this type held on any single night of the
// requested stay by the given bookings. Pure, so it is unit-testable without a
// database. A booking holds a room on night D when check_in <= D < check_out.
export function peakRoomsHeld(
    bookings: OverlapBooking[],
    checkInKey: string,
    checkOutKey: string,
    now: Date = new Date(),
): number {
    const nights = nightsOf(checkInKey, checkOutKey);
    const held: Record<string, number> = {};
    const holdCutoff = new Date(now.getTime() - HOLD_MINUTES * 60_000);

    for (const b of bookings) {
        if (!counts(b, holdCutoff)) continue;
        const rooms = Math.max(1, Math.floor(b.rooms_booked || 1));
        for (const night of nights) {
            if (night >= b.check_in && night < b.check_out) {
                held[night] = (held[night] || 0) + rooms;
            }
        }
    }

    let peak = 0;
    for (const night of nights) peak = Math.max(peak, held[night] || 0);
    return peak;
}

// A booking counts against inventory: confirmed/pending always; pending_payment
// only while its 30-minute hold is live. cancelled/declined/completed-past never
// block a future night (completed only ever covers past nights anyway).
function counts(b: OverlapBooking, holdCutoff: Date): boolean {
    if (b.status === 'confirmed' || b.status === 'pending') return true;
    if (b.status === 'pending_payment') {
        const created = b.created_at ? new Date(b.created_at) : null;
        return !!created && created.getTime() >= holdCutoff.getTime();
    }
    return false;
}

// Rooms left on each night of a range, for the owner calendar: inventory minus
// the rooms held that night, or 0 when the room type is closed (an is_blocked
// override). `blocked` is the set of night keys the owner has closed.
export function roomsLeftByNight(
    bookings: OverlapBooking[],
    inventory: number,
    nightKeys: string[],
    blocked: Set<string>,
    now: Date = new Date(),
): Record<string, number> {
    const held: Record<string, number> = {};
    const holdCutoff = new Date(now.getTime() - HOLD_MINUTES * 60_000);
    for (const b of bookings) {
        if (!counts(b, holdCutoff)) continue;
        const rooms = Math.max(1, Math.floor(b.rooms_booked || 1));
        for (const night of nightKeys) {
            if (night >= b.check_in && night < b.check_out) held[night] = (held[night] || 0) + rooms;
        }
    }
    const out: Record<string, number> = {};
    for (const night of nightKeys) {
        out[night] = blocked.has(night) ? 0 : Math.max(0, inventory - (held[night] || 0));
    }
    return out;
}

export interface Availability {
    available: boolean;
    roomsFree: number; // free on the tightest night of the stay
    inventory: number;
    peakHeld: number;
}

// Live availability for one room type across a stay: fetch the hotel bookings
// that overlap the range and count them per night against inventory. `admin` is
// the service-role client (a co-host is not the host_id, so RLS would hide rows
// — the survey's standing warning). Pass `rooms` to check that many are free.
export async function roomsAvailable(
    admin: any,
    roomType: { id: string; inventory_count: number },
    checkInKey: string,
    checkOutKey: string,
    rooms: number = 1,
    now: Date = new Date(),
): Promise<Availability> {
    const inventory = Math.max(0, Math.floor(roomType.inventory_count || 0));

    // Overlap: a booking that starts before the stay ends and ends after it
    // starts shares at least one night. Half-open, so equal boundary dates do
    // not overlap (check_out == checkIn is the morning one leaves / the other
    // arrives).
    const { data } = await admin
        .from('bookings')
        .select('check_in, check_out, rooms_booked, status, created_at')
        .eq('room_type_id', roomType.id)
        .lt('check_in', checkOutKey)
        .gt('check_out', checkInKey);

    const peakHeld = peakRoomsHeld((data || []) as OverlapBooking[], checkInKey, checkOutKey, now);
    const roomsFree = Math.max(0, inventory - peakHeld);

    return {
        available: roomsFree >= Math.max(1, Math.floor(rooms || 1)),
        roomsFree,
        inventory,
        peakHeld,
    };
}
