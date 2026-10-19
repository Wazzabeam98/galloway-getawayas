// The words on each push notification, in one place.
//
// Short, the way Airbnb's are: who, where, when — the email carries the rest.
// No prices and no addresses: a notification shows on a lock screen.

import type { PushMessage } from './push';
import { ukDate } from './dayKey';

function dates(checkIn: string, checkOut: string): string {
    const a = ukDate(String(checkIn || '').slice(0, 10));
    const b = ukDate(String(checkOut || '').slice(0, 10));
    return a && b ? a + ' – ' + b : '';
}

/** The host: a guest has booked (Instant Book) or asked to book. */
export function hostNewBookingPush(input: {
    bookingId: string;
    guestFirst: string;
    listingTitle: string;
    checkIn: string;
    checkOut: string;
    instant: boolean;
}): PushMessage {
    const when = dates(input.checkIn, input.checkOut);
    return {
        title: input.instant ? 'New booking' : 'New booking request',
        body: (input.instant ? input.guestFirst + ' booked ' : input.guestFirst + ' would like to book ')
            + input.listingTitle + (when ? ', ' + when : ''),
        url: '/dashboard/bookings/' + input.bookingId,
        tag: 'booking-' + input.bookingId,
    };
}

/** The guest: their booking is confirmed. */
export function guestConfirmedPush(input: {
    bookingId: string;
    listingTitle: string;
    checkIn: string;
    checkOut: string;
}): PushMessage {
    const when = dates(input.checkIn, input.checkOut);
    return {
        title: 'You’re booked',
        body: 'Your stay at ' + input.listingTitle + ' is confirmed' + (when ? ', ' + when : '') + '.',
        url: '/trips',
        tag: 'confirmed-' + input.bookingId,
    };
}

/** Either party: a new message on a booking. */
export function newMessagePush(input: {
    bookingId: string;
    senderFirst: string;
    preview: string;
}): PushMessage {
    return {
        title: input.senderFirst,
        body: String(input.preview || '').trim() || 'Sent you a message',
        url: '/messages/' + input.bookingId,
        tag: 'message-' + input.bookingId,
    };
}
