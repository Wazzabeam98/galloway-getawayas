// The payout-schedule choice a host or provider sends — the rules the host's
// /api/stripe/payout-schedule applies, as one function the experience
// provider's /api/services/payout-settings runs too (and tests can reach).
// Only the anchor that belongs to the chosen interval goes up: Stripe rejects a
// weekly_anchor on a monthly schedule outright.

export const PAYOUT_INTERVALS = ['daily', 'weekly', 'monthly'];
export const PAYOUT_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// What WE do for an experience: release the provider's share the day after the
// experience (app/api/cron/experience-payouts). The host's equivalent is
// lib/payoutTiming RELEASE_SENTENCE ("…the day after your guest checks in").
export const PROVIDER_RELEASE_SENTENCE = 'We release your share the day after the experience.';

export function scheduleFromBody(body: any):
    { ok: true; schedule: Record<string, any> } | { ok: false; error: string } {
    const interval = String((body && body.interval) || '');
    if (PAYOUT_INTERVALS.indexOf(interval) === -1) return { ok: false, error: 'Choose daily, weekly or monthly.' };
    const schedule: Record<string, any> = { interval };
    if (interval === 'weekly') {
        const day = String((body && body.weekly_anchor) || 'friday').toLowerCase();
        if (PAYOUT_WEEKDAYS.indexOf(day) === -1) return { ok: false, error: 'Pick a day of the week.' };
        schedule.weekly_anchor = day;
    }
    if (interval === 'monthly') {
        const d = parseInt(String((body && body.monthly_anchor) || '1'), 10);
        // 29th–31st don't exist in every month, and Stripe refuses them.
        if (isNaN(d) || d < 1 || d > 28) return { ok: false, error: 'Pick a date from 1 to 28 — later dates do not exist in every month.' };
        schedule.monthly_anchor = d;
    }
    return { ok: true, schedule };
}
