// The four cancellation tiers, in words — the single source for both the full
// /cancellation-policy page and the tap-to-open policy pop-up on a reservation,
// so the two can never tell a host and a guest different things. Display copy
// only; the refund maths lives in the watched money path lib/cancellation.ts.

export interface CancellationTier {
    name: string;
    full: string;
    partial: string;
}

export const CANCELLATION_TIERS: CancellationTier[] = [
    // The day counts read exactly as lib/cancellation.ts computes them.
    // `refundFraction` gives a FULL refund at `daysBefore >= fullRefundDaysBefore`,
    // so the full-refund window reaches "up to N days before" — the Nth day
    // before check-in is itself still a full refund (inclusive). The old wording
    // said "more than N days before", which excludes that boundary day the code
    // pays in full, and disagreed with every other surface (the listing editor,
    // the policy pop-up and the host FAQ all say "up to N days before"). The 50%
    // band is named by its two thresholds, 7 and N, the same way the FAQ does.
    {
        name: 'Flexible',
        full: 'Full refund if you cancel up to 1 day before check-in.',
        partial: '50% refund if you cancel within 1 day of check-in.',
    },
    {
        name: 'Moderate',
        full: 'Full refund if you cancel up to 5 days before check-in.',
        partial: '50% refund if you cancel within 5 days of check-in.',
    },
    {
        name: 'Limited',
        full: 'Full refund if you cancel up to 14 days before check-in.',
        partial: '50% refund if you cancel 7 to 14 days before check-in. No refund within 7 days.',
    },
    {
        name: 'Firm',
        full: 'Full refund if you cancel up to 30 days before check-in.',
        partial: '50% refund if you cancel 7 to 30 days before check-in. No refund within 7 days.',
    },
];
