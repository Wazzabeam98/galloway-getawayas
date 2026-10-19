// The three test notifications on /admin/notifications.
//
// Built by the same functions the real ones use (lib/pushMessages), so the
// wording on the phone is exactly what a host or guest would see — with made-up
// details, "TEST" at the front of the title, and a tap that opens the admin
// page rather than a booking that doesn't exist. Nothing here reads or writes a
// booking, a message or a payment.

import type { PushMessage } from './push';
import { hostNewBookingPush, newMessagePush, guestConfirmedPush } from './pushMessages';

export const TEST_PUSH_KINDS = ['new_booking', 'new_message', 'booking_confirmed'] as const;
export type TestPushKind = typeof TEST_PUSH_KINDS[number];

export const TEST_PUSH_LABELS: Record<TestPushKind, string> = {
    new_booking: 'Host: new booking',
    new_message: 'New message',
    booking_confirmed: 'Guest: booking confirmed',
};

const FAKE = {
    bookingId: 'test',
    guestFirst: 'Morag',
    hostFirst: 'Callum',
    listingTitle: 'Rowan Cottage (test)',
    checkIn: '2026-12-11',
    checkOut: '2026-12-14',
};

export function isTestPushKind(value: unknown): value is TestPushKind {
    return typeof value === 'string' && (TEST_PUSH_KINDS as readonly string[]).includes(value);
}

export function testPush(kind: TestPushKind): PushMessage {
    const real: PushMessage =
        kind === 'new_booking'
            ? hostNewBookingPush({ ...FAKE, instant: true })
            : kind === 'new_message'
                ? newMessagePush({ bookingId: FAKE.bookingId, senderFirst: FAKE.hostFirst, preview: 'Hi Morag, the key safe code will come the day before you arrive. See you on the 11th!' })
                : guestConfirmedPush(FAKE);
    return {
        ...real,
        title: 'TEST ' + real.title,
        url: '/admin/notifications',
        tag: 'test-' + kind,
    };
}
