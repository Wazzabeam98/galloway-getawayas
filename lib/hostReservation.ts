// One of our own reservations, as a host sees it — the facts shared by the
// booking page (app/dashboard/bookings/[id]) and the calendar's reservation
// panel (app/dashboard/calendar via /api/host/reservations/[id]), so the two
// can never disagree about who is coming, what they paid or what the host may
// do about it.
//
// Pure: everything that needs the database or the clock is worked out by the
// caller and passed in (the access row, whether the phone is released, whether
// the stay has started or ended, what a guest would get back). That keeps this
// file unit-testable and keeps the rules themselves in their own homes —
// lib/stayWindow for the phone, lib/cancellation for the refund, lib/access for
// who may see what.

import { formatGBP } from './formatMoney';
import { ukDate } from './dayKey';
import { confirmationNumber, groupLabel, partyLabel } from './bookingDisplay';

// The message a host can send to ask their guest to cancel. Prefills the
// composer rather than sending anything — the host adds the reason and presses
// send.
//
// One paragraph, no line breaks, and short. The composer on the other end is a
// single-line <input>, which silently drops newlines: a draft written in
// paragraphs arrived with its sentences run together. It also has to be
// sendable exactly as it stands, because a bracketed 'fill this in' note is one
// distracted press away from reaching the guest.
export function askToCancelDraft(input: {
    guestFirst: string;
    listingTitle: string | null | undefined;
    checkIn: string;
    checkOut: string;
    guestWouldGet: number;
}): string {
    return 'Hi ' + input.guestFirst + ', I’m very sorry — I’ve run into a problem with '
        + (input.listingTitle || 'the property')
        + ' and I don’t think I can host you for '
        + ukDate(input.checkIn) + ' to ' + ukDate(input.checkOut)
        + ' as planned. If you cancel from Your trips you’d be refunded '
        + formatGBP(input.guestWouldGet) + '. Do let me know and I’ll help however I can.';
}

// Five payment states, not three — 'refunded' and 'partially_refunded' once
// fell through to 'Nothing paid yet' on a stay that had been paid for.
export function paymentStage(paymentStatus: string | null | undefined): string {
    switch (paymentStatus) {
        case 'paid': return 'Everything paid';
        case 'deposit_paid': return 'Deposit paid, balance outstanding';
        case 'refunded': return 'Paid, then refunded in full';
        case 'partially_refunded': return 'Paid, then partly refunded';
        default: return 'Nothing paid yet';
    }
}

export const RESERVATION_STATUS: Record<string, string> = {
    confirmed: 'Confirmed',
    pending: 'Waiting for you',
    pending_payment: 'Guest is paying',
    declined: 'Declined',
    cancelled: 'Cancelled',
};

export function nightsBetween(checkIn: string, checkOut: string): number {
    const a = Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8, 10));
    const b = Date.UTC(+checkOut.slice(0, 4), +checkOut.slice(5, 7) - 1, +checkOut.slice(8, 10));
    return Math.round((b - a) / 86400000);
}

export interface PanelAccess {
    isOwner: boolean;
    can_bookings: boolean;
    can_earnings: boolean;
    can_messages: boolean;
}

export interface PanelInput {
    booking: {
        id: string;
        listing_id: string;
        check_in: string;
        check_out: string;
        status: string;
        payment_status?: string | null;
        guests?: number | null;
        adults?: number | null;
        children?: number | null;
        pets?: number | null;
        total_price?: number | null;
        amount_paid?: number | null;
        amount_refunded?: number | null;
    };
    listing: {
        title?: string | null;
        image?: string | null;
        max_guests?: number | null;
        petsAllowed?: boolean;
    };
    guest: { name: string; first: string; avatarUrl: string | null };
    access: PanelAccess;
    // Worked out by the caller from lib/stayWindow and lib/cancellation.
    phone: string | null;          // null unless contactNumberVisible
    started: boolean;
    ended: boolean;
    guestWouldGet: number;
    openChange: { id: string; initiated_by: string; status: string } | null;
}

// What the calendar panel draws. Money is only present with can_earnings, and
// the booking detail and actions only with can_bookings — the wall is here,
// before anything reaches the browser, not in the component's `if`.
export function reservationPanel(input: PanelInput) {
    const b = input.booking;
    const checkIn = String(b.check_in).slice(0, 10);
    const checkOut = String(b.check_out).slice(0, 10);
    const nights = nightsBetween(checkIn, checkOut);
    const partySize = (Number(b.adults || 0) + Number(b.children || 0)) || Number(b.guests || 0) || 1;
    const named = input.guest.name && input.guest.name !== 'Guest';

    const base = {
        kind: 'direct' as const,
        bookingId: b.id,
        status: b.status,
        statusLabel: RESERVATION_STATUS[b.status] || b.status,
        guestName: input.guest.name,
        guestFirst: input.guest.first,
        avatarUrl: input.guest.avatarUrl,
        heading: groupLabel(named ? input.guest.first : null, partySize),
        checkIn,
        checkOut,
        nights,
    };

    if (!input.access.can_bookings) {
        // A co-host or staff member who may see the calendar but not the
        // bookings: the dates and the name already on the bar, nothing more.
        return { ...base, detail: null };
    }

    const closed = b.status === 'cancelled' || b.status === 'declined';
    const confirmed = b.status === 'confirmed';
    const total = Number(b.total_price || 0);
    const paid = Number(b.amount_paid || 0);
    const refunded = Number(b.amount_refunded || 0);
    const showMoney = input.access.can_earnings;

    const askHref = (input.access.isOwner && confirmed && !input.ended)
        ? '/messages?b=' + b.id + '&draft=' + encodeURIComponent(askToCancelDraft({
            guestFirst: input.guest.first,
            listingTitle: input.listing.title,
            checkIn,
            checkOut,
            guestWouldGet: input.guestWouldGet,
        }))
        : null;

    // Contact: the phone appears from the day before arrival through the stay
    // (lib/stayWindow). Before then the host is told when, rather than shown a
    // blank; email is never shown to a host — they talk through messages.
    const phoneNote = input.phone
        ? null
        : (!confirmed || closed)
            ? null
            : input.ended
                ? 'No longer shown — the stay has ended'
                : 'Shown from the day before they arrive';

    return {
        ...base,
        detail: {
            confirmation: confirmationNumber(b.id),
            party: partyLabel(b) || partySize + (partySize === 1 ? ' guest' : ' guests'),
            money: showMoney
                ? {
                    total: formatGBP(total),
                    paid: formatGBP(paid),
                    refunded: refunded > 0 ? formatGBP(refunded) : null,
                    stage: paymentStage(b.payment_status),
                }
                : null,
            phone: input.phone,
            phoneNote,
            messagesHref: input.access.can_messages ? '/messages?b=' + b.id : null,
            bookingHref: '/dashboard/bookings/' + b.id,
            openChange: input.openChange,
            // Exactly the props the booking page hands ManageReservationSheet,
            // so the panel offers the same actions with the same rules.
            manage: {
                bookingId: b.id,
                status: b.status,
                isOwner: input.access.isOwner,
                ended: input.ended,
                started: input.started,
                phone: input.phone,
                guestFirst: input.guest.first,
                totalPrice: showMoney ? total : 0,
                amountPaid: showMoney ? paid : 0,
                amountRefunded: showMoney ? refunded : 0,
                askToCancelHref: askHref,
                checkIn,
                checkOut,
                adults: Number(b.adults || 0) || Math.max(1, Number(b.guests || 1) - Number(b.children || 0)),
                children: Number(b.children || 0),
                pets: Number(b.pets || 0),
                maxGuests: Number(input.listing.max_guests || 1),
                petsAllowed: !!input.listing.petsAllowed,
                listingId: b.listing_id,
                listingTitle: input.listing.title || 'your stay',
                listingImage: input.listing.image || null,
            },
        },
    };
}

export type ReservationPanel = ReturnType<typeof reservationPanel>;
