// ---------------------------------------------------------------------------
// WHETHER A STAY CAN BE BOOKED — the listings twin of isLiveToGuests
// ---------------------------------------------------------------------------
//
// Only a 'published' listing takes NEW bookings. 'hidden' covers every way a
// listing comes down — the host's own Hide, an admin moderation hide, and an
// account being deactivated or deleted — and none of them may leave a guest
// with an old link able to book and pay.
//
// Enforced in three places, so it is a gate and not a curtain:
//   * the booking INSERT policy (20261004101500_bookings_insert_requires_published_listing.sql)
//   * the Stripe checkout route, before any session exists
//   * the listing page, which swaps the booking card for NOT_TAKING_BOOKINGS
//
// Bookings that already exist are not touched by any of it: balance payments,
// changes, cancellations, refunds and payouts never ask this question.
export function isListingBookable(listing: { status?: string | null } | null | undefined): boolean {
    return !!listing && listing.status === 'published';
}

// Airbnb's wording for an unlisted place, shared by the page and the server so
// a stale tab that reaches checkout reads the same sentence as the page.
export const NOT_TAKING_BOOKINGS = 'This place isn’t taking bookings right now';

// The same, for a guest experience its provider has paused.
export const EXPERIENCE_NOT_TAKING_BOOKINGS = 'This experience isn’t taking bookings right now';
