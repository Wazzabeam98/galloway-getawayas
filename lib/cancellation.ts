// The four cancellation tiers, in one place, so the booking widget, the
// payment routes and any refund calculation can never disagree.
//
// These mirror the wording shown in the listing editor.

export type PolicyKey = 'Flexible' | 'Moderate' | 'Limited' | 'Firm';

interface PolicyRule {
    fullRefundDaysBefore: number;   // full refund up to this many days before check-in
    halfRefundDaysBefore: number;   // 50% refund down to this many days before
}

const RULES: Record<PolicyKey, PolicyRule> = {
    Flexible: { fullRefundDaysBefore: 1, halfRefundDaysBefore: 0 },
    Moderate: { fullRefundDaysBefore: 5, halfRefundDaysBefore: 0 },
    Limited: { fullRefundDaysBefore: 14, halfRefundDaysBefore: 7 },
    Firm: { fullRefundDaysBefore: 30, halfRefundDaysBefore: 7 },
};

export function policyOf(value: string | null | undefined): PolicyKey {
    if (value === 'Flexible' || value === 'Moderate' || value === 'Limited' || value === 'Firm') {
        return value;
    }
    return 'Moderate';
}

// The last date a guest can cancel and get everything back.
export function freeCancelUntil(checkIn: string | Date, policy: string | null | undefined): Date {
    const date = typeof checkIn === 'string' ? new Date(checkIn) : new Date(checkIn.getTime());
    date.setDate(date.getDate() - RULES[policyOf(policy)].fullRefundDaysBefore);
    date.setHours(0, 0, 0, 0);
    return date;
}

// What proportion of what they've paid comes back, cancelling today.
export function refundFraction(
    checkIn: string | Date,
    policy: string | null | undefined,
    on?: Date
): number {
    const rule = RULES[policyOf(policy)];
    const today = on ? new Date(on.getTime()) : new Date();
    today.setHours(0, 0, 0, 0);

    const start = typeof checkIn === 'string' ? new Date(checkIn) : new Date(checkIn.getTime());
    start.setHours(0, 0, 0, 0);

    const daysBefore = Math.round((start.getTime() - today.getTime()) / 86400000);

    if (daysBefore >= rule.fullRefundDaysBefore) return 1;
    if (daysBefore >= rule.halfRefundDaysBefore) return 0.5;
    return 0;
}

export function formatUk(date: Date): string {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
