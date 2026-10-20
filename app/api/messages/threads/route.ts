import { isArchived, needsReply } from '@/lib/conversations';
import { londonDayKey } from '@/lib/dayKey';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { listingIdsFor } from '@/lib/access';
import { renderSecretTokens } from '@/lib/messageSecrets';
import { firstName, getImageUrl } from '@/lib/utils';
import { bookingStatusLine, categoryOf, enquiryStatusLine, orderStatusLine } from '@/lib/conversationLabels';
import { providerIdsWith } from '@/lib/providerAccess';
import { isInboundFor, isUnreadFor, readPositionsFor, threadKey } from '@/lib/threadReads';

export const dynamic = 'force-dynamic';

// Conversations this person can see: their own trips, bookings at properties
// they own, and bookings at properties they co-host with permission to handle
// messages.
//
// Done on the server because a co-host is neither the guest nor the host on
// those rows, so row-level security would hide them.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ conversations: [] });
    }

    const uid = user.id;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const messageListings = await listingIdsFor(uid, 'can_messages');

    // How far they have read each thread they answer as part of a team — the
    // owner or a co-host. See lib/threadReads.
    const readTo = await readPositionsFor(admin, uid);

    // Their own bookings, as guest or host.
    const { data: own } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out, created_at, status')
        .or('guest_id.eq.' + uid + ',host_id.eq.' + uid);

    // Trips someone has added them to.
    const { data: companionRows } = await admin
        .from('booking_guests')
        .select('booking_id')
        .eq('user_id', uid)
        .eq('status', 'active');

    const companionIds = (companionRows || []).map((r: any) => r.booking_id);

    const { data: companionBookings } = companionIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, created_at, status')
            .in('id', companionIds)
        : { data: [] };

    // Bookings at properties they help with.
    const { data: helping } = messageListings.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, created_at, status')
            .in('listing_id', messageListings)
        : { data: [] };

    const seen: Record<string, boolean> = {};
    const bookings: any[] = [];

    (own || []).concat(companionBookings || []).concat(helping || []).forEach((b: any) => {
        if (seen[b.id]) return;
        seen[b.id] = true;
        bookings.push(b);
    });

    bookings.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    // No early return on empty bookings any more: this inbox now also carries
    // the guest's experience-order threads and the host's job (enquiry) threads,
    // and someone can have those without a booking of their own.

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title, images, host_id').in('id', listingIds)
        : { data: [] };

    const listingMap: Record<string, any> = {};
    (listings || []).forEach((l: any) => {
        listingMap[l.id] = l;
    });

    // The co-hosts who answer messages on each property, for the stacked
    // photos on a row (Airbnb shows the co-host's face beside the guest's).
    const { data: listingTeam } = listingIds.length
        ? await admin
            .from('listing_access')
            .select('listing_id, user_id')
            .in('listing_id', listingIds)
            .eq('status', 'active')
            .eq('role', 'co_host')
            .eq('can_messages', true)
        : { data: [] };
    const coHostsOf: Record<string, string[]> = {};
    (listingTeam || []).forEach((a: any) => {
        if (!a.user_id) return;
        (coHostsOf[a.listing_id] = coHostsOf[a.listing_id] || []).push(a.user_id);
    });

    // Whether they answer this booking as the host's side: the owner, or a
    // co-host with messages. Checked before "are they the guest", because an
    // owner can book their own place (a test stay) and is then both.
    const onTeam = (b: any) =>
        b.host_id === uid || (b.guest_id !== uid && messageListings.indexOf(b.listing_id) !== -1);

    // On the host's side the person they're talking to is the guest; on the
    // guest's side, the host.
    const otherOf = (b: any) => (onTeam(b) ? b.guest_id : b.host_id);

    const otherIds = Array.from(new Set(bookings.map(otherOf)));

    const { data: profiles } = otherIds.length
        ? await admin.from('profiles').select('id, full_name, first_name, last_name, preferred_name, show_full_name').in('id', otherIds)
        : { data: [] };

    const nameMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => {
        nameMap[p.id] = firstName(p, 'Guest');
    });

    // Everyone whose face or name a row may show — filled in as the rows are
    // built, read in one go at the end (see `people` below).
    const personIds = new Set<string>();

    const { data: lastMessages } = bookings.length
        ? await admin
            .from('messages')
            .select('booking_id, body, created_at, sender_id, recipient_id, read_at, automated')
            .in('booking_id', bookings.map((b) => b.id))
            .order('created_at', { ascending: false })
        : { data: [] };

    const lastMap: Record<string, any> = {};
    const unreadMap: Record<string, number> = {};
    // The newest message addressed to this person, read or unread. Only used
    // to decide whether something they archived has been brought back.
    const lastInboundMap: Record<string, string> = {};

    const teamOn: Record<string, boolean> = {};
    bookings.forEach((b) => { teamOn[b.id] = onTeam(b); });

    (lastMessages || []).forEach((m: any) => {
        // A check-in message's placeholders never become values in a preview.
        if (!lastMap[m.booking_id]) {
            const { automated, ...rest } = m;
            lastMap[m.booking_id] = { ...rest, body: renderSecretTokens(m.body, automated, 'preview') };
        }

        const team = teamOn[m.booking_id];
        if (isInboundFor(m, uid, team) && !lastInboundMap[m.booking_id]) {
            // Already sorted newest first, so the first one seen is the newest.
            lastInboundMap[m.booking_id] = m.created_at;
        }

        // Sent to them and not opened, or — on the team side — newer than how
        // far they have read. Something they sent themselves never is, even on
        // a stay they booked at their own place. See lib/threadReads.
        if (isUnreadFor(m, uid, team, readTo[threadKey('booking', m.booking_id)])) {
            unreadMap[m.booking_id] = (unreadMap[m.booking_id] || 0) + 1;
        }
    });

    // Starring and archiving are this person's own, not the conversation's.
    // A host archiving a thread leaves the guest's copy exactly where it was.
    const { data: prefs } = await admin
        .from('conversation_prefs')
        .select('booking_id, archived_at, starred_at, no_reply_needed_at')
        .eq('user_id', uid);

    const prefMap: Record<string, any> = {};
    (prefs || []).forEach((p: any) => {
        prefMap[p.booking_id] = p;
    });

    const todayKey = londonDayKey();

    const conversations: any[] = bookings.map((b) => {
        const listing = listingMap[b.listing_id];
        const otherId = otherOf(b);
        const viewerIsGuest = !teamOn[b.id];
        // Everyone answering for the property: an answer from any of them
        // answers the guest.
        const answering = teamOn[b.id] ? [b.host_id].concat(coHostsOf[b.listing_id] || []) : undefined;

        const pref = prefMap[b.id];

        // The second face: a co-host on the property, or — for a co-host
        // looking at it — the owner. Never the viewer, never the person
        // already shown.
        const team = [b.host_id].concat(coHostsOf[b.listing_id] || []);
        const secondId = team.find((id) => id && id !== uid && id !== otherId) || null;
        [otherId, secondId, lastMap[b.id] && lastMap[b.id].sender_id].forEach((id) => { if (id) personIds.add(id); });

        return {
            // The universal identity every kind now carries. bookingId stays for
            // the booking-only actions (prefs, mark-unread) that key on it.
            kind: 'booking',
            id: b.id,
            key: 'booking:' + b.id,
            subtitle: listing ? listing.title : null,
            manageable: true,   // star / archive / mark-unread live only on bookings
            bookingId: b.id,
            starred: !!(pref && pref.starred_at),
            // Worked out, not stored — see lib/conversations.ts. A message
            // arriving after they archived it puts it back in the inbox.
            archived: isArchived(pref && pref.archived_at, lastInboundMap[b.id]),
            listing: listing ? { id: listing.id, title: listing.title, images: listing.images } : null,
            otherName: nameMap[otherId] || 'Guest',
            checkIn: b.check_in,
            checkOut: b.check_out,
            lastMessage: lastMap[b.id] || null,
            unread: unreadMap[b.id] || 0,
            // The signal a host actually works from: the other person spoke
            // last and nobody has answered — unless they have said they have
            // read it and no answer is needed. See lib/conversations.ts.
            needsReply: needsReply(lastMap[b.id], uid, pref && pref.no_reply_needed_at, answering),
            noReplyNeeded: !!(pref && pref.no_reply_needed_at),
            // Somebody currently in the property matters more than somebody
            // arriving in April.
            stage:
                b.check_in <= todayKey && b.check_out > todayKey
                    ? 'staying'
                    : b.check_in > todayKey
                        ? 'upcoming'
                        : 'past',
            // Flagged so the screen can make clear whose property it is.
            asCoHost: listing ? listing.host_id !== uid && teamOn[b.id] : false,
            category: categoryOf('booking'),
            statusLine: bookingStatusLine({ status: b.status, checkIn: b.check_in, checkOut: b.check_out, todayKey, viewerIsGuest }),
            placeTitle: listing ? listing.title : null,
            photoUrl: listing && Array.isArray(listing.images) && listing.images[0] ? getImageUrl(String(listing.images[0])) : null,
            _people: [otherId, secondId],
        };
    });

    // --- the guest's experience-order threads --------------------------------
    // Order threads are guest↔provider-owner; the CUSTOMER side belongs here (the
    // provider side is on /services/messages). Live orders only — a holding order
    // is mid-checkout, and an ended one is history.
    const { data: myOrders } = await admin
        .from('service_orders')
        .select('id, item_name, provider_id, provider_business_name, service_date, status')
        .eq('guest_id', uid)
        .in('status', ['authorised', 'confirmed']);

    const orderIds = (myOrders || []).map((o: any) => o.id);
    const { data: orderMsgs } = orderIds.length
        ? await admin.from('messages')
            .select('order_id, body, created_at, sender_id, recipient_id, read_at')
            .in('order_id', orderIds).order('created_at', { ascending: false })
        : { data: [] };
    const oLast: Record<string, any> = {};
    const oUnread: Record<string, number> = {};
    (orderMsgs || []).forEach((m: any) => {
        if (!oLast[m.order_id]) oLast[m.order_id] = m;
        if (isUnreadFor(m, uid, false)) oUnread[m.order_id] = (oUnread[m.order_id] || 0) + 1;
    });
    for (const o of myOrders || []) {
        const last = oLast[o.id] || null;
        if (last && last.sender_id) personIds.add(last.sender_id);
        conversations.push({
            kind: 'order', id: o.id, key: 'order:' + o.id, manageable: false,
            otherName: o.provider_business_name || 'Provider',
            subtitle: (o.item_name || 'Experience') + (o.service_date ? ' · ' + String(o.service_date) : ''),
            category: categoryOf('order'),
            statusLine: orderStatusLine({ status: o.status, serviceDate: o.service_date, todayKey }),
            placeTitle: o.item_name || 'Experience',
            _provider: o.provider_id || null,
            _people: [],
            listing: null,
            lastMessage: last,
            unread: oUnread[o.id] || 0,
            // The other side spoke last and it's unanswered — no prefs to suppress it.
            needsReply: !!(last && last.sender_id !== uid),
            noReplyNeeded: false, starred: false, archived: false, stage: null,
        });
    }

    // --- the host's job (enquiry) threads ------------------------------------
    // Enquiry threads are host↔provider-owner; the HOST side belongs here (the
    // provider side is on /services/messages).
    const { data: myEnquiries } = await admin
        .from('service_enquiries')
        .select('id, reference, business_name, summary, status, provider_id, listing_id, preferred_date, proposed_date')
        .eq('host_id', uid)
        .in('status', ['accepted', 'cancelled']);

    const enquiryIds = (myEnquiries || []).map((e: any) => e.id);
    const { data: enquiryMsgs } = enquiryIds.length
        ? await admin.from('messages')
            .select('enquiry_id, body, created_at, sender_id, recipient_id, read_at')
            .in('enquiry_id', enquiryIds).order('created_at', { ascending: false })
        : { data: [] };
    const eLast: Record<string, any> = {};
    const eUnread: Record<string, number> = {};
    (enquiryMsgs || []).forEach((m: any) => {
        if (!eLast[m.enquiry_id]) eLast[m.enquiry_id] = m;
        if (isUnreadFor(m, uid, false)) eUnread[m.enquiry_id] = (eUnread[m.enquiry_id] || 0) + 1;
    });
    for (const e of myEnquiries || []) {
        const last = eLast[e.id] || null;
        if (last && last.sender_id) personIds.add(last.sender_id);
        conversations.push({
            kind: 'enquiry', id: e.id, key: 'enquiry:' + e.id, manageable: false,
            otherName: e.business_name || 'The tradesman',
            subtitle: String(e.reference || '') + (e.summary ? ' · ' + e.summary : ''),
            category: categoryOf('enquiry'),
            statusLine: enquiryStatusLine({ status: e.status, date: e.proposed_date || e.preferred_date, todayKey }),
            placeTitle: e.summary || null,
            _listing: e.listing_id || null,
            _provider: e.provider_id || null,
            _people: [],
            listing: null,
            lastMessage: last,
            unread: eUnread[e.id] || 0,
            needsReply: !!(last && last.sender_id !== uid),
            noReplyNeeded: false, starred: false, archived: false, stage: null,
        });
    }

    // --- the PROVIDER's own reservation threads ------------------------------
    // The other side of the two above: orders and enquiries for a business this
    // user OWNS. This is what makes /messages a home for a provider too, so their
    // Message buttons open the three-pane with the reservation card rather than a
    // bare single-thread page. Deduped by key (a user is never both sides of one
    // thread, so this only adds).
    const seenKeys = new Set(conversations.map((c: any) => c.key));
    // Owned, or co-hosted with messages (lib/providerAccess).
    const providerIds = await providerIdsWith(admin, uid, 'can_messages');

    if (providerIds.length) {
        // The business's own team — its owner and co-hosts with messages — so a
        // reply from any of them answers the customer (needsReply).
        const [{ data: provRows }, { data: provTeamRows }] = await Promise.all([
            admin.from('service_providers').select('id, owner_id').in('id', providerIds),
            admin.from('provider_access').select('provider_id, user_id')
                .in('provider_id', providerIds).eq('status', 'active').eq('can_messages', true),
        ]);
        const teamOfProvider: Record<string, string[]> = {};
        (provRows || []).forEach((p: any) => { teamOfProvider[p.id] = [p.owner_id].filter(Boolean); });
        (provTeamRows || []).forEach((a: any) => {
            if (a.user_id) (teamOfProvider[a.provider_id] = teamOfProvider[a.provider_id] || []).push(a.user_id);
        });
        const provTeamAnswered = (last: any, providerId: string) =>
            !!last && (teamOfProvider[providerId] || []).indexOf(last.sender_id) !== -1;

        const { data: provOrders } = await admin
            .from('service_orders')
            .select('id, item_name, service_date, status, guest_name, guest_id, provider_id')
            .in('provider_id', providerIds)
            .is('parent_order_id', null)
            .in('status', ['authorised', 'confirmed']);
        const provOrderIds = (provOrders || []).map((o: any) => o.id);
        const poLast: Record<string, any> = {};
        const poUnread: Record<string, number> = {};
        if (provOrderIds.length) {
            const { data: msgs } = await admin.from('messages')
                .select('order_id, body, created_at, sender_id, recipient_id, read_at')
                .in('order_id', provOrderIds).order('created_at', { ascending: false });
            (msgs || []).forEach((m: any) => {
                if (!poLast[m.order_id]) poLast[m.order_id] = m;
                if (isUnreadFor(m, uid, true, readTo[threadKey('order', m.order_id)])) poUnread[m.order_id] = (poUnread[m.order_id] || 0) + 1;
            });
        }
        for (const o of provOrders || []) {
            if (seenKeys.has('order:' + o.id)) continue;
            const last = poLast[o.id] || null;
            [o.guest_id, last && last.sender_id].forEach((id) => { if (id) personIds.add(id); });
            conversations.push({
                kind: 'order', id: o.id, key: 'order:' + o.id, manageable: false,
                otherName: o.guest_name || 'Guest',
                subtitle: (o.item_name || 'Experience') + (o.service_date ? ' · ' + String(o.service_date) : ''),
                category: categoryOf('order'),
                statusLine: orderStatusLine({ status: o.status, serviceDate: o.service_date, todayKey }),
                placeTitle: o.item_name || 'Experience',
                _provider: o.provider_id || null,
                _team: true,
                _people: [o.guest_id || null],
                listing: null, lastMessage: last, unread: poUnread[o.id] || 0,
                needsReply: !!(last && last.sender_id !== uid) && !provTeamAnswered(last, o.provider_id),
                noReplyNeeded: false, starred: false, archived: false, stage: null,
            });
        }

        const { data: provEnq } = await admin
            .from('service_enquiries')
            .select('id, reference, summary, status, host_name, host_id, provider_id, listing_id, preferred_date, proposed_date')
            .in('provider_id', providerIds)
            .in('status', ['accepted', 'cancelled']);
        const provEnqIds = (provEnq || []).map((e: any) => e.id);
        const peLast: Record<string, any> = {};
        const peUnread: Record<string, number> = {};
        if (provEnqIds.length) {
            const { data: msgs } = await admin.from('messages')
                .select('enquiry_id, body, created_at, sender_id, recipient_id, read_at')
                .in('enquiry_id', provEnqIds).order('created_at', { ascending: false });
            (msgs || []).forEach((m: any) => {
                if (!peLast[m.enquiry_id]) peLast[m.enquiry_id] = m;
                if (isUnreadFor(m, uid, true, readTo[threadKey('enquiry', m.enquiry_id)])) peUnread[m.enquiry_id] = (peUnread[m.enquiry_id] || 0) + 1;
            });
        }
        for (const e of provEnq || []) {
            if (seenKeys.has('enquiry:' + e.id)) continue;
            const last = peLast[e.id] || null;
            [e.host_id, last && last.sender_id].forEach((id) => { if (id) personIds.add(id); });
            conversations.push({
                kind: 'enquiry', id: e.id, key: 'enquiry:' + e.id, manageable: false,
                otherName: e.host_name || 'The owner',
                subtitle: String(e.reference || '') + (e.summary ? ' · ' + e.summary : ''),
                category: categoryOf('enquiry'),
                statusLine: enquiryStatusLine({ status: e.status, date: e.proposed_date || e.preferred_date, todayKey }),
                placeTitle: e.summary || null,
                _listing: e.listing_id || null,
                _provider: e.provider_id || null,
                _team: true,
                _people: [e.host_id || null],
                listing: null, lastMessage: last, unread: peUnread[e.id] || 0,
                needsReply: !!(last && last.sender_id !== uid) && !provTeamAnswered(last, e.provider_id),
                noReplyNeeded: false, starred: false, archived: false, stage: null,
            });
        }
    }

    await dressRows(admin, uid, conversations, personIds);

    // Sorted by the most recent message rather than when the booking was
    // made — a conversation someone replied to an hour ago matters more than
    // a booking taken last week.
    conversations.sort((a: any, b: any) => {
        const at = (a.lastMessage && a.lastMessage.created_at) || '';
        const bt = (b.lastMessage && b.lastMessage.created_at) || '';
        if (at && bt) return at < bt ? 1 : -1;
        if (at) return -1;
        if (bt) return 1;
        return 0;
    });

    return NextResponse.json({
        conversations: conversations,
        // Both totals count the inbox only. Something archived is deliberately
        // out of sight, so it must not keep a badge lit either.
        totalUnread: conversations
            .filter((c: any) => !c.archived)
            .reduce((sum: number, c: any) => sum + (c.unread || 0), 0),
        needsReply: conversations.filter((c: any) => c.needsReply && !c.archived).length,
    });
}

// The faces and the "Name:" / "You:" in front of a preview, filled in once for
// every row. A row is built with placeholders (_people, _provider, _listing,
// _team) by whichever block made it; this resolves them in a handful of reads
// rather than one per row, then strips them.
//
// What each kind shows, the way Airbnb stacks it: the place's photo (the
// cottage, the experience, the property a trade is working on), the other
// person's face over its corner, and a co-host's face beside that when there
// is one. Initials stand in for anyone without a photo.
async function dressRows(admin: any, uid: string, rows: any[], personIds: Set<string>) {
    const providerIds = Array.from(new Set(rows.map((r) => r._provider).filter(Boolean)));
    const { data: providers } = providerIds.length
        ? await admin.from('service_providers').select('id, owner_id, business_name, logo, headshot, photos').in('id', providerIds)
        : { data: [] };
    const providerMap: Record<string, any> = {};
    (providers || []).forEach((p: any) => { providerMap[p.id] = p; if (p.owner_id) personIds.add(p.owner_id); });

    // A business's co-hosts who answer messages, for the provider's own rows.
    const { data: providerTeam } = providerIds.length
        ? await admin.from('provider_access').select('provider_id, user_id')
            .in('provider_id', providerIds).eq('status', 'active').eq('can_messages', true)
        : { data: [] };
    const providerCoHosts: Record<string, string[]> = {};
    (providerTeam || []).forEach((a: any) => {
        if (!a.user_id) return;
        (providerCoHosts[a.provider_id] = providerCoHosts[a.provider_id] || []).push(a.user_id);
        personIds.add(a.user_id);
    });

    const listingIds = Array.from(new Set(rows.map((r) => r._listing).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title, images').in('id', listingIds)
        : { data: [] };
    const listingMap: Record<string, any> = {};
    (listings || []).forEach((l: any) => { listingMap[l.id] = l; });

    const ids = Array.from(personIds);
    const { data: profiles } = ids.length
        ? await admin.from('profiles').select('id, full_name, first_name, last_name, preferred_name, show_full_name, avatar_url').in('id', ids)
        : { data: [] };
    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

    const person = (id: string | null, fallbackName?: string) => {
        if (!id) return null;
        const p = profileMap[id];
        return {
            name: firstName(p, fallbackName || 'Guest'),
            avatarUrl: p && p.avatar_url ? getImageUrl(String(p.avatar_url)) : null,
        };
    };
    const image = (key: any) => (key ? getImageUrl(String(key)) : null);

    for (const r of rows) {
        const prov = r._provider ? providerMap[r._provider] : null;
        const people: any[] = [];

        if (r.kind === 'booking') {
            const [first, second] = r._people || [];
            // Never the viewer's own face. On a stay an owner booked at their
            // own place the "other person" is themselves, and their photo sat
            // over the co-host's (20/10/2026) — the co-host goes in front.
            const a = first !== uid ? person(first, r.otherName) : null;
            if (a) people.push({ ...a, name: r.otherName || a.name });
            const b = second !== uid ? person(second) : null;
            if (b) people.push(b);
        } else if (r._team) {
            // The provider's side: the customer, then a teammate.
            const a = person((r._people || [])[0], r.otherName);
            people.push(a ? { ...a, name: r.otherName || a.name } : { name: r.otherName, avatarUrl: null });
            const team = prov ? [prov.owner_id].concat(providerCoHosts[prov.id] || []) : [];
            const mate = team.find((id: string) => id && id !== uid) || null;
            const b = person(mate);
            if (b) people.push(b);
        } else if (prov) {
            // The customer's side: the business is the other party, shown by
            // its logo or the owner's own photo.
            const owner = person(prov.owner_id);
            people.push({
                name: r.otherName,
                avatarUrl: image(prov.logo) || image(prov.headshot) || (owner && owner.avatarUrl) || null,
            });
        } else {
            people.push({ name: r.otherName, avatarUrl: null });
        }

        if (!r.photoUrl) {
            if (r.kind === 'enquiry' && r._listing && listingMap[r._listing]) {
                const l = listingMap[r._listing];
                r.photoUrl = Array.isArray(l.images) && l.images[0] ? image(l.images[0]) : null;
                if (!r.placeTitle) r.placeTitle = l.title;
            } else if (r.kind === 'order' && prov) {
                r.photoUrl = Array.isArray(prov.photos) && prov.photos[0] ? image(prov.photos[0]) : null;
            }
        }

        r.people = people;

        // Whose words the preview is: "You:" for the viewer's own, the
        // sender's first name for anyone else's.
        if (r.lastMessage) {
            const sid = r.lastMessage.sender_id;
            r.lastMessage.senderLabel = !sid
                ? null
                : sid === uid
                    ? 'You'
                    : (profileMap[sid] ? firstName(profileMap[sid], r.otherName || '') : r.otherName) || null;
        }

        delete r._people;
        delete r._provider;
        delete r._listing;
        delete r._team;
    }
}
