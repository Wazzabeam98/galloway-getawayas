// How a listing's cancellation policy READS, with no dates yet — the summary
// and bullets shown in "Things to know". Kept out of lib/cancellation.ts (the
// money path) the way cancellationView is: this only describes the policy, it
// never works out a refund. The bullets mirror the ones in the listing editor
// (CANCELLATION_POLICIES) so a host sees the same words they chose.

import { policyOf, customDaysOf, type PolicyKey, type FixedPolicyKey } from './cancellation';

const POLICY: Record<FixedPolicyKey, { summary: string; bullets: string[] }> = {
    Flexible: {
        summary: 'Free cancellation up to 1 day before check-in.',
        bullets: ['Full refund up to 1 day before check-in', '50% refund inside 1 day of check-in'],
    },
    Moderate: {
        summary: 'Free cancellation up to 5 days before check-in.',
        bullets: ['Full refund up to 5 days before check-in', '50% refund inside 5 days of check-in'],
    },
    Limited: {
        summary: 'Full refund up to 14 days before, then 50% up to 7 days before.',
        bullets: ['Full refund up to 14 days before check-in', '50% refund 7–14 days before', 'No refund inside 7 days'],
    },
    Firm: {
        summary: 'Full refund up to 30 days before, then 50% up to 7 days before.',
        bullets: ['Full refund up to 30 days before check-in', '50% refund 7–30 days before', 'No refund inside 7 days'],
    },
};

// Custom: built from the host's one number, in the same shape as the fixed
// tiers. No 50% band — it is full before the cutoff and nothing within it.
function customDisplay(days: number): { summary: string; bullets: string[] } {
    const d = customDaysOf(days);
    const dd = d + ' day' + (d === 1 ? '' : 's');
    return {
        summary: 'Free cancellation up to ' + dd + ' before check-in.',
        bullets: ['Full refund up to ' + dd + ' before check-in', 'No refund within ' + dd + ' of check-in'],
    };
}

// Always true of every refundable tier, so it belongs in the dialog whatever the
// policy. (A non-refundable booking is a per-booking choice made at checkout, not
// a listing policy, so it never reaches this listing-level display.)
export const CLEANING_FEE_NOTE =
    'Any cleaning fee comes back in full whenever you cancel, because the clean would not take place.';

export function cancellationDisplay(policy: string | null | undefined, customDays?: number | null): {
    key: PolicyKey;
    summary: string;
    bullets: string[];
} {
    const key = policyOf(policy);
    if (key === 'Custom') return { key, ...customDisplay(customDaysOf(customDays)) };
    return { key, ...POLICY[key] };
}
