'use client';

import useBadgeCounts from './useBadgeCounts';

// Booking requests waiting on this host. Shared by the dot on the menu button
// and the number on the Bookings line, so the two can never disagree — the
// same arrangement useUnreadCount has for messages.
//
// Only hosts are asked for. For everyone else the count is nought and there is
// no Bookings line in their menu to put it on.
//
// The polling moved to useBadgeCounts — see the note there about four pollers
// fetching two numbers. Nothing about how this is called changed.
export { BOOKINGS_CHANGED, bookingsChanged } from './useBadgeCounts';

export default function usePendingCount(enabled = true): number {
    return useBadgeCounts(enabled).pending;
}
