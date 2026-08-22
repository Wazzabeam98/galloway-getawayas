// How long a host actually waits for their money, in words.
//
// There are two hops and they get conflated constantly:
//
//   1. Galloway releases the host's share into their Stripe balance, the day
//      after their guest checks in. That is ours, and it is the day after.
//   2. Stripe pays that balance out to their bank on the account's schedule,
//      after a settlement delay Stripe sets — not us.
//
// The site used to tell hosts their money landed "within a couple of working
// days", which was the first hop's timing dressed up as the second's. The
// actual `delay_days` on every account checked was 7. New UK accounts start
// cautious and Stripe shortens it as an account builds history, so the honest
// figure is whatever that account says today, not a number written down once.
//
// Hence: nothing here hardcodes a duration. It reads the account and says what
// it finds. The fallback is deliberately vague rather than a guess, because a
// host who is told five days and waits nine has been misled, and this is the
// sentence they will quote back.

import { stripeRequest } from '@/lib/stripe';

// What we do. Always true, never depends on Stripe.
export const RELEASE_SENTENCE =
    'We release your share the day after your guest checks in.';

// Used when we could not read the account — a Stripe outage, or a host who has
// not connected yet. Says roughly the right thing without promising a number.
export const FALLBACK_ARRIVAL_SENTENCE =
    'Stripe then pays it into your bank, which usually takes about a week.';

// 'about a week' reads better than 'about 7 days', and 'the next working day'
// better than 'about 1 day'.
export function arrivalSentence(delayDays: number | null): string {
    if (delayDays === null || delayDays === undefined || isNaN(delayDays)) {
        return FALLBACK_ARRIVAL_SENTENCE;
    }
    if (delayDays <= 0) {
        return 'Stripe then pays it into your bank the same day.';
    }
    if (delayDays === 1) {
        return 'Stripe then pays it into your bank, which usually takes about a day.';
    }
    if (delayDays >= 6 && delayDays <= 8) {
        return 'Stripe then pays it into your bank, which usually takes about a week.';
    }
    return 'Stripe then pays it into your bank, which usually takes about '
        + delayDays + ' days.';
}

// The whole thing, as the two sentences a host should read.
export function payoutTimingText(delayDays: number | null): string {
    return RELEASE_SENTENCE + ' ' + arrivalSentence(delayDays);
}

export interface PayoutSchedule {
    interval: string;
    delayDays: number | null;
    weeklyAnchor: string | null;
    monthlyAnchor: number | null;
}

// Reads the schedule off the connected account. Returns null rather than
// throwing: a payout page that cannot reach Stripe should still render, with
// the vaguer wording, instead of failing whole.
export async function readSchedule(accountId: string): Promise<PayoutSchedule | null> {
    if (!accountId) return null;

    try {
        const account = await stripeRequest('GET', '/accounts/' + accountId);
        const schedule = (account && account.settings && account.settings.payouts
            && account.settings.payouts.schedule) || null;

        if (!schedule) return null;

        const delay = schedule.delay_days;

        return {
            interval: schedule.interval || 'daily',
            delayDays: typeof delay === 'number' ? delay : null,
            weeklyAnchor: schedule.weekly_anchor || null,
            monthlyAnchor: typeof schedule.monthly_anchor === 'number' ? schedule.monthly_anchor : null,
        };
    } catch (err) {
        return null;
    }
}
