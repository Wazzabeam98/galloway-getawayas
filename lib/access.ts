import { createClient } from '@supabase/supabase-js';

export type Permission =
    | 'can_calendar'
    | 'can_messages'
    | 'can_bookings'
    | 'can_listing'
    | 'can_earnings';

export interface ListingAccess {
    listingId: string;
    isOwner: boolean;
    role: 'owner' | 'co_host' | 'staff';
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
}

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

// Every listing this person can act on, and what they may do with each.
//
// An owner can do everything. A co-host can do what they were given. Staff see
// arrival and departure dates and nothing else.
//
// Some things are never delegated, whatever the permissions say: cancelling a
// confirmed booking, refunding a guest, changing payout details, deleting or
// hiding a listing, and inviting other people. Those check ownership directly
// rather than coming through here.
export async function accessibleListings(userId: string): Promise<ListingAccess[]> {
    if (!userId) return [];

    const admin = adminClient();
    const out: ListingAccess[] = [];

    const { data: owned } = await admin
        .from('listings')
        .select('id')
        .eq('host_id', userId);

    (owned || []).forEach((l: any) => {
        out.push({
            listingId: l.id,
            isOwner: true,
            role: 'owner',
            can_calendar: true,
            can_messages: true,
            can_bookings: true,
            can_listing: true,
            can_earnings: true,
        });
    });

    const { data: granted } = await admin
        .from('listing_access')
        .select('listing_id, role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('user_id', userId)
        .eq('status', 'active');

    (granted || []).forEach((a: any) => {
        // Owning it beats anything they were separately granted.
        if (out.some((o) => o.listingId === a.listing_id)) return;

        out.push({
            listingId: a.listing_id,
            isOwner: false,
            role: a.role === 'staff' ? 'staff' : 'co_host',
            can_calendar: !!a.can_calendar,
            can_messages: !!a.can_messages,
            can_bookings: !!a.can_bookings,
            can_listing: !!a.can_listing,
            can_earnings: !!a.can_earnings,
        });
    });

    return out;
}

// The listing ids this person may use for a given purpose. Handy for the many
// screens that list several properties at once.
export async function listingIdsFor(userId: string, permission: Permission): Promise<string[]> {
    const all = await accessibleListings(userId);
    return all.filter((a) => a[permission]).map((a) => a.listingId);
}

// One listing, one purpose. Returns null when they may not.
export async function checkListing(
    userId: string,
    listingId: string,
    permission: Permission
): Promise<ListingAccess | null> {
    if (!userId || !listingId) return null;

    const admin = adminClient();

    const { data: listing } = await admin
        .from('listings')
        .select('id, host_id')
        .eq('id', listingId)
        .maybeSingle();

    if (!listing) return null;

    if (listing.host_id === userId) {
        return {
            listingId: listingId,
            isOwner: true,
            role: 'owner',
            can_calendar: true,
            can_messages: true,
            can_bookings: true,
            can_listing: true,
            can_earnings: true,
        };
    }

    const { data: access } = await admin
        .from('listing_access')
        .select('role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('listing_id', listingId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

    if (!access || !access[permission]) return null;

    // Written out rather than spread, so the stored row can never overwrite
    // the values above it.
    return {
        listingId: listingId,
        isOwner: false,
        role: access.role === 'staff' ? 'staff' : 'co_host',
        can_calendar: !!access.can_calendar,
        can_messages: !!access.can_messages,
        can_bookings: !!access.can_bookings,
        can_listing: !!access.can_listing,
        can_earnings: !!access.can_earnings,
    };
}

// Ownership, for the things that are never delegated.
export async function ownsListing(userId: string, listingId: string): Promise<boolean> {
    if (!userId || !listingId) return false;

    const admin = adminClient();

    const { data } = await admin
        .from('listings')
        .select('host_id')
        .eq('id', listingId)
        .maybeSingle();

    return !!data && data.host_id === userId;
}
