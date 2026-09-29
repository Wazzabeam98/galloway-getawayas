// Reminding a host to add a payout method — the Airbnb sequence.
//
// A listing is live and bookable the moment it's approved, whether or not its
// host has set up payouts. Their money is held until they do (the payout run
// skips a host with no payouts, retries every day, and pays on the first run
// after Stripe enables them). So they're asked, in this order:
//
//   1. on approval         — the approval email and a dashboard banner
//                            (app/api/admin/listings/decide, app/dashboard)
//   2. first booking       — "You have a booking — add a payout method"
//   3. before that check-in — "Your guest arrives on … — add a payout method"
//
// 2 and 3 are this file, run hourly by /api/cron/payout-reminders. Both are
// about the host's FIRST booking, as the brief says, and both stop the moment
// payouts are on. Each is sent once: the host_payout_reminders row is the claim.
//
// Pure functions below, so the choosing can be tested without a database.

export type ReminderKind = 'booking' | 'before_check_in';

// How close to check-in the second reminder goes: three days out, the same
// window the check-in message floor uses.
export const BEFORE_CHECK_IN_DAYS = 3;

export interface ReminderBooking {
    id: string;
    host_id: string;
    check_in: string; // YYYY-MM-DD
    created_at: string;
}

export interface PlannedReminder {
    booking: ReminderBooking;
    kind: ReminderKind;
    // Claimed alongside the one sent, without its own email — when a first
    // booking is made inside the before-check-in window, one email covers both.
    alsoClaim?: ReminderKind;
}

function daysBetween(fromKey: string, toKey: string): number {
    const a = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
    const b = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
    return Math.round((b - a) / 86400000);
}

/**
 * Which reminders are due now.
 *
 * `bookings` are the confirmed bookings of hosts WITHOUT payouts (every one,
 * past too — "first" means first ever). `sent` is the set of
 * "<booking_id>:<kind>" already claimed. `today` is the London day key.
 */
export function planReminders(
    bookings: ReminderBooking[],
    sent: Set<string>,
    today: string,
): PlannedReminder[] {
    const firstByHost = new Map<string, ReminderBooking>();
    for (const b of bookings) {
        const current = firstByHost.get(b.host_id);
        if (!current || b.created_at < current.created_at) firstByHost.set(b.host_id, b);
    }

    const out: PlannedReminder[] = [];
    firstByHost.forEach((b) => {
        const until = daysBetween(today, String(b.check_in).slice(0, 10));
        if (until < 0) return; // the stay has begun — nothing left to remind about
        const bookingDone = sent.has(b.id + ':booking');
        const checkInDone = sent.has(b.id + ':before_check_in');
        const inWindow = until <= BEFORE_CHECK_IN_DAYS;

        if (!bookingDone) {
            out.push(inWindow && !checkInDone
                ? { booking: b, kind: 'booking', alsoClaim: 'before_check_in' }
                : { booking: b, kind: 'booking' });
            return;
        }
        if (inWindow && !checkInDone) out.push({ booking: b, kind: 'before_check_in' });
    });
    return out;
}

export interface ReminderCopy {
    subject: string;
    paragraphs: string[];
}

// The words. Plain, and true to what the code does: the money is held, not
// lost, and goes out on the first payout run after payouts are enabled.
export function reminderCopy(kind: ReminderKind, listingTitle: string, checkInLabel: string): ReminderCopy {
    if (kind === 'booking') {
        return {
            subject: 'You have a booking — add a payout method to get paid',
            paragraphs: [
                `Good news: you have a booking at ${listingTitle}, checking in ${checkInLabel}.`,
                'To get paid for it, add a payout method — it takes about five minutes with Stripe, our payments partner. We pay you the day after your guest checks in.',
                'Until you add one, we hold your payout safely and send it as soon as you do.',
            ],
        };
    }
    return {
        subject: `Your guest arrives ${checkInLabel} — add a payout method`,
        paragraphs: [
            `Your guest checks in to ${listingTitle} ${checkInLabel}, and we pay you the day after.`,
            'You haven’t added a payout method yet, so we can’t send your money. Add one now and your payout goes out on time.',
            'Until you do, we hold it safely for you.',
        ],
    };
}
