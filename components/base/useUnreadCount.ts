'use client';

import useBadgeCounts from './useBadgeCounts';

// Shared by the dot on the menu button and the number inside the menu, so the
// two can never disagree about whether there is anything waiting.
//
// Signed-out visitors never ask: the route would only answer nought, and the
// menu button is a login prompt for them.
//
// The polling moved to useBadgeCounts. Three components take one of these two
// hooks and they used to run a poller each — four requests every two minutes
// for two numbers. They now share one fetch of /api/badges. Nothing about how
// this is called changed.
export default function useUnreadCount(enabled = true): number {
    return useBadgeCounts(enabled).unread;
}
