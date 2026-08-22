'use client';

import { useEffect, useState } from 'react';

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

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [enabled]);

    return pending;
}
