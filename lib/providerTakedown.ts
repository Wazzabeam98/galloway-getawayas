// Taking a provider's listing down and putting it back — the owner's own pause
// (owner_paused) and an admin's take-down (admin_hidden_at). Experiences and
// trades both.
//
// Server-side only. Each step that moves money (a trade's subscription) happens
// BEFORE the column flips, and a column write that fails after Stripe has moved
// is undone at Stripe, so a trade is never left hidden-and-billed or
// listed-and-not-billed by a half-finished press.
//
// What a take-down never does: cancel or touch an order, an enquiry or a job.
// Those carry on — the provider still sees them in their dashboard (status stays
// 'approved'), and the guest or host who booked still has them.

import { pauseProviderBilling, resumeProviderBilling } from './providerBilling';
import { cancelProviderSubscription } from './cancelSubscription';
import { REMINDERS, dueDate } from './serviceSubscription';
import { logMoneyFailure } from './moneyAlert';
import { stripeRequest } from './stripe';

export interface TakedownResult {
    ok: boolean;
    status: number;
    error?: string;
    unchanged?: boolean;
    // What happened at Stripe, for the audit trail and the reply.
    billing?: string;
}

// ---------------------------------------------------------------------------
// THE OWNER'S PAUSE
// ---------------------------------------------------------------------------

export async function setOwnerPaused(admin: any, providerId: string, paused: boolean): Promise<TakedownResult> {
    const { data: p, error: readError } = await admin
        .from('service_providers')
        .select('id, owner_paused, stripe_subscription_id')
        .eq('id', providerId)
        .maybeSingle();
    if (readError || !p) return { ok: false, status: 404, error: 'No such listing.' };
    if (!!p.owner_paused === paused) return { ok: true, status: 200, unchanged: true };

    // Money first. Down → stop billing, then hide. Up → restart billing, then
    // show. If Stripe refuses, nothing changes and the trade is told.
    const billing = paused
        ? await pauseProviderBilling(p.stripe_subscription_id)
        : await resumeProviderBilling(p.stripe_subscription_id);
    if (!billing.ok) {
        await logMoneyFailure(
            '[provider pause] Stripe refused to ' + (paused ? 'pause' : 'resume') + ' a trade subscription, so the listing was left as it was',
            { provider_id: providerId, subscription_id: p.stripe_subscription_id, error: billing.error },
            { path: 'lib/providerTakedown' },
        );
        return {
            ok: false,
            status: 502,
            error: paused
                ? 'We couldn’t pause your subscription, so your listing is still up. Please try again.'
                : 'We couldn’t restart your subscription, so your listing is still down. Please try again.',
        };
    }

    const { error } = await admin
        .from('service_providers')
        .update({ owner_paused: paused, updated_at: new Date().toISOString() })
        .eq('id', providerId);

    if (error) {
        // Put Stripe back the way the listing still is.
        const undo = paused
            ? await resumeProviderBilling(p.stripe_subscription_id)
            : await pauseProviderBilling(p.stripe_subscription_id);
        if (!undo.ok) {
            await logMoneyFailure(
                '[provider pause] the listing write failed AND Stripe could not be put back — billing and visibility now disagree',
                { provider_id: providerId, subscription_id: p.stripe_subscription_id, wanted_paused: paused, error: error.message, undo_error: undo.error },
                { path: 'lib/providerTakedown' },
            );
        }
        return { ok: false, status: 500, error: 'Could not save. Please try again.' };
    }

    return { ok: true, status: 200, billing: billing.outcome };
}

// ---------------------------------------------------------------------------
// AN ADMIN'S TAKE-DOWN
// ---------------------------------------------------------------------------

// Down. For a trade, the subscription is CANCELLED, not paused: a take-down is
// ours to lift, not theirs, and there is no telling when or whether it will be,
// so nothing should keep billing for it. The id is cleared off the row once
// Stripe has accepted, so the row stops claiming a subscription that no longer
// exists (and the billing link works again if they are relisted —
// app/api/services/billing refuses anyone holding a subscription id).
export async function adminTakeDown(admin: any, provider: any, nowIso: string): Promise<TakedownResult & { patch?: Record<string, any> }> {
    const cancel = await cancelProviderSubscription(provider.stripe_subscription_id);
    if (!cancel.ok) {
        await logMoneyFailure(
            '[admin take-down] could not cancel a trade subscription, so the listing was left up rather than hidden-and-still-billed',
            { provider_id: provider.id, subscription_id: provider.stripe_subscription_id, error: cancel.error },
            { path: 'lib/providerTakedown' },
        );
        return { ok: false, status: 502, error: 'Stripe would not cancel their subscription, so nothing was changed. Try again.' };
    }

    const patch: Record<string, any> = { admin_hidden_at: nowIso, updated_at: nowIso };
    if (cancel.outcome === 'cancelled' || cancel.outcome === 'already_gone') {
        patch.stripe_subscription_id = null;
        patch.subscription_status = 'canceled';
    }
    return { ok: true, status: 200, billing: cancel.outcome, patch };
}

// Back up. Pure — the rules only, so a test can hold them.
//
// An experience, or a trade we never billed: just lift the take-down.
//
// A trade whose subscription the take-down cancelled (subscription_status
// 'canceled', no subscription id) also goes back on the card ladder —
// deadSubscriptionPatch, below.
export function relistPatch(provider: any, now: Date): Record<string, any> {
    const patch: Record<string, any> = { admin_hidden_at: null, updated_at: now.toISOString() };
    const cancelledByUs = String(provider.plan || '') === 'subscription'
        && !provider.stripe_subscription_id
        && String(provider.subscription_status || '') === 'canceled';
    return cancelledByUs ? { ...patch, ...deadSubscriptionPatch(provider, now) } : patch;
}

// A trade coming back (Relist, or an account reactivated) whose £20
// subscription WE cancelled when the listing came down. A cancelled subscription
// can't be revived, so they re-subscribe through the ordinary card ladder — and
// for that the row must stop holding the dead id (app/api/services/billing
// refuses anyone holding one as "already set up", and the webhook only records a
// new subscription onto a row with none).
//
// If their free period is already over, the clock is set to now, so they get
// the same seven days' grace anybody else gets after the free period — one email
// with the card link at day three, the listing down at day seven if no card.
// Every reminder already due is marked sent, so the cron doesn't fire the whole
// ladder at them in one morning. Pure.
export function deadSubscriptionPatch(provider: any, now: Date): Record<string, any> {
    const nowIso = now.toISOString();
    const patch: Record<string, any> = {
        stripe_subscription_id: null,
        subscription_status: 'none',
        updated_at: nowIso,
    };

    let trialEnd: string | null = provider.trial_ends_at ? String(provider.trial_ends_at) : null;
    if (trialEnd && new Date(trialEnd).getTime() <= now.getTime()) {
        trialEnd = nowIso;
        patch.trial_ends_at = nowIso;
    }

    if (trialEnd) {
        const already: string[] = Array.isArray(provider.reminders_sent) ? provider.reminders_sent.slice() : [];
        for (const r of REMINDERS) {
            if (dueDate(trialEnd, r.offset).getTime() <= now.getTime() && already.indexOf(r.key) === -1) {
                already.push(r.key);
            }
        }
        patch.reminders_sent = already;
    }

    return patch;
}

// ---------------------------------------------------------------------------
// AN ACCOUNT REACTIVATED
// ---------------------------------------------------------------------------
//
// Deactivation cancels a trade's subscription (app/api/account/deactivate). Rows
// deactivated since 4 Oct 2026 have the dead id cleared there and read
// 'canceled'; rows deactivated before still hold the id, which Stripe's
// customer.subscription.deleted marked 'unpaid'. So for a row still holding an
// id, Stripe is asked — and only a subscription Stripe says is gone (canceled,
// or no longer exists) is treated as dead. A trade delisted for never paying
// ('unpaid' and no id) is NOT given a fresh grace: that isn't our cancel.
//
// Returns the patch for each provider that needs one. Never throws on a Stripe
// read failure — that row is left as it was and reported.
export async function reactivationBillingPatches(
    rows: any[],
    now: Date,
): Promise<{ patches: Array<{ id: string; patch: Record<string, any> }>; unread: string[] }> {
    const patches: Array<{ id: string; patch: Record<string, any> }> = [];
    const unread: string[] = [];
    for (const p of rows || []) {
        if (String(p.plan || '') !== 'subscription') continue;
        let dead = false;
        if (!p.stripe_subscription_id) {
            dead = String(p.subscription_status || '') === 'canceled';
        } else {
            try {
                const sub = await stripeRequest('GET', '/subscriptions/' + encodeURIComponent(p.stripe_subscription_id));
                dead = !!sub && (sub.status === 'canceled' || sub.status === 'incomplete_expired');
            } catch (err: any) {
                if ((err && err.stripeCode) === 'resource_missing' || (err && err.stripeStatus) === 404) dead = true;
                else { unread.push(p.id); continue; }
            }
        }
        if (dead) patches.push({ id: p.id, patch: deadSubscriptionPatch(p, now) });
    }
    return { patches, unread };
}
