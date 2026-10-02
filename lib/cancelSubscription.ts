// Stop a trade's Stripe subscription. Used when a provider deactivates their
// account: the directory listing comes down, so there is nothing left to bill
// for, and leaving the subscription running would charge a card for a listing
// nobody can see.
//
// Server-side only — it talks to Stripe.
//
// WHY IMMEDIATE, NOT cancel_at_period_end. Deactivation hides the listing now,
// not at the end of the month, so billing has to stop now too; a trade who
// reactivates re-subscribes through the normal billing flow. Cancelling a
// subscription at Stripe is final — it cannot be un-cancelled — which is why
// reactivation never tries to revive it.
//
// The local `subscription_status` is NOT written here. Stripe emits
// customer.subscription.deleted, and the webhook writes 'canceled' from it
// (app/api/stripe/webhook/route.ts), so Stripe stays the one source of truth
// for billing state and there is nothing to reconcile.

import { stripeRequest } from '@/lib/stripe';

export interface CancelSubscriptionResult {
    ok: boolean;
    // 'cancelled' — Stripe accepted it; 'none' — there was nothing to cancel;
    // 'already_gone' — Stripe says this subscription is already cancelled, which
    // is a success, not a failure; 'failed' — a real error to surface.
    outcome: 'cancelled' | 'none' | 'already_gone' | 'failed';
    error?: string;
}

export async function cancelProviderSubscription(
    subscriptionId: string | null | undefined,
): Promise<CancelSubscriptionResult> {
    // A commission provider, a trade still in its free trial, or anyone who
    // never put a card on file has no subscription id. Nothing to do, and that
    // is the ordinary case — not an error.
    if (!subscriptionId) {
        return { ok: true, outcome: 'none' };
    }

    try {
        await stripeRequest('DELETE', '/subscriptions/' + encodeURIComponent(subscriptionId));
        return { ok: true, outcome: 'cancelled' };
    } catch (err: any) {
        // Stripe returns resource_missing / "No such subscription" when the
        // subscription is already cancelled or never existed. For our purpose —
        // "make sure they are not billed" — that end state is exactly what we
        // wanted, so it is a success.
        const code = err && err.stripeCode;
        const status = err && err.stripeStatus;
        if (code === 'resource_missing' || status === 404) {
            return { ok: true, outcome: 'already_gone' };
        }
        return { ok: false, outcome: 'failed', error: (err && err.message) || 'Could not cancel the subscription.' };
    }
}
