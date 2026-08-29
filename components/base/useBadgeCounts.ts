'use client';

import { useEffect, useState } from 'react';

// One poller for both menu numbers, however many components ask for them.
//
// WHAT THIS REPLACED. useUnreadCount and usePendingCount each owned an
// interval and a fetch, and three components instantiate them: MenuUnreadDot
// takes both, MessagesLink takes unread, BookingsLink takes pending. So a
// signed-in host with the menu open ran FOUR pollers for TWO numbers. Nobody
// decided that; it is what happens when three components each ask for what
// they need and the asking is cheap.
//
// It stopped being cheap when the count routes started verifying the caller
// with getUser() — a round trip to the auth server per request. Four pollers,
// four round trips, every two minutes.
//
// So the state lives here, at module scope, and the components subscribe to
// it. One interval, one fetch of /api/badges, one verification. That is fewer
// requests than the site made BEFORE the auth change, not merely fewer than
// after it.
//
// MODULE SCOPE, NOT CONTEXT. A provider would have to go in the root layout,
// which is a server component, so it would mean a new client boundary wrapping
// the whole tree to share two integers. This is smaller and the subscription
// is the same shape either way.

const POLL_MS = 120000;

interface Counts {
    unread: number;
    pending: number;
}

let counts: Counts = { unread: 0, pending: 0 };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

const listeners = new Set<(c: Counts) => void>();

// Fired whenever a booking's status changes, so the badge can re-count
// immediately instead of waiting for its next poll. Kept exported from
// usePendingCount as well, because BookingActions imports it from there.
export const BOOKINGS_CHANGED = 'gg:bookings-changed';

export function bookingsChanged(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(BOOKINGS_CHANGED));
    }
}

function publish(next: Counts): void {
    counts = next;
    listeners.forEach((fn) => fn(counts));
}

async function refresh(): Promise<void> {
    // One request at a time. Three components mounting together, plus a
    // visibilitychange, used to mean three or four overlapping fetches of the
    // same thing; sharing the promise makes the extra callers free.
    if (inFlight) return inFlight;

    inFlight = (async () => {
        try {
            const res = await fetch('/api/badges');
            if (!res.ok) return;
            const data = await res.json();
            publish({
                unread: Number(data.unread) || 0,
                pending: Number(data.pending) || 0,
            });
        } catch (err) {
            // A missing badge is not worth surfacing to anyone.
        } finally {
            inFlight = null;
        }
    })();

    return inFlight;
}

function start(): void {
    if (timer) return;

    refresh();
    timer = setInterval(refresh, POLL_MS);

    // Accepting a request is the one moment the badge is certainly wrong, and
    // it is the moment the host is looking straight at it. Waiting up to two
    // minutes to notice reads as the accept not having worked.
    window.addEventListener(BOOKINGS_CHANGED, refresh);

    // A tab left open all day comes back stale — cheaper and more accurate
    // than shortening the interval for everybody.
    document.addEventListener('visibilitychange', onVisible);
}

function onVisible(): void {
    if (document.visibilityState === 'visible') refresh();
}

function stop(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    window.removeEventListener(BOOKINGS_CHANGED, refresh);
    document.removeEventListener('visibilitychange', onVisible);
}

/**
 * Both numbers. `enabled` is false for a signed-out visitor, who would only
 * ever be told nought.
 *
 * The poller runs while at least one component wants it and stops when the
 * last one goes, so navigating away from a page with a menu on it does not
 * leave an interval running.
 */
export default function useBadgeCounts(enabled = true): Counts {
    const [local, setLocal] = useState<Counts>(counts);

    useEffect(() => {
        if (!enabled) return;

        const listener = (c: Counts) => setLocal(c);
        listeners.add(listener);

        // Whatever the last poll found, immediately — a component mounting
        // later should not show nought until the next tick.
        setLocal(counts);
        start();

        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) stop();
        };
    }, [enabled]);

    return enabled ? local : { unread: 0, pending: 0 };
}
