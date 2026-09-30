// The provider's upcoming reservations, normalised into ONE shape a host-style
// list + reservation card can render, whatever the provider is:
//   - a slot class/session, a chef coming to a cottage, a bakery order to collect
//     or deliver  → built from service_orders (we are the merchant of record, so
//     the money carries our 10% fee shown as working)
//   - a tradesperson's job → built from service_enquiries (paid off-platform, so
//     no per-job fee; "asked for" wording, the cottage and the host to ring)
//
// Server-only (uses the service-role client). All money is formatted here to a
// string, so the browser never does money maths (same rule as MoneyCards).

import { orderNet, orderReference } from '@/lib/serviceOrders';
import { orderLocation } from '@/lib/orderLocation';
import { whenLabel, timeLabel, dateLabel, cancellationSentence } from '@/components/marketplace/present';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { groupLabel } from '@/lib/bookingDisplay';
import { formatGBP } from '@/lib/formatMoney';
import { getImageUrl, displayName } from '@/lib/utils';
import { londonDayKey, shiftDayKey, ukDate } from '@/lib/dayKey';

export type ReservationKind = 'slot' | 'comes_to_you' | 'made_to_order' | 'trade';

// Structural mirrors of the reservation-card component types
// (ReservationStatusPill's StatusTone and MoneyCards' MoneyCardsData). Declared
// here rather than imported so this server lib — which the test build compiles —
// never pulls in a .tsx component (tsc's test config has no --jsx). Structural
// typing keeps them compatible when the card is fed this shape.
export type StatusTone = 'ok' | 'wait' | 'over';
// The "Where" value: a plain line, or a name with an address beneath it (the
// latter for a provider looking at a booking at their own venue). Structural
// mirror of the card's WhereField, declared here to keep this a .tsx-free lib.
export type WhereField = string | { line: string; sub?: string | null };
export interface MoneyLine { label: string; value: string; muted?: boolean }
export interface MoneyCardsData {
    showMoney: boolean;
    total: string;
    nightsLabel: string;
    working?: string;
    rows: MoneyLine[];
    description?: string;
    caption?: string;
}

export interface ProviderReservation {
    id: string;
    kind: ReservationKind;
    reference: string;
    dateKey: string;                 // YYYY-MM-DD, for sorting + today/tomorrow
    soon: 'Today' | 'Tomorrow' | null;
    whenLabel: string;               // per-kind ("Sat 10 Oct at 2pm" / "Ready for…" / "Asked for…")
    title: string;                   // what they booked / the job
    itemLine: string | null;         // small sub-line under the title
    // Who
    personName: string;              // guest, or host (for a trade)
    personFirst: string;
    avatarUrl: string | null;
    photoUrl: string | null;         // item/provider photo (experiences) or cottage (trades)
    groupLabel: string;              // "Liam's group of 2"
    partyLabel: string | null;
    // Detail card
    whenHeading: string;
    whereLabel: WhereField | null;   // provider venue (name + address) / "You travel to…" / collection / delivery / cottage
    note: string | null;
    allergy: string | null;
    // A status pill in the reservation-page family (ok / wait / over).
    status: { label: string; tone: StatusTone };
    // The money as one card that opens the full breakdown with our fee working
    // (reuses MoneyCards) when there is money through us; otherwise a plain note
    // (a trade paid off-platform, or a held request not yet confirmed).
    money: MoneyCardsData | null;
    moneyNote: string | null;
    phone: string | null;
    messageHref: string;
    needsReply: boolean;             // awaiting the provider's answer (a held request / an unanswered enquiry)
    inWeek: boolean;                 // dated within the next 7 days (for the "This week" filter)
    // For the provider's Manage sheet and cancellation card (guest experiences
    // only; a trade is off-platform so both are null).
    rawStatus: string;               // 'authorised' | 'confirmed' | …
    pendingChange: string | null;    // a date/time change awaiting an answer
    pendingChangeBy: 'guest' | 'provider' | null;  // who proposed it
    cancellation: ReservationCancellation | null;
}

// Structural mirror of ProviderCancellationCard's data (kept here so the server
// lib does not import a client component; see the note by StatusTone above).
export interface ReservationCancellation { headline: string; summary: string; lateLine: string }

export interface ProviderReservationsResult {
    reservations: ProviderReservation[];
    summary: { today: number; thisWeek: number; needsReply: number };
}

function soonFor(dateKey: string, today: string, tomorrow: string): 'Today' | 'Tomorrow' | null {
    if (dateKey === today) return 'Today';
    if (dateKey === tomorrow) return 'Tomorrow';
    return null;
}

function partyLabelForOrder(o: any): string | null {
    const a = Number(o.adults) || 0, c = Number(o.children) || 0;
    if (a > 0 || c > 0) {
        const parts: string[] = [];
        if (a > 0) parts.push(a + (a === 1 ? ' adult' : ' adults'));
        if (c > 0) parts.push(c + (c === 1 ? ' child' : ' children'));
        if (parts.length) return parts.join(', ');
    }
    const n = Number(o.item_unit === 'person' ? o.quantity : (o.attendees || o.quantity)) || 1;
    if (o.item_unit === 'person') return n + (n === 1 ? ' place' : ' places');
    return 'Party of ' + n;
}

function partyCount(o: any): number {
    const a = Number(o.adults) || 0, c = Number(o.children) || 0;
    if (a > 0 || c > 0) return a + c;
    return Number(o.attendees || o.quantity) || 1;
}

// The provider's own venue address, assembled from the three private fields in
// the same order the cottage address uses. Null when we hold none of them.
export function providerVenueAddress(provider: any): string | null {
    return [provider.collection_street, provider.collection_town, provider.collection_postcode]
        .map((p: any) => String(p || '').trim()).filter(Boolean).join(', ') || null;
}

// Where the experience happens, in the provider's own words — never worded as
// though the provider were the guest. When the guest comes to the provider's own
// place, the useful answer is the provider's venue/listing name with its address
// beneath (if we hold one), not "your place".
export function whereForOrder(o: any, provider: any): WhereField | null {
    const loc = orderLocation({ shape: o.shape, fulfilment: o.fulfilment }, provider.fulfilment ?? null);
    if (o.shape === 'slot') {
        if (loc.slotTravels) return o.service_address ? 'You travel to ' + o.service_address : 'You travel to the guest';
        return { line: provider.business_name || 'Your place', sub: providerVenueAddress(provider) };
    }
    if (o.shape === 'comes_to_you') return o.service_address ? 'You go to ' + o.service_address : 'You go to the guest';
    // made_to_order (bakery etc.)
    if (loc.comesToCottage) return o.service_address ? 'Deliver to ' + o.service_address : 'For delivery';
    return 'For collection';
}

// The provider's own cancellation terms, phrased for the reservation card: a
// headline, the sentence a guest is shown, and what happens if they cancel late.
// Shape-aware wording, from the provider's single notice window (or "no refund").
export function cancellationFor(shape: string, hours: number, noRefund: boolean): ReservationCancellation {
    if (noRefund) {
        return {
            headline: 'No refunds',
            summary: 'This booking is non-refundable — the guest was told so when they booked.',
            lateLine: 'A cancellation, whenever it comes, keeps the payment.',
        };
    }
    const h = Math.max(0, Number(hours) || 0);
    const headline = shape === 'slot'
        ? 'Free up to ' + h + ' hour' + (h === 1 ? '' : 's') + ' before'
        : 'Free up to ' + Math.round(h / 24) + ' day' + (Math.round(h / 24) === 1 ? '' : 's') + ' before';
    return {
        headline,
        summary: cancellationSentence(shape, h, 'the guest'),
        lateLine: 'After that, a cancellation is non-refundable — the payment stays with you.',
    };
}

export async function loadProviderReservations(
    admin: any,
    provider: { id: string; audience: string | null; business_name: string | null; fulfilment?: string | null; photos?: string[] | null; cancellation_window_hours?: number | null; guest_details?: any },
): Promise<ProviderReservationsResult> {
    const today = londonDayKey();
    const tomorrow = shiftDayKey(today, 1);
    const weekEnd = shiftDayKey(today, 7);

    if (provider.audience === 'guest') {
        return loadGuestReservations(admin, provider, today, tomorrow, weekEnd);
    }
    return loadTradeReservations(admin, provider, today, tomorrow, weekEnd);
}

async function loadGuestReservations(admin: any, provider: any, today: string, tomorrow: string, weekEnd: string): Promise<ProviderReservationsResult> {
    const { data: orders } = await admin
        .from('service_orders')
        .select('id, parent_order_id, status, service_date, service_time, shape, fulfilment, service_address, price, commission_rate, amount_refunded, item_name, item_unit, unit_price, quantity, attendees, adults, children, guest_id, guest_name, guest_phone, note, allergy, listing_id, created_at, pending_service_date, pending_service_time, pending_change_expires_at, pending_change_by, funds_flow, paid_out_at')
        .eq('provider_id', provider.id)
        .in('status', ['authorised', 'confirmed'])
        .is('parent_order_id', null)
        .order('service_date', { ascending: true });

    const rows = (orders || []).filter((o: any) => String(o.service_date || '').slice(0, 10) >= today);

    // Guest avatars/names in one read (orders keep a denormalised guest_name, but
    // an avatar and the privacy-aware display name live on profiles).
    const guestIds = Array.from(new Set(rows.map((o: any) => o.guest_id).filter(Boolean)));
    const profiles: Record<string, any> = {};
    if (guestIds.length) {
        const { data: profs } = await admin
            .from('profiles').select('id, full_name, preferred_name, show_full_name, avatar_url').in('id', guestIds);
        (profs || []).forEach((p: any) => { profiles[p.id] = p; });
    }
    const providerPhoto = (Array.isArray(provider.photos) && provider.photos[0]) ? getImageUrl(String(provider.photos[0])) : null;

    const reservations: ProviderReservation[] = rows
        .map((o: any) => {
            const awaiting = o.status === 'authorised';   // a held request the provider hasn't confirmed
            const prof = o.guest_id ? profiles[o.guest_id] : null;
            const name = prof ? displayName(prof, o.guest_name || 'Guest') : (o.guest_name || 'Guest');
            const first = String(name).trim().split(' ')[0] || 'Guest';
            const net = orderNet(o);
            const refundLine: MoneyLine[] = net.refunded > 0 ? [{ label: 'Refunded', value: '-' + formatGBP(net.refunded), muted: true }] : [];
            const money: MoneyCardsData | null = awaiting
                ? null
                : {
                    // The headline is the provider's own take (their terms), like
                    // the host card's "£480 · Total for 3 nights" but for a
                    // provider: "£36.00 · Your take". The pop-up carries the full
                    // split with our fee working.
                    showMoney: true,
                    caption: 'Money',
                    total: formatGBP(net.youGet),
                    nightsLabel: 'Your take',
                    description: 'What the guest paid, our fee, and what reaches you.',
                    rows: [
                        { label: 'Guest paid', value: formatGBP(net.gross - net.refunded) },
                        ...refundLine,
                        { label: 'Our fee (' + Math.round(net.rate * 100) + '%)', value: '-' + formatGBP(net.fee), muted: true },
                        { label: 'You get', value: formatGBP(net.youGet) },
                    ],
                    working: 'Guest paid ' + formatGBP(net.gross - net.refunded) + ' − our ' + Math.round(net.rate * 100) + '% fee ' + formatGBP(net.fee) + ' = ' + formatGBP(net.youGet) + ', ' + (
                        // Where the provider's share is. A held order (every order
                        // from 30/09/2026) is paid the day after the booking; an
                        // older direct order went to their account at payment.
                        o.funds_flow !== 'held'
                            ? 'paid straight to your account.'
                            : o.paid_out_at
                                ? 'paid to you on ' + ukDate(londonDayKey(new Date(o.paid_out_at))) + '.'
                                : 'paid to you the day after the booking.'
                    ),
                };
            const moneyNote = awaiting
                ? 'Their card is held, not charged — confirm the request to take the payment (' + formatGBP(net.gross) + ').'
                : null;
            const status: { label: string; tone: StatusTone } = awaiting
                ? { label: 'Awaiting your confirmation', tone: 'wait' }
                : { label: 'Confirmed', tone: 'ok' };
            // A live date-change request the guest is waiting on (PR #173).
            const pendingLive = o.pending_service_date
                && (!o.pending_change_expires_at || new Date(o.pending_change_expires_at).getTime() > Date.now());
            const pendingChange = pendingLive ? whenLabel(o.shape, o.pending_service_date, o.pending_service_time) : null;
            // Who proposed the pending change (null marker = a legacy guest request).
            const pendingChangeBy: 'guest' | 'provider' | null = pendingLive ? (o.pending_change_by === 'provider' ? 'provider' : 'guest') : null;
            const cancellation = cancellationFor(
                o.shape,
                Number(provider.cancellation_window_hours ?? 48),
                !!(provider.guest_details && provider.guest_details.no_refund),
            );
            return {
                id: o.id,
                kind: (o.shape as ReservationKind) || 'made_to_order',
                reference: orderReference(o.id),
                dateKey: String(o.service_date).slice(0, 10),
                soon: soonFor(String(o.service_date).slice(0, 10), today, tomorrow),
                whenLabel: whenLabel(o.shape, o.service_date, o.service_time),
                title: o.item_name || provider.business_name || 'Experience',
                itemLine: o.unit_price != null && o.item_unit === 'person' ? formatGBP(o.unit_price) + ' per person' : null,
                whenHeading: o.shape === 'made_to_order' ? 'Ready for' : 'When',
                personName: name,
                personFirst: first,
                avatarUrl: (prof && prof.avatar_url) ? getImageUrl(String(prof.avatar_url)) : null,
                photoUrl: providerPhoto,
                groupLabel: groupLabel(first, partyCount(o)),
                partyLabel: partyLabelForOrder(o),
                whereLabel: whereForOrder(o, provider),
                note: o.note || null,
                allergy: o.allergy || null,
                status,
                money,
                moneyNote,
                phone: o.guest_phone || null,
                messageHref: '/messages?o=' + o.id,
                needsReply: awaiting,
                inWeek: String(o.service_date).slice(0,10) >= today && String(o.service_date).slice(0,10) <= weekEnd,
                rawStatus: o.status,
                pendingChange,
                pendingChangeBy,
                cancellation,
            } as ProviderReservation;
        });

    const summary = {
        today: reservations.filter((r) => r.dateKey === today).length,
        thisWeek: reservations.filter((r) => r.dateKey >= today && r.dateKey <= weekEnd).length,
        // "Needs a reply" for a guest provider = requests still authorised (card
        // held, awaiting confirm).
        needsReply: rows.filter((o: any) => o.status === 'authorised').length,
    };
    return { reservations, summary };
}

async function loadTradeReservations(admin: any, provider: any, today: string, tomorrow: string, weekEnd: string): Promise<ProviderReservationsResult> {
    const { data: enquiries } = await admin
        .from('service_enquiries')
        .select('id, status, summary, area_key, urgency, preferred_date, window_from, window_to, host_name, host_phone, listing_id, proposed_date, sent_at, expires_at')
        .eq('provider_id', provider.id)
        .order('preferred_date', { ascending: true });

    // Accepted jobs still ahead, plus requests still to answer (needs a reply).
    const accepted = (enquiries || []).filter((e: any) => e.status === 'accepted' && (!e.preferred_date || String(e.preferred_date).slice(0, 10) >= today));
    const toAnswer = (enquiries || []).filter((e: any) => e.status === 'sent' || e.status === 'viewed');
    const relevant = [...toAnswer, ...accepted];

    const listingIds = Array.from(new Set(relevant.map((e: any) => e.listing_id).filter(Boolean)));
    const listings: Record<string, any> = {};
    if (listingIds.length) {
        const { data: ls } = await admin.from('listings').select('id, title, location, images').in('id', listingIds);
        (ls || []).forEach((l: any) => { listings[l.id] = l; });
    }

    const mapEnquiry = (e: any, needsReply: boolean): ProviderReservation => {
        const dateKey = e.preferred_date ? String(e.preferred_date).slice(0, 10) : '';
        const l = e.listing_id ? listings[e.listing_id] : null;
        const hostFirst = String(e.host_name || '').trim().split(' ')[0] || 'the owner';
        return {
            id: e.id,
            kind: 'trade' as const,
            reference: 'GG-' + String(e.id).replace(/[^0-9a-fA-F]/g, '').slice(0, 4).toUpperCase(),
            dateKey: dateKey || '9999-12-31',
            soon: dateKey ? soonFor(dateKey, today, tomorrow) : null,
            whenLabel: requestedWhen(e) || 'A date still to agree',
            title: e.summary || 'Job',
            itemLine: l ? (l.location || null) : null,
            whenHeading: 'Asked for',
            personName: e.host_name || 'The owner',
            personFirst: hostFirst,
            avatarUrl: null,
            photoUrl: (l && Array.isArray(l.images) && l.images[0]) ? getImageUrl(String(l.images[0])) : null,
            groupLabel: e.host_name || 'The property owner',
            partyLabel: null,
            whereLabel: l ? (l.title || 'the property') : 'the property',
            note: null,
            allergy: null,
            status: needsReply
                ? { label: 'New request', tone: 'wait' as StatusTone }
                : { label: 'Accepted', tone: 'ok' as StatusTone },
            money: null,
            moneyNote: needsReply
                ? 'A request to answer — reply to the owner, then agree the price and take payment directly.'
                : 'Agree the price and take payment directly — this job isn’t billed through Galloway Getaways.',
            phone: e.host_phone || null,
            messageHref: '/messages?e=' + e.id,
            needsReply,
            inWeek: !!dateKey && dateKey >= today && dateKey <= weekEnd,
            // A trade job is off-platform and runs on the separate enquiry flow, so
            // it carries no through-platform Manage sheet or cancellation card here.
            rawStatus: e.status,
            pendingChange: null,
            pendingChangeBy: null,
            cancellation: null,
        };
    };

    const reservations: ProviderReservation[] = [
        ...toAnswer.map((e: any) => mapEnquiry(e, true)),
        ...accepted.map((e: any) => mapEnquiry(e, false)),
    ];

    const summary = {
        today: reservations.filter((r) => r.dateKey === today).length,
        thisWeek: reservations.filter((r) => r.dateKey >= today && r.dateKey <= weekEnd).length,
        needsReply: (enquiries || []).filter((e: any) => e.status === 'sent' || e.status === 'viewed').length,
    };
    return { reservations, summary };
}
