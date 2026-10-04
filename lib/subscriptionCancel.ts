// A trade cancelling their own £20 subscription — at the end of the month they
// have paid for, not today.
//
// Tradesperson Agreement 3.4: "You may cancel at any time. Your listing stays up
// until the end of the period you have paid for. We do not refund part months."
// So cancelling sets Stripe's cancel_at_period_end: nothing more is charged, the
// subscription (and with it the listing) stays live to the period end, and Stripe
// then ends it — customer.subscription.deleted, which the webhook turns into the
// listing coming down. Until that date the trade can change their mind: undoing
// clears cancel_at_period_end and billing carries on as if nothing happened.
//
// Server-side only. Distinct from lib/cancelSubscription.ts, which cancels
// IMMEDIATELY and is for a listing that is already gone (account deactivated,
// admin take-down).

import { stripeRequest } from './stripe';

export interface SubscriptionState {
    status: string;                 // Stripe's own: trialing, active, past_due, …
    cancelAtPeriodEnd: boolean;     // a cancellation is scheduled
    periodEnd: number | null;       // ms — when the paid (or free) period ends
    endsAt: number | null;          // ms — when it will end, if scheduled
}

// Pure: the parts of a Stripe subscription object we show.
export function subscriptionState(sub: any): SubscriptionState {
    // Top-level on the API version stripeRequest pins (2024-06-20); newer versions
    // moved it onto the items, so read either rather than show no date.
    const rawEnd = (sub && sub.current_period_end)
        || (sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
    const periodEnd = rawEnd ? Number(rawEnd) * 1000 : null;
    const cancelAt = sub && sub.cancel_at ? Number(sub.cancel_at) * 1000 : null;
    const scheduled = !!(sub && sub.cancel_at_period_end);
    return {
        status: String((sub && sub.status) || ''),
        cancelAtPeriodEnd: scheduled,
        periodEnd,
        endsAt: scheduled ? (cancelAt || periodEnd) : null,
    };
}

// A subscription that has already ended can't be cancelled or un-cancelled.
export function isLive(state: SubscriptionState): boolean {
    return ['trialing', 'active', 'past_due', 'unpaid', 'incomplete'].indexOf(state.status) !== -1;
}

export async function readSubscription(subscriptionId: string): Promise<SubscriptionState> {
    return subscriptionState(await stripeRequest('GET', '/subscriptions/' + encodeURIComponent(subscriptionId)));
}

// Cancel at period end (cancel=true), or undo that (cancel=false). Returns the
// subscription as Stripe now holds it. Throws on a Stripe error — the caller
// shows it; nothing local is written (the webhook copies Stripe's verdict).
export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<SubscriptionState> {
    const sub = await stripeRequest('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
        cancel_at_period_end: cancel ? 'true' : 'false',
    });
    return subscriptionState(sub);
}

// Pure: whether a subscription Stripe has just deleted was the trade's own
// cancellation coming due (as opposed to Stripe giving up on payment). Stripe
// leaves cancel_at_period_end set on the deleted object and records the reason.
// Read by the webhook, which then clears the dead id so the trade can restart
// through the ordinary billing link later.
export function endedByOwnCancellation(sub: any): boolean {
    if (!sub) return false;
    const reason = sub.cancellation_details && sub.cancellation_details.reason;
    return sub.cancel_at_period_end === true || reason === 'cancellation_requested';
}
