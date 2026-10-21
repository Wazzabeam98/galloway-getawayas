import { isArchived } from '@/lib/conversations';
import { TEAM_READS_FROM, isInboundFor, isUnreadFor, readPositionsFor, threadKey } from '@/lib/threadReads';
import { listingIdsFor } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { providerIdsWith } from '@/lib/providerAccess';
import { londonDayKey } from '@/lib/dayKey';

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

    // Archived conversations of ANY kind stay out of the dot, the same way they
    // stay out of the inbox. conversation_prefs now covers orders and enquiries
    // as well as bookings (thread_kind, thread_id), so an archived order or
    // enquiry hides its unread here too — before this the dot kept counting it
    // while the list had already dropped it.
    const { data: archivedPrefs } = await supabase
        .from('conversation_prefs')
        .select('thread_kind, thread_id, archived_at')
        .eq('user_id', uid)
        .not('archived_at', 'is', null);

    if (!archivedPrefs || archivedPrefs.length === 0) return total;

    const idsByKind: Record<string, string[]> = { booking: [], order: [], enquiry: [] };
    const archivedAt: Record<string, string> = {};
    archivedPrefs.forEach((p: any) => {
        if (!p.thread_kind || !p.thread_id || !idsByKind[p.thread_kind]) return;
        idsByKind[p.thread_kind].push(p.thread_id);
        archivedAt[threadKey(p.thread_kind, p.thread_id)] = p.archived_at;
    });

    // Every message addressed to this person in those conversations, read ones
    // included. A read message that arrived after they archived it has already
    // brought the conversation back, and once it is back its older unread
    // messages have to be counted again too. Queried per kind, since each hangs
    // off its own id column on messages.
    const lastInbound: Record<string, string> = {};
    const unreadPer: Record<string, number> = {};

    for (const kind of ['booking', 'order', 'enquiry'] as const) {
        const ids = idsByKind[kind];
        if (!ids.length) continue;
        const col = kind + '_id';
        const { data: inbound } = await supabase
            .from('messages')
            .select(col + ', created_at, read_at')
            .eq('recipient_id', uid)
            .neq('sender_id', uid)
            .in(col, ids);
        (inbound || []).forEach((m: any) => {
            const key = threadKey(kind, m[col]);
            if (!lastInbound[key] || m.created_at > lastInbound[key]) lastInbound[key] = m.created_at;
            if (!m.read_at) unreadPer[key] = (unreadPer[key] || 0) + 1;
        });
    }

    let hidden = 0;
    Object.keys(archivedAt).forEach((key) => {
        if (isArchived(archivedAt[key], lastInbound[key])) hidden += unreadPer[key] || 0;
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

    // Per thread (keyed 'booking:<id>' / 'order:<id>' / 'enquiry:<id>'), so the
    // archived rule below can drop a whole thread of any kind — as the inbox
    // does — rather than bookings alone.
    const unreadPer: Record<string, number> = {};
    const inboundAt: Record<string, string> = {};

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
            const key = threadKey(kind, m[col]);
            if (isInboundFor(m, uid, true)
                && (!inboundAt[key] || m.created_at > inboundAt[key])) inboundAt[key] = m.created_at;
            if (!isUnreadFor(m, uid, true, readTo[key])) return;
            unreadPer[key] = (unreadPer[key] || 0) + 1;
        });
    }

    const unreadKeys = Object.keys(unreadPer);
    if (!unreadKeys.length) return 0;

    // Something archived stays out of the dot, as in unreadFor and the inbox —
    // for every kind, now that conversation_prefs covers orders and enquiries.
    const { data: prefs } = await admin
        .from('conversation_prefs')
        .select('thread_kind, thread_id, archived_at')
        .eq('user_id', uid)
        .not('archived_at', 'is', null);
    const archivedAt: Record<string, string> = {};
    (prefs || []).forEach((p: any) => {
        if (p.thread_kind && p.thread_id) archivedAt[threadKey(p.thread_kind, p.thread_id)] = p.archived_at;
    });

    let total = 0;
    unreadKeys.forEach((key) => {
        if (!isArchived(archivedAt[key], inboundAt[key])) total += unreadPer[key];
    });

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
 * Work waiting on a provider to answer — the provider mirror of pendingFor.
 *
 * A TRADE: enquiries still to answer ('sent' / 'viewed'), on its "Enquiries"
 * menu line. A GUEST EXPERIENCE: booking requests still to confirm or decline —
 * orders 'authorised' (the guest's card held, waiting on the provider) dated
 * today or later, the same "Needs a reply" figure its Reservations page shows
 * (lib/providerReservations summary.needsReply). Either way it is the number
 * on the provider's Reservations/Enquiries line and lights the menu dot, the
 * way a host's pending booking requests do.
 *
 * 'holding' is not counted: that is a guest part-way through paying, with
 * nothing for the provider to do — the reason a host's badge leaves out
 * 'pending_payment'.
 *
 * Counted with the service key, across every business this account owns or
 * co-hosts with the bookings permission (lib/providerAccess).
 */
export async function providerRequestsFor(uid: string): Promise<number> {
    const admin = adminClient();
    const usable = await providerIdsWith(admin, uid, 'can_bookings');
    const { data: providers } = usable.length
        ? await admin.from('service_providers').select('id, audience').in('id', usable)
        : { data: [] as any[] };
    const trades = (providers || []).filter((p: any) => p.audience === 'host').map((p: any) => p.id);
    const experiences = (providers || []).filter((p: any) => p.audience === 'guest').map((p: any) => p.id);
    if (trades.length === 0 && experiences.length === 0) return 0;

    const [enquiries, requests] = await Promise.all([
        trades.length
            ? admin.from('service_enquiries').select('id', { count: 'exact', head: true })
                .in('provider_id', trades).in('status', ['sent', 'viewed'])
            : Promise.resolve({ count: 0 } as any),
        experiences.length
            ? admin.from('service_orders').select('id', { count: 'exact', head: true })
                .in('provider_id', experiences).eq('status', 'authorised')
                .is('parent_order_id', null).gte('service_date', londonDayKey())
            : Promise.resolve({ count: 0 } as any),
    ]);

    return ((enquiries && enquiries.count) || 0) + ((requests && requests.count) || 0);
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
