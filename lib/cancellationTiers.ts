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
    {
        name: 'Flexible',
        full: 'Full refund if you cancel more than 1 day before check-in.',
        partial: '50% refund if you cancel within 1 day of check-in.',
    },
    {
        name: 'Moderate',
        full: 'Full refund if you cancel more than 5 days before check-in.',
        partial: '50% refund if you cancel within 5 days of check-in.',
    },
    {
        name: 'Limited',
        full: 'Full refund if you cancel more than 14 days before check-in.',
        partial: '50% refund if you cancel 7 to 14 days before check-in. No refund within 7 days.',
    },
    {
        name: 'Firm',
        full: 'Full refund if you cancel more than 30 days before check-in.',
        partial: '50% refund if you cancel 7 to 30 days before check-in. No refund within 7 days.',
    },
];
