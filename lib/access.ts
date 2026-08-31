import { adminClient } from '@/lib/supabaseAdmin';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

export type Permission =
    | 'can_calendar'
    | 'can_messages'
    | 'can_bookings'
    | 'can_listing'
    | 'can_earnings';

export interface ListingAccess {
    listingId: string;
    // The listing_access row, when they got in through one. Null for an owner.
    accessId: string | null;
    isOwner: boolean;
    role: 'owner' | 'co_host' | 'staff';
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
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
            accessId: null,
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
        .select('id, listing_id, role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('user_id', userId)
        .eq('status', 'active');

    (granted || []).forEach((a: any) => {
        // Owning it beats anything they were separately granted.
        if (out.some((o) => o.listingId === a.listing_id)) return;

        out.push({
            listingId: a.listing_id,
            accessId: a.id,
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

    const { data: access } = await admin
        .from('listing_access')
        .select('id, role, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('listing_id', listingId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

    if (!access || !access[permission]) return null;

    // Written out rather than spread, so the stored row can never overwrite
    // the values above it.
    return {
        listingId: listingId,
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


// ---------------------------------------------------------------------------
// WHO MAY OPEN THE OWNER PAGES
// ---------------------------------------------------------------------------

/**
 * The signed-in admin, or a 404.
 *
 * This was written out nine times — once per page under /admin — byte for byte
 * identical apart from whether the variable was called `data` or `auth`. Every
 * copy was correct. Nothing made the tenth correct, and the tenth is the one
 * somebody writes at half past eleven by pasting the ninth and changing the
 * query underneath it.
 *
 * THREE THINGS IT DOES THAT ARE EASY TO GET WRONG SEPARATELY.
 *
 * getUser(), never getSession(). getSession() only decodes the auth cookie and
 * never checks its signature, so the id everything hangs off would be whatever
 * the caller wrote in it. getUser() asks the auth server, which verifies the
 * token and that the session has not been revoked.
 *
 * notFound(), not a redirect and not a 403. A 403 confirms /admin exists and
 * is worth attacking; a 404 says nothing. A stranger and a signed-in
 * non-admin get the same page a typo gets.
 *
 * FAIL CLOSED. `!profile || profile.is_admin !== true` — a missing row, a
 * failed read and a null all refuse. `!profile.is_admin` would do the same
 * here, but `is_admin !== true` also refuses a truthy non-true value, which is
 * the shape a column type change or a string 'false' would produce.
 *
 * Returns the user, because most of these pages need the id afterwards.
 */
export async function requireAdmin() {
    const supabase = createServerComponentClient({ cookies });

    const { data } = await supabase.auth.getUser();
    if (!data || !data.user) notFound();

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', data.user.id)
        .maybeSingle();

    if (!profile || profile.is_admin !== true) notFound();

    return data.user;
}
