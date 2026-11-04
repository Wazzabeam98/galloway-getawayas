import { adminClient } from '@/lib/supabaseAdmin';
import type { Permission } from '@/lib/access';

// Who may act on a hotel, and what they may do. A clone of lib/access.ts for the
// hotel vertical — the same five permissions, the same owner / full-access /
// staff shape — exactly as lib/providerAccess.ts cloned it for the services
// vertical. The DB mirror is has_hotel_permission(hotel, perm) (see the phase-one
// migration), wired into every hotel row policy; keep the two in step.
//
// Phase one has no co-host UI, so in practice every caller is the owner. The
// hotel_access table and this file's co-host branches exist so the structure is
// ready, and so has_hotel_permission and checkHotel answer identically.

export type HotelPermission = Permission;

export interface HotelAccess {
    hotelId: string;
    accessId: string | null; // the hotel_access row, or null for an owner
    isOwner: boolean;
    role: 'owner' | 'co_host' | 'staff';
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
}

function ownerRow(hotelId: string): HotelAccess {
    return {
        hotelId,
        accessId: null,
        isOwner: true,
        role: 'owner',
        can_calendar: true,
        can_messages: true,
        can_bookings: true,
        can_listing: true,
        can_earnings: true,
    };
}

// One hotel, one purpose. Returns null when they may not. Mirrors checkListing.
export async function checkHotel(
    userId: string,
    hotelId: string,
    permission: HotelPermission,
): Promise<HotelAccess | null> {
    if (!userId || !hotelId) return null;

    const admin = adminClient();

    const { data: hotel } = await admin
        .from('hotels')
        .select('id, owner_id')
        .eq('id', hotelId)
        .maybeSingle();

    if (!hotel) return null;
    if (hotel.owner_id === userId) return ownerRow(hotelId);

    const { data: access } = await admin
        .from('hotel_access')
        .select('id, role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('hotel_id', hotelId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

    if (!access || !access[permission]) return null;

    return {
        hotelId,
        accessId: access.id,
        isOwner: false,
        role: access.role === 'staff' ? 'staff' : 'co_host',
        can_calendar: !!access.can_calendar,
        can_messages: !!access.can_messages,
        can_bookings: !!access.can_bookings,
        can_listing: !!access.can_listing,
        can_earnings: !!access.can_earnings,
    };
}

// Ownership, for the three things an owner never hands over (payout details,
// deleting the hotel, the primary-owner seat). Mirrors ownsListing.
export async function ownsHotel(userId: string, hotelId: string): Promise<boolean> {
    if (!userId || !hotelId) return false;
    const admin = adminClient();
    const { data } = await admin
        .from('hotels')
        .select('owner_id')
        .eq('id', hotelId)
        .maybeSingle();
    return !!data && data.owner_id === userId;
}

// A full-access co-host — every permission ticked — is the owner's equal except
// the three the owner keeps. An owner is trivially full access. Mirrors
// isFullAccess.
export function isFullAccess(a: HotelAccess): boolean {
    return (
        a.isOwner ||
        (a.can_calendar && a.can_messages && a.can_bookings && a.can_listing && a.can_earnings)
    );
}

// The access row for one hotel with no particular permission required — the
// owner, or any active grant — or null. Mirrors listingAccessFor.
export async function hotelAccessFor(userId: string, hotelId: string): Promise<HotelAccess | null> {
    if (!userId || !hotelId) return null;
    const admin = adminClient();

    const { data: hotel } = await admin
        .from('hotels')
        .select('id, owner_id')
        .eq('id', hotelId)
        .maybeSingle();
    if (!hotel) return null;
    if (hotel.owner_id === userId) return ownerRow(hotelId);

    const { data: access } = await admin
        .from('hotel_access')
        .select('id, role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('hotel_id', hotelId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
    if (!access) return null;

    return {
        hotelId,
        accessId: access.id,
        isOwner: false,
        role: access.role === 'staff' ? 'staff' : 'co_host',
        can_calendar: !!access.can_calendar,
        can_messages: !!access.can_messages,
        can_bookings: !!access.can_bookings,
        can_listing: !!access.can_listing,
        can_earnings: !!access.can_earnings,
    };
}

// Owner-equivalent for one hotel: the owner, or a full-access co-host. Mirrors
// ownerOrFullAccess.
export async function ownerOrFullAccess(userId: string, hotelId: string): Promise<HotelAccess | null> {
    const a = await hotelAccessFor(userId, hotelId);
    return a && isFullAccess(a) ? a : null;
}
