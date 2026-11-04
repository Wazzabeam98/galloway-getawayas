import type { SupabaseClient } from '@supabase/supabase-js';
import { checkListing } from '@/lib/access';
import { isAdmin } from '@/lib/adminAudit';
import { orderThreadContext } from '@/lib/orderThreads';
import { enquiryThreadContext } from '@/lib/enquiryThreads';

// Who may send or see a photo in a conversation — exactly the people in that
// conversation, and, to see one, an admin. Nobody else, whatever id they put in
// a URL. Each kind of thread uses the gate its own message routes already use:
//   booking — the guest, the host, a co-host with messages on that listing
//             (a companion on the trip reads the words but not the photos)
//   order   — the guest, and the business owner or its co-hosts with messages
//             (orderThreadContext)
//   enquiry — the host who asked, and the trade owner or its co-hosts with
//             messages (enquiryThreadContext)
//
// One helper for the upload routes, the photo route and the thread routes, so
// they can never disagree about who is let in.

export type ThreadKind = 'booking' | 'order' | 'enquiry';
export type PhotoRole = 'guest' | 'host' | 'co_host' | 'provider' | 'admin';

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

/** May this person see the photos in this conversation? */
export async function mayViewThreadPhotos(admin: SupabaseClient, uid: string, kind: ThreadKind, threadId: string): Promise<boolean> {
    if (!uid || !threadId) return false;
    if (kind === 'booking') return !!(await bookingPhotoRole(admin, uid, threadId, { allowAdmin: true }));
    const inThread = kind === 'order'
        ? !!(await orderThreadContext(admin, threadId, uid))
        : !!(await enquiryThreadContext(admin, threadId, uid));
    return inThread || await isAdmin(uid);
}

/** Which conversation a stored photo belongs to. */
export function threadOfAttachment(att: { booking_id?: string | null; order_id?: string | null; enquiry_id?: string | null }): { kind: ThreadKind; id: string } | null {
    if (att.booking_id) return { kind: 'booking', id: att.booking_id };
    if (att.order_id) return { kind: 'order', id: att.order_id };
    if (att.enquiry_id) return { kind: 'enquiry', id: att.enquiry_id };
    return null;
}
