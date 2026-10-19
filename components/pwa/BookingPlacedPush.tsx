'use client';

// On /booking-confirmed: tells the notification layer a paid booking has
// landed, so the host gets a push (and an Instant-Book guest a "You're
// booked"). The route checks the booking is paid and pushes once per booking,
// however often this page is reloaded. Then offers the guest notifications —
// booking is exactly the moment they are worth asking for.

import { useEffect } from 'react';
import PushPrompt from './PushPrompt';

export default function BookingPlacedPush({ bookingId }: { bookingId: string }) {
    useEffect(() => {
        fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'booking_placed', bookingId }),
        }).catch(() => { /* a push is never worth an error on this page */ });
    }, [bookingId]);

    return <PushPrompt context="booking" className="mt-8" />;
}
