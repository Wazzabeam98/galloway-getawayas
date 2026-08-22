'use client';

import { useEffect, useState } from 'react';

// Fired whenever a booking's status changes, so the badge can re-count
// immediately instead of waiting for its next poll.
export const BOOKINGS_CHANGED = 'gg:bookings-changed';

export function bookingsChanged(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(BOOKINGS_CHANGED));
    }
}

// Booking requests waiting on this host. Shared by the dot on the menu button
// and the number on the Bookings line, so the two can never disagree — the
// same arrangement useUnreadCount has for messages.
//
// Only hosts are asked. For everyone else the route would answer nought on
// every page, and there is no Bookings line in their menu to put it on.
export default function usePendingCount(enabled = true) {
    const [pending, setPending] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;

        const check = async () => {
            try {
                const res = await fetch('/api/bookings/pending-count');
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!cancelled) setPending(data.pending || 0);
            } catch (err) {
                // A missing badge is not worth surfacing to anyone.
            }
        };

        check();

        // Same cadence as the message count. A request is urgent in the sense
        // that it should not sit for a day, not in the sense that two minutes
        // matters.
        const timer = setInterval(check, 120000);

        // Accepting a request is the one moment the badge is certainly wrong,
        // and it is the moment the host is looking straight at it. Waiting up
        // to two minutes to notice reads as the accept not having worked.
        // BookingActions fires this the instant the booking changes.
        const onChanged = () => check();
        window.addEventListener(BOOKINGS_CHANGED, onChanged);

        // A tab left open all day comes back stale — cheaper and more accurate
        // than shortening the interval for everybody.
        const onVisible = () => {
            if (document.visibilityState === 'visible') check();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            cancelled = true;
            clearInterval(timer);
            window.removeEventListener(BOOKINGS_CHANGED, onChanged);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled]);

    return pending;
}
