// Pausing and resuming a trade's £20 subscription while their listing is down.
//
// Server-side only — it talks to Stripe. The sibling of cancelSubscription.ts:
// that one is for a listing that is gone (account deactivated, admin take-down);
// this one is for a listing the trade took down themselves and can put back up
// in one press, so the subscription must come back with it rather than be
// re-bought.
//
// HOW. Stripe's pause_collection with behavior 'void': the subscription stays,
// but every invoice it would raise while paused is voided, so the card is not
// charged for the weeks nobody could see them. Resuming clears pause_collection
// and billing carries on from the next period. Stripe's own status stays
// 'active' throughout, so the webhook's copy (subscription_status) doesn't move
// and nothing has to be reconciled — the listing's visibility is owner_paused's
// job, not the billing status's.
//
// No idempotency key: pausing or resuming sets a state rather than moving money,
// so a repeat lands on the same state (and the house rule is about keys on
// charges).

import { stripeRequest } from './stripe';

export interface BillingPauseResult {
    ok: boolean;
    // 'paused' / 'resumed' — Stripe accepted it; 'none' — no subscription (a
    // trade still in the free period, or an experience, which pays commission);
    // 'already_gone' — Stripe says the subscription no longer exists, so there is
    // nothing to bill or stop billing; 'failed' — a real error to surface.
    outcome: 'paused' | 'resumed' | 'none' | 'already_gone' | 'failed';
    error?: string;
}

async function setPause(subscriptionId: string | null | undefined, pause: boolean): Promise<BillingPauseResult> {
    if (!subscriptionId) return { ok: true, outcome: 'none' };
    try {
        await stripeRequest('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
            // An empty value is how Stripe's form API unsets a field.
            pause_collection: pause ? { behavior: 'void' } : '',
        });
        return { ok: true, outcome: pause ? 'paused' : 'resumed' };
    } catch (err: any) {
        if ((err && err.stripeCode) === 'resource_missing' || (err && err.stripeStatus) === 404) {
            return { ok: true, outcome: 'already_gone' };
        }
        return { ok: false, outcome: 'failed', error: (err && err.message) || 'Could not change the subscription.' };
    }
}

export function pauseProviderBilling(subscriptionId: string | null | undefined): Promise<BillingPauseResult> {
    return setPause(subscriptionId, true);
}

export function resumeProviderBilling(subscriptionId: string | null | undefined): Promise<BillingPauseResult> {
    return setPause(subscriptionId, false);
}
