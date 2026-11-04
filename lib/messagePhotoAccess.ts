import type { SupabaseClient } from '@supabase/supabase-js';
import { checkListing } from '@/lib/access';
import { isAdmin } from '@/lib/adminAudit';

// Who may send or see a photo on a booking's message thread: the guest, the
// host, a co-host holding the messages permission on that listing — and, to
// see one, an admin. Nobody else, whatever id they put in a URL. A companion
// added to the trip reads the words of the thread but not its photos.
//
// One helper for the upload route, the photo route and the thread route, so
// the three can never disagree about who is let in.

export type PhotoRole = 'guest' | 'host' | 'co_host' | 'admin';

export async function bookingPhotoRole(
    admin: SupabaseClient,
    uid: string,
    bookingId: string,
    opts: { allowAdmin: boolean },
): Promise<{ role: PhotoRole; booking: { id: string; guest_id: string; host_id: string; listing_id: string } } | null> {
    if (!uid || !bookingId) return null;
    const { data: booking } = await admin
        .from('bookings')
        .select('id, guest_id, host_id, listing_id')
        .eq('id', bookingId)
        .maybeSingle();
    if (!booking) return null;

    if (booking.guest_id === uid) return { role: 'guest', booking };
    if (booking.host_id === uid) return { role: 'host', booking };
    if (await checkListing(uid, booking.listing_id, 'can_messages')) return { role: 'co_host', booking };
    if (opts.allowAdmin && await isAdmin(uid)) return { role: 'admin', booking };
    return null;
}
