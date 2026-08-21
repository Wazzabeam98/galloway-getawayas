'use client';

import { useEffect, useState } from 'react';

// Shared by the dot on the menu button and the number inside the menu, so the
// two can never disagree about whether there is anything waiting.
//
// Signed-out visitors never ask: the route would only answer nought, and the
// menu button is a login prompt for them.
export default function useUnreadCount(enabled = true) {
    const [unread, setUnread] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;

        const check = async () => {
            try {
                const res = await fetch('/api/messages/unread-count');
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!cancelled) setUnread(data.unread || 0);
            } catch (err) {
                // A missing badge is not worth surfacing to anyone.
            }
        };

        check();

        // Someone leaves a tab open all day; a check every couple of minutes
        // keeps the number roughly honest without hammering anything.
        const timer = setInterval(check, 120000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [enabled]);

    return unread;
}
