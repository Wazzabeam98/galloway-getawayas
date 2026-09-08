// The one rule for ordering a guest's trips, so every surface that shows them
// picks the SAME nearest stay. The home card features exactly one trip and the
// trips page leads with one, so when two stays share a check-in date the tie is
// not cosmetic: it decides which stay a guest sees with its door code and
// directions beside it. A comparator that only ever returns -1 or 1 (never 0)
// is inconsistent — it reorders equal-keyed rows unpredictably and defeats a
// stable sort — so this is a PROPER TOTAL comparator with a defined answer for
// every pair: check-in, then check-out, then the booking id as the final,
// always-unique tie-break. Ascending — soonest first.
//
// No imports on purpose: the fields are ISO date strings ('YYYY-MM-DD', which
// sort chronologically as text) and a uuid, so a plain string compare is total
// and this file stays trivially unit-testable.

export type TripOrderFields = {
    id: string;
    check_in: string;
    check_out: string;
};

// Soonest check-in first; ties broken by earlier check-out, then by booking id.
// Returns 0 only when the two are the same booking, so sorting is deterministic
// regardless of the order the rows arrived in.
export function compareTripsByStart(a: TripOrderFields, b: TripOrderFields): number {
    if (a.check_in !== b.check_in) return a.check_in < b.check_in ? -1 : 1;
    if (a.check_out !== b.check_out) return a.check_out < b.check_out ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
}
