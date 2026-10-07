// Reminding an experience provider to set up payouts — the Airbnb sequence,
// the sibling of lib/payoutReminders (hosts).
//
// An approved provider is live and bookable before their Stripe payouts are
// on; their share of every booking is held until they are (lib/heldPayouts).
// So they're asked, in this order, and every ask stops the moment payouts are
// on:
//
//   1. on approval       — the approval email and the dashboard banner
//   2. first booking     — "You have a booking — set up payouts to be paid"
//   3. money waiting     — the day after their first experience has happened:
//                          "£X is waiting for you"
//   4. every week after  — while money is still waiting
//
// 2–4 are this file, run hourly by /api/cron/experience-payout-reminders. Each
// is sent once: the provider_payout_reminders row (provider_id, kind) is the
// claim, inserted before the email so two runs can't both send. The weekly kind
// carries its week number, counted from the oldest waiting order, so week 1,
// week 2 … are each claimed once.
//
// Pure functions below, so the choosing can be tested without a database.

import { heldSummary, isOwedToProvider, type HeldOrder } from './heldPayouts';

export type ProviderReminderKind = 'first_booking' | 'money_waiting' | `waiting_week_${number}`;

export interface PlannedProviderReminder {
    providerId: string;
    kind: ProviderReminderKind;
    waiting: number;
    upcoming: number;
    // Claimed alongside, without its own email — a provider whose first booking
    // has already happened gets one email (money waiting), not two.
    alsoClaim?: ProviderReminderKind;
}

function daysBetween(fromKey: string, toKey: string): number {
    const a = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
    const b = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
    return Math.round((b - a) / 86400000);
}

/**
 * Which reminders are due now, at most one email per provider.
 *
 * `orders` are the held, unpaid orders of providers WITHOUT payouts.
 * `sent` is the set of "<provider_id>:<kind>" already claimed. `today` is the
 * London day key.
 */
export function planProviderReminders(
    orders: HeldOrder[],
    sent: Set<string>,
    today: string,
): PlannedProviderReminder[] {
    const byProvider = new Map<string, HeldOrder[]>();
    for (const o of orders) {
        if (!isOwedToProvider(o)) continue;
        const list = byProvider.get(o.provider_id) || [];
        list.push(o);
        byProvider.set(o.provider_id, list);
    }

    const plan: PlannedProviderReminder[] = [];
    byProvider.forEach((list, providerId) => {
        const s = heldSummary(list, today);
        if (s.waiting <= 0 && s.upcoming <= 0) return;
        const has = (k: string) => sent.has(providerId + ':' + k);
        const base = { providerId, waiting: s.waiting, upcoming: s.upcoming };

        if (s.waiting > 0 && s.oldestWaiting) {
            // Money is due. The first "money waiting" email, then one a week.
            if (!has('money_waiting')) {
                plan.push({ ...base, kind: 'money_waiting', ...(has('first_booking') ? {} : { alsoClaim: 'first_booking' as const }) });
                return;
            }
            const week = Math.floor(daysBetween(s.oldestWaiting, today) / 7);
            if (week >= 1 && !has('waiting_week_' + week)) {
                plan.push({ ...base, kind: `waiting_week_${week}` });
            }
            return;
        }

        // Only bookings still to come: the first-booking email, once.
        if (!has('first_booking')) plan.push({ ...base, kind: 'first_booking' });
    });
    return plan;
}

const money = (n: number) => '£' + n.toFixed(2);

// The email's subject and paragraphs (plain text; the route escapes them).
export function providerReminderCopy(r: PlannedProviderReminder): { subject: string; paragraphs: string[] } {
    if (r.kind === 'first_booking') {
        return {
            subject: 'You have a booking — set up payouts so we can pay you',
            paragraphs: [
                'A guest has booked and paid. We’re holding your share of ' + money(r.upcoming) + ' for you.',
                'Set up payouts so we can send it to your bank the day after the booking. It takes about five minutes with Stripe.',
            ],
        };
    }
    return {
        subject: money(r.waiting) + ' is waiting for you — set up payouts to receive it',
        paragraphs: [
            money(r.waiting) + ' from bookings that have already happened is waiting for you'
                + (r.upcoming > 0 ? ', with ' + money(r.upcoming) + ' more from bookings still to come.' : '.'),
            'We can’t send it until your payouts are set up. Set them up with Stripe and it goes out on our next daily payout.',
        ],
    };
}
