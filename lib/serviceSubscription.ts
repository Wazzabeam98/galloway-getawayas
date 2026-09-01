// What a subscription provider is told, when, and what happens if they never
// pay. The rules only — no queries and no Stripe, so the cron, the webhook and
// the tests all read the same answers.
//
// THE SHAPE OF THE PROBLEM
//
// Nobody has a card on file until day ninety. The trial is granted at the
// first enquiry (see trialEndsAt in lib/serviceProviders.ts) and the card is
// asked for near the end of it, which means the reminders are not a courtesy —
// they are the entire mechanism by which anybody ever pays. If the emails do
// not go, the money does not exist.
//
// WHY THE LADDER IS SHAPED LIKE THIS
//
// One email that asks for nothing before any email that asks for something. A
// tradesman who has had ninety free days and then gets a bill out of nowhere
// is a tradesman who leaves; the thirty-day note costs nothing and makes the
// fourteen-day ask expected rather than a surprise.
//
// Everything from seven days out is conditional on there being no card. A
// person who has already done the thing must never be chased for it, which is
// the most common way a ladder like this annoys the people it is aimed at.

import { SUBSCRIPTION_MONTHLY, TRIAL_DAYS } from '@/lib/serviceProviders';

// Where a provider is in the billing story. Mirrors Stripe's own vocabulary on
// purpose: the webhook copies Stripe's status across rather than inventing a
// parallel one, so there is only ever one thing to reconcile.
//
// 'none' is the ordinary state for the entire trial and for every commission
// provider. It is NOT a problem state.
export type SubscriptionStatus =
    | 'none'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'canceled';

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
    'none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled',
];

// Seven days after the free period ends before the listing comes down.
//
// Seven rather than nought because seven more days of a free listing costs
// approximately nothing, and hiding a plumber who was up a roof for a
// fortnight loses him permanently — there are ten providers, not ten thousand.
// Seven rather than forever because a directory that lists people who are not
// paying is one where the model has quietly stopped being true, and nothing
// breaks to tell you.
export const GRACE_DAYS = 7;

export function graceEndsAt(trialEndsAt: string | Date): string {
    const from = trialEndsAt instanceof Date ? trialEndsAt : new Date(String(trialEndsAt));
    const end = new Date(from.getTime());
    end.setUTCDate(end.getUTCDate() + GRACE_DAYS);
    return end.toISOString();
}

// ---------------------------------------------------------------------------
// THE LADDER
// ---------------------------------------------------------------------------
//
// `offset` is days relative to trial_ends_at: negative is before it, positive
// after. `needsCard: true` means the email is only sent to somebody who still
// has not given us one.
//
// `key` is what gets written to reminders_sent, so it must never be reused for
// a different email — a renamed key re-sends to everybody who already had the
// old one.
export interface Reminder {
    key: string;
    offset: number;
    needsCard: boolean;
    subject: string;
    /** Whether this email carries the card link. */
    asks: boolean;
    /**
     * Sent by the enquiry route at the moment the clock is stamped, not by the
     * cron. `remindersDue` never returns one of these — see the note there.
     */
    atFirstEnquiry?: boolean;
}

export const REMINDERS: Reminder[] = [
    {
        // SENT FROM THE ENQUIRY ROUTE, NOT FROM THE CRON.
        //
        // It says "your free period has started today", and it has to be true
        // when he reads it. The cron runs once a day at seven in the morning,
        // so a tradesman whose first enquiry landed at three in the afternoon
        // would read "today" the next morning about something that happened
        // yesterday — which is a small lie in the one email whose whole job is
        // to be believed about a date.
        //
        // So it goes out beside the stamp, in
        // app/api/services/enquiries/route.ts. It is still declared here
        // because its wording lives with the other five and they must not
        // drift apart; `offset` is kept for the same reason and is not read by
        // anything now.
        //
        // There is deliberately no cron fallback. One that fired days later
        // would have to say something other than "today", which means a second
        // wording for the same email — and the failure it would cover is
        // already caught: a provider who never gets this still gets the
        // thirty-day note, and the send failure is in /admin/errors.
        key: 'trial_started',
        offset: -TRIAL_DAYS,
        needsCard: false,
        asks: false,
        atFirstEnquiry: true,
        subject: 'Your free period has started',
    },
    {
        key: 'thirty_days',
        offset: -30,
        needsCard: false,
        asks: false,
        subject: 'A month left of your free listing',
    },
    {
        key: 'fourteen_days',
        offset: -14,
        needsCard: true,
        asks: true,
        subject: 'Time to add a card',
    },
    {
        key: 'seven_days',
        offset: -7,
        needsCard: true,
        asks: true,
        subject: 'A week left of your free listing',
    },
    {
        key: 'one_day',
        offset: -1,
        needsCard: true,
        asks: true,
        subject: 'Your free period ends tomorrow',
    },
    {
        key: 'grace',
        offset: 3,
        needsCard: true,
        asks: true,
        subject: 'Your listing comes down in a few days',
    },
];

export function reminderByKey(key: string): Reminder | null {
    return REMINDERS.filter((r) => r.key === key)[0] || null;
}

// Whether we hold a means of charging them.
//
// The subscription id, not the customer id: a customer exists the moment
// Stripe Checkout opens, and can sit there for ever with no payment method
// behind it. The subscription is what only exists once they finished.
export function hasCard(provider: any): boolean {
    return !!(provider && provider.stripe_subscription_id);
}

// The day an email is due, as a date.
export function dueDate(trialEndsAt: string | Date, offset: number): Date {
    const from = trialEndsAt instanceof Date ? trialEndsAt : new Date(String(trialEndsAt));
    const d = new Date(from.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
}

// Which emails are owed to this provider right now.
//
// Returns every reminder whose day has arrived and which has not already been
// sent — plural, because a cron that missed a day (a bad deploy, an outage)
// must catch up rather than skip. The sends are recorded by key, so catching
// up cannot double-send.
//
// A provider who signs up on day 89 is deliberately NOT sent the thirty- and
// fourteen-day notes retrospectively: `needsCard` filters them out the moment
// a subscription exists, and the two that do not check for a card are the two
// that are harmless to receive late.
export function remindersDue(provider: any, now?: Date): Reminder[] {
    if (!provider) return [];
    if (String(provider.plan || '') !== 'subscription') return [];
    if (String(provider.status || '') !== 'approved') return [];
    if (!provider.trial_ends_at) return [];

    const at = now || new Date();
    const already: string[] = Array.isArray(provider.reminders_sent) ? provider.reminders_sent : [];
    const card = hasCard(provider);

    return REMINDERS.filter((r) => {
        // Sent from the enquiry route at the moment the clock starts, so the
        // cron must never send it — late, it would say "today" about a day
        // that has passed.
        if (r.atFirstEnquiry) return false;
        if (already.indexOf(r.key) !== -1) return false;
        if (r.needsCard && card) return false;
        return dueDate(provider.trial_ends_at, r.offset).getTime() <= at.getTime();
    });
}

// ---------------------------------------------------------------------------
// WHETHER THEY ARE STILL IN THE SHOP WINDOW
// ---------------------------------------------------------------------------
//
// This is deliberately NOT the `status` column. `status` means "an admin has
// looked at this business and decided something about it", and 'hidden' on it
// means "we took it down after a bad edit". Overloading it would lose that
// distinction, and worse, it would collide with the approve route's
// concurrency guard, which writes `.eq('status', expected)` — a row hidden by
// the billing cron would make the next admin decision silently fail.
//
// So non-payment lives in its own column and the two are read together.

// Whether the directory should show them.
//
// Only 'unpaid' hides. past_due does not: Stripe is still retrying, the
// grace period is the human version of the same thing, and a listing that
// flickers out on the first failed card and back on the retry is worse than
// one that waits for the answer.
export function visibleInDirectory(provider: any): boolean {
    if (!provider) return false;
    if (String(provider.status || '') !== 'approved') return false;
    return String(provider.subscription_status || 'none') !== 'unpaid';
}

// Whether the grace period has run out on somebody who never paid.
//
// Three things have to be true: the free period has ended, no card was ever
// given, and the seven days are up. Anybody with a subscription is Stripe's
// problem rather than this function's — a failed payment on a real card is a
// dunning question, not a "did they ever start" one.
export function graceExpired(provider: any, now?: Date): boolean {
    if (!provider) return false;
    if (String(provider.plan || '') !== 'subscription') return false;
    if (String(provider.status || '') !== 'approved') return false;
    if (!provider.trial_ends_at) return false;
    if (hasCard(provider)) return false;
    if (String(provider.subscription_status || 'none') === 'unpaid') return false;

    const at = now || new Date();
    return new Date(graceEndsAt(provider.trial_ends_at)).getTime() <= at.getTime();
}

// What the money is, in words, for an email or a page. One place, so the
// reminder and the card page cannot quote different numbers.
export function priceLine(): string {
    return '£' + SUBSCRIPTION_MONTHLY + ' a month';
}
