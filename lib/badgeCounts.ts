import { isArchived } from '@/lib/conversations';
import { TEAM_READS_FROM, isInboundFor, isUnreadFor, readPositionsFor, threadKey } from '@/lib/threadReads';
import { listingIdsFor } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { providerIdsWith } from '@/lib/providerAccess';

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
    // ALL THREE KINDS. Until the unified-inbox pass (2 September 2026) this
    // counted booking threads only, because the Messages page could not open the
    // enquiry or order kinds — a badge pointing at a thread the page can't show is
    // worse than no badge. The Messages page (guests + hosts) now carries booking
    // threads, the host's job threads and the guest's order threads, and the
    // provider's /services/messages carries their enquiry and order threads. So
    // every unread message addressed to this person is now openable somewhere they
    // can reach, and the count is simply all of it.
    // Never their own words, even when addressed to themselves: on a stay an
    // owner booked at their own place, guest and host are one account and their
    // message to "the guest" is addressed to them (20/10/2026). lib/threadReads.
    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .neq('sender_id', uid)
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
        .neq('sender_id', uid)
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
 * Unread messages on the threads this person answers as part of a team — the
 * owner or a co-host of a property, or of a business — that were not addressed
 * to them: the guest's question to the owner, as a co-host sees it; the owner's
 * reply, as the co-host sees it; a co-host's reply, as the owner sees it.
 * unreadFor() counts what was addressed to them; this counts the rest, by the
 * same rule the inbox uses (lib/threadReads), so the dot and the list agree.
 *
 * Service key: a co-host is neither party on these rows.
 */
export async function teamUnreadFor(uid: string, admin: any = adminClient()): Promise<number> {
    const [listings, providers, readTo] = await Promise.all([
        listingIdsFor(uid, 'can_messages'),
        providerIdsWith(admin, uid, 'can_messages'),
        readPositionsFor(admin, uid),
    ]);

    // [kind, thread id] for every thread they answer on the team side.
    const threads: { kind: 'booking' | 'order' | 'enquiry'; id: string }[] = [];

    if (listings.length) {
        const { data: bookings } = await admin
            .from('bookings')
            .select('id, guest_id, host_id')
            .in('listing_id', listings);
        // A co-host who is also the guest on a stay is the guest there.
        (bookings || []).forEach((b: any) => {
            if (b.host_id === uid || b.guest_id !== uid) threads.push({ kind: 'booking', id: b.id });
        });
    }
    if (providers.length) {
        const [{ data: orders }, { data: enquiries }] = await Promise.all([
            admin.from('service_orders').select('id').in('provider_id', providers)
                .is('parent_order_id', null).in('status', ['authorised', 'confirmed']),
            admin.from('service_enquiries').select('id').in('provider_id', providers)
                .in('status', ['accepted', 'cancelled']),
        ]);
        (orders || []).forEach((o: any) => threads.push({ kind: 'order', id: o.id }));
        (enquiries || []).forEach((e: any) => threads.push({ kind: 'enquiry', id: e.id }));
    }
    if (threads.length === 0) return 0;

    let total = 0;
    const bookingUnread: Record<string, number> = {};
    const bookingInbound: Record<string, string> = {};

    for (const kind of ['booking', 'order', 'enquiry'] as const) {
        const ids = threads.filter((t) => t.kind === kind).map((t) => t.id);
        if (!ids.length) continue;
        const col = kind + '_id';
        // Only what is NOT addressed to them (unreadFor has those) and is newer
        // than anyone's read position could be.
        const { data: msgs } = await admin
            .from('messages')
            .select(col + ', sender_id, recipient_id, read_at, created_at, automated')
            .in(col, ids)
            .neq('sender_id', uid)
            .neq('recipient_id', uid)
            .gt('created_at', TEAM_READS_FROM);
        (msgs || []).forEach((m: any) => {
            const id = m[col];
            if (kind === 'booking' && isInboundFor(m, uid, true)
                && (!bookingInbound[id] || m.created_at > bookingInbound[id])) bookingInbound[id] = m.created_at;
            if (!isUnreadFor(m, uid, true, readTo[threadKey(kind, id)])) return;
            if (kind === 'booking') bookingUnread[id] = (bookingUnread[id] || 0) + 1;
            else total += 1;
        });
    }

    // Something archived stays out of the dot, as in unreadFor.
    const unreadBookings = Object.keys(bookingUnread);
    if (unreadBookings.length) {
        const { data: prefs } = await admin
            .from('conversation_prefs')
            .select('booking_id, archived_at')
            .eq('user_id', uid)
            .in('booking_id', unreadBookings)
            .not('archived_at', 'is', null);
        const archivedAt: Record<string, string> = {};
        (prefs || []).forEach((p: any) => { archivedAt[p.booking_id] = p.archived_at; });
        unreadBookings.forEach((id) => {
            if (!isArchived(archivedAt[id], bookingInbound[id])) total += bookingUnread[id];
        });
    }

    return total;
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

/**
 * Requests waiting on a trade to answer — the provider mirror of pendingFor.
 *
 * A trade's "Requests" menu line badges the same way a host's "Your reservations"
 * does: the number of enquiries still to answer across every business this
 * account owns. Guest-experience providers confirm orders, not enquiries, so
 * this is nought for them and their menu carries no badge here.
 *
 * Counted with the service key: an enquiry belongs to a provider row this user
 * owns, and 'sent' / 'viewed' are the two states still awaiting the trade.
 */
export async function providerRequestsFor(uid: string): Promise<number> {
    const admin = adminClient();
    // Owned, or co-hosted with bookings (lib/providerAccess) — trades only.
    const usable = await providerIdsWith(admin, uid, 'can_bookings');
    const { data: providers } = usable.length
        ? await admin.from('service_providers').select('id').in('id', usable).eq('audience', 'host')
        : { data: [] as any[] };
    const ids = (providers || []).map((p: any) => p.id);
    if (ids.length === 0) return 0;

    const { count } = await admin
        .from('service_enquiries')
        .select('id', { count: 'exact', head: true })
        .in('provider_id', ids)
        .in('status', ['sent', 'viewed']);

    return count || 0;
}

export interface AdminPending {
    // Holiday-let listings waiting for approval (reviewed on /admin/listings).
    holidayLets: number;
    // Guest experiences waiting for review (on /admin/providers#experiences).
    experiences: number;
    // Trades waiting for review (on /admin/providers#trades).
    trades: number;
}

export const EMPTY_ADMIN_PENDING: AdminPending = { holidayLets: 0, experiences: 0, trades: 0 };

/**
 * The three "waiting on the admin" numbers behind the green dot and the
 * owner-tools counts, split so each one can point at the page and section that
 * clears it.
 *
 * Only an admin gets real numbers; everyone else gets zeros without any count
 * query running, so this costs a signed-in non-admin a single indexed lookup on
 * their own profile row. Counted with the service key: a pending listing or
 * provider is invisible to a normal caller under RLS, which is the whole point.
 *
 * These are "waiting for review" only — rows the admin must act on — so they
 * drop to zero as each is approved or declined, with no clear step. Unclaimed
 * applications (waiting on the APPLICANT, not the admin) are deliberately not
 * counted here: they are not the admin's move.
 */
export async function adminPendingFor(uid: string): Promise<AdminPending> {
    const admin = adminClient();

    const { data: profile } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', uid)
        .maybeSingle();

    if (!profile || profile.is_admin !== true) return { ...EMPTY_ADMIN_PENDING };

    // In parallel: three head counts on different tables.
    const [lets, experiences, trades] = await Promise.all([
        admin
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending_review'),
        admin
            .from('service_providers')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending_review')
            .eq('audience', 'guest'),
        admin
            .from('service_providers')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending_review')
            .in('audience', ['host', 'both']),
    ]);

    return {
        holidayLets: Number(lets.count || 0),
        experiences: Number(experiences.count || 0),
        trades: Number(trades.count || 0),
    };
}
