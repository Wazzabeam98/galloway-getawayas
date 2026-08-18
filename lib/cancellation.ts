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


// What the guest should actually be told, right now, for these dates.
//
// Printing a "free cancellation until" date only makes sense while that
// date is still in the future. Book a place for tonight on a Moderate
// policy and the full-refund window closed five days ago — so say what
// applies instead of printing a date that has been and gone.
export interface CancellationSummary {
    kind: 'free' | 'partial' | 'none';
    headline: string;
    detail: string;
}

export function cancellationSummary(
    checkIn: string | Date | null | undefined,
    policy: string | null | undefined,
    on?: Date
): CancellationSummary | null {
    if (!checkIn) return null;

    const key = policyOf(policy);
    const until = freeCancelUntil(checkIn, policy);
    const today = on ? new Date(on.getTime()) : new Date();
    today.setHours(0, 0, 0, 0);

    if (until.getTime() > today.getTime()) {
        return {
            kind: 'free',
            headline: 'Free cancellation until ' + formatUk(until),
            detail: 'Cancel before then and you get everything back.',
        };
    }

    const fraction = refundFraction(checkIn, policy, on);

    if (fraction >= 0.5) {
        return {
            kind: 'partial',
            headline: '50% refund if you cancel',
            detail:
                'These dates are inside the host\u2019s ' +
                key.toLowerCase() +
                ' cancellation window, so half of what you pay is refundable.',
        };
    }

    return {
        kind: 'none',
        headline: 'Non-refundable dates',
        detail:
            'These dates are inside the host\u2019s ' +
            key.toLowerCase() +
            ' cancellation window, so payment can\u2019t be refunded if you cancel.',
    };
}

// The date to store on the booking — null when the window has already passed.
export function freeCancelDateOrNull(
    checkIn: string | Date,
    policy: string | null | undefined
): Date | null {
    const until = freeCancelUntil(checkIn, policy);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return until.getTime() > today.getTime() ? until : null;
}
