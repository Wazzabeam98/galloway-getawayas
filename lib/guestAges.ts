// The party age bands, and who a provider's minimum age lets in.
//
// The bands are FIXED across the whole app, Airbnb-style: an adult is 13 or over,
// a child is 4–12 (under-4s aren't a booked head). They are not a per-provider
// setting — every experience uses the same two buckets. What IS per-provider is
// the MINIMUM AGE a guest must be to take part (service_providers.guest_details
// .min_age: null, or one of 12 / 16 / 18 / 21), set on the listing.
//
// A child can only take part when the provider's minimum age doesn't rise above
// the oldest child. So a minimum of 12 still admits children (a 12-year-old
// qualifies), but 16/18/21 rules the whole 4–12 band out — those experiences take
// adults only, and the children stepper (and the "Add children" link) must not
// appear at all, rather than appear disabled.

export const ADULT_MIN_AGE = 13;
export const CHILD_MIN_AGE = 4;
export const CHILD_MAX_AGE = 12;

/** True when this provider's minimum age still admits at least the oldest child. */
export function childrenAllowed(minAge: number | null | undefined): boolean {
    if (minAge == null) return true;
    return Number(minAge) <= CHILD_MAX_AGE;
}
