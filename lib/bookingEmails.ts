// The two booking emails that had no home.
//
// The guest "You're booked" confirmation and the host "New booking" alert were
// each written once, inline, and each had a gap the other half of the flow
// left open:
//
//   - "You're booked" lived in app/api/notify/route.ts and was only ever sent
//     when a HOST clicked accept. An Instant-Book stay confirms itself in the
//     Stripe webhook with no host click, so its guest was promised an email by
//     /booking-confirmed and never sent one.
//   - "New booking" / "New booking request" existed in the same notify route
//     under type 'booking_created' — and nothing anywhere called it. The host
//     was never told a booking had come in; they had to open the dashboard to
//     find it.
//
// Both are now built here, once, so the webhook (server-side, no session) and
// the notify route (browser-triggered) send the identical thing and cannot
// drift apart. Every figure is read off the booking as stored — free_cancel and
// balance dates were stamped at checkout when the guest agreed to them, so the
// email quotes the agreement back rather than recomputing it.

import {
    emailLayout,
    escapeHtml,
    formatDate,
    button,
    detailRows,
    SITE_URL,
} from '@/lib/email';
import { formatTime } from '@/lib/utils';

function round2(value: number): number {
    return Math.round(Number(value || 0) * 100) / 100;
}

// "Arrive from 3pm until 8pm. Leave by 11am." — empty when the host has set
// nothing, so the email never states a time nobody chose. Same shape the
// notify route built inline.
export function arrivalLineFrom(listing: {
    check_in_time?: string | null;
    check_in_end_time?: string | null;
    check_out_time?: string | null;
}): string {
    return [
        formatTime(listing.check_in_time)
            ? 'Arrive from ' + formatTime(listing.check_in_time)
                + (formatTime(listing.check_in_end_time)
                    ? ' until ' + formatTime(listing.check_in_end_time)
                    : '')
            : '',
        formatTime(listing.check_out_time)
            ? 'Leave by ' + formatTime(listing.check_out_time)
            : '',
    ].filter(Boolean).join('. ');
}

export interface GuestBookedInput {
    guestFirst: string;        // display first name, unescaped
    listingTitle: string;      // raw
    checkIn: string;
    checkOut: string;
    arrivalLine: string;       // from arrivalLineFrom(), or ''
    guests: number | string;
    total: number;
    amountPaid: number;
    amountRefunded: number;
    balanceAmount: number;
    balanceDueDate: string | null;
    freeCancelUntil: string | null;
}

// The guest's "You're booked" — the one they keep. Carries the three questions
// they ask in the ten minutes after paying: when the rest comes out, how long
// they can change their mind, and what they get back if they do.
export function guestBookedEmail(input: GuestBookedInput): { subject: string; html: string } {
    const listingTitle = escapeHtml(input.listingTitle || 'your stay');
    const guestFirst = escapeHtml(input.guestFirst || 'there');
    const nights = escapeHtml(formatDate(input.checkIn) + ' to ' + formatDate(input.checkOut));

    const heading = "You're booked";
    const intro = 'Good news &mdash; your stay at ' + listingTitle
        + ' is confirmed. Your host will be in touch with the check-in details before you arrive.';

    const paidSoFar = round2(Number(input.amountPaid || 0) - Number(input.amountRefunded || 0));
    const balanceLeft = round2(Number(input.balanceAmount || 0));

    const moneyRows = [
        ...(paidSoFar > 0
            ? [{ label: 'Paid so far', value: '&pound;' + paidSoFar.toFixed(2) }]
            : []),
        ...(balanceLeft > 0
            ? [{
                label: 'Still to pay',
                value: '&pound;' + balanceLeft.toFixed(2)
                    + (input.balanceDueDate
                        ? ', taken from the same card on '
                            + escapeHtml(formatDate(input.balanceDueDate))
                        : ', due before you arrive')
                    + '. You can pay it sooner from your trips page.',
            }]
            : [{ label: 'Still to pay', value: 'Nothing &mdash; your stay is paid in full.' }]),
        ...(input.freeCancelUntil
            ? [{
                label: 'Free cancellation',
                value: 'Cancel by ' + escapeHtml(formatDate(input.freeCancelUntil))
                    + ' and you get back everything you have paid'
                    + (paidSoFar > 0 ? ' — &pound;' + paidSoFar.toFixed(2) + ' today' : '')
                    + '. After that a share is kept, depending on how close to your stay it is.',
            }]
            : [{
                label: 'Cancelling',
                value: 'These dates are outside the free-cancellation window, so a'
                    + ' cancellation now would not be refunded in full. Get in touch'
                    + ' if something changes and we will see what we can do.',
            }]),
    ];

    const html = emailLayout(
        '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + heading + '</h1>' +
        '<p style="margin:0;">Hi ' + guestFirst + ' &mdash; ' + intro + '</p>' +
        detailRows([
            { label: 'Property', value: listingTitle },
            { label: 'Dates', value: nights },
            ...(input.arrivalLine ? [{ label: 'Times', value: escapeHtml(input.arrivalLine + '.') }] : []),
            { label: 'Guests', value: String(input.guests || 1) },
            { label: 'Total', value: '&pound;' + Number(input.total || 0).toFixed(2) },
            ...moneyRows,
        ]) +
        button(SITE_URL + '/trips', 'View your trip'),
        "You're receiving this because you have a booking with Galloway Getaways. Booking emails can't be switched off."
    );

    return { subject: "You're booked — Galloway Getaways", html };
}

export interface HostNewBookingInput {
    hostFirst: string;
    guestFirst: string;
    listingTitle: string;
    checkIn: string;
    checkOut: string;
    guests: number | string;
    total: number;
    instant: boolean;
    bookingId: string;
}

// The host's alert. Instant Book confirms straight away; a request waits for
// them to accept — so the wording, and the button, differ.
export function hostNewBookingEmail(input: HostNewBookingInput): { subject: string; html: string } {
    const listingTitle = escapeHtml(input.listingTitle || 'your listing');
    const hostFirst = escapeHtml(input.hostFirst || 'there');
    const guestFirst = escapeHtml(input.guestFirst || 'A guest');
    const nights = escapeHtml(formatDate(input.checkIn) + ' to ' + formatDate(input.checkOut));

    const heading = input.instant ? 'New booking' : 'New booking request';
    const intro = input.instant
        ? guestFirst + ' has booked ' + listingTitle + ' using Instant Book. The dates are already confirmed and blocked out on your calendar.'
        : guestFirst + ' would like to book ' + listingTitle + '. Have a look and confirm or decline — until you do, the dates are held but not confirmed.';

    const html = emailLayout(
        '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + heading + '</h1>' +
        '<p style="margin:0;">Hi ' + hostFirst + ' &mdash; ' + intro + '</p>' +
        detailRows([
            { label: 'Property', value: listingTitle },
            { label: 'Guest', value: guestFirst },
            { label: 'Dates', value: nights },
            { label: 'Guests', value: String(input.guests || 1) },
            { label: 'Total', value: '&pound;' + Number(input.total || 0).toFixed(2) },
        ]) +
        button(SITE_URL + '/dashboard/bookings/' + input.bookingId, input.instant ? 'View the booking' : 'Review this request'),
        "You're receiving this because you host on Galloway Getaways. Booking emails can't be switched off."
    );

    return { subject: heading + ' — ' + (input.listingTitle || 'Galloway Getaways'), html };
}
