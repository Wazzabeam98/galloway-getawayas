import { isArchived } from '@/lib/conversations';
import { listingIdsFor } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';

// The two numbers behind the dot on the menu.
//
// These were the bodies of /api/messages/unread-count and
// /api/bookings/pending-count. They are here because /api/badges answers both
// in one request, and two copies of the archived-conversation rule is two
// places for it to drift — that rule is the only real logic in either route
// and it had no test, because it lived in a route handler.

/**
 * Unread messages addressed to this person, not counting conversations they
 * have archived.
 *
 * The common case costs exactly one counting query: almost nobody has
 * anything archived, and the extra work only happens when they do.
 */
export async function unreadFor(supabase: any, uid: string): Promise<number> {
    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .is('read_at', null);

    const total = count || 0;
    if (total === 0) return 0;

    const { data: archivedPrefs } = await supabase
        .from('conversation_prefs')
        .select('booking_id, archived_at')
        .eq('user_id', uid)
        .not('archived_at', 'is', null);

    if (!archivedPrefs || archivedPrefs.length === 0) return total;

    const archivedIds = archivedPrefs.map((p: any) => p.booking_id);

    // Every message addressed to this person in those conversations, read ones
    // included. A read message that arrived after they archived it has already
    // brought the conversation back, and once it is back its older unread
    // messages have to be counted again too.
    const { data: inbound } = await supabase
        .from('messages')
        .select('booking_id, created_at, read_at')
        .eq('recipient_id', uid)
        .in('booking_id', archivedIds);

    const lastInbound: Record<string, string> = {};
    const unreadPer: Record<string, number> = {};

    (inbound || []).forEach((m: any) => {
        if (!lastInbound[m.booking_id] || m.created_at > lastInbound[m.booking_id]) {
            lastInbound[m.booking_id] = m.created_at;
        }
        if (!m.read_at) {
            unreadPer[m.booking_id] = (unreadPer[m.booking_id] || 0) + 1;
        }
    });

    let hidden = 0;
    archivedPrefs.forEach((p: any) => {
        if (isArchived(p.archived_at, lastInbound[p.booking_id])) {
            hidden += unreadPer[p.booking_id] || 0;
        }
    });

    return Math.max(0, total - hidden);
}

/**
 * Booking requests waiting for this person to answer.
 *
 * Counted with the service key against the listings they may handle bookings
 * for: a co-host is not the host_id on a booking row, so asking as them
 * returns nothing and the badge would quietly never appear.
 */
export async function pendingFor(uid: string): Promise<number> {
    const allowed = await listingIdsFor(uid, 'can_bookings');
    if (allowed.length === 0) return 0;

    // 'pending' only. 'pending_payment' is a guest part-way through checkout
    // with nothing for the host to do, and badging it would have a host
    // opening the page to find an empty list.
    const { count } = await adminClient()
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('listing_id', allowed)
        .eq('status', 'pending');

    return count || 0;
}
