import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { stripeRequest } from '@/lib/stripe';
import { resolveGuestForPaidOrder, supabaseGuestStore } from '@/lib/guestAccount';
import { createRequestOrderFromSession } from '@/lib/requestOrder';
import { notifyTopUpConfirmed } from '@/lib/slotNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Find a succeeded PaymentIntent for a slot order that stored no Stripe id.
//
// A 'holding' slot order never kept a PaymentIntent id — the webhook is what
// writes it, and this reconciliation exists precisely for when that webhook
// never arrived. But if the guest paid, their money is a destination-charge
// PaymentIntent carrying `metadata.order_id`, set by the slot/book route's
// Checkout (`payment_intent_data.metadata`) and the same key the webhook links
// on. So we find the payment by that metadata.
//
// LISTED, NOT SEARCHED, ON PURPOSE. Stripe's Search API lags its index by up to
// a minute — which is the exact "read too early and call a paid order unpaid"
// trap. The List API is read-after-write consistent, so it sees a charge the
// instant it exists. The list is bounded to the hold's own lifetime (a slot
// hold lives ~30 minutes, SLOT_HOLD_MINUTES), which keeps it small. We read the
// PaymentIntent's STATUS, which flips to 'succeeded' synchronously on capture —
// unlike the Transfer and Application Fee objects, which settle a few seconds
// later because on_behalf_of equals the transfer destination. Status is the
// right thing to read here, and it is never late.
async function findPaidPaymentIntent(orderId: string, sinceIso: string): Promise<any | null> {
    // Five-minute buffer before the hold was written, to be safe against clock skew.
    const createdGte = Math.floor(new Date(sinceIso).getTime() / 1000) - 300;
    let startingAfter: string | null = null;
    for (let page = 0; page < 5; page++) {   // up to 500 intents in the window — ample at this scale
        const query: Record<string, any> = { created: { gte: createdGte }, limit: 100 };
        if (startingAfter) query.starting_after = startingAfter;
        const list = await stripeRequest('GET', '/payment_intents', query);
        const data = (list && list.data) || [];
        for (const pi of data) {
            if (pi.status === 'succeeded' && pi.metadata && pi.metadata.order_id === orderId) {
                return pi;
            }
        }
        if (!list || !list.has_more || !data.length) break;
        startingAfter = data[data.length - 1].id;
    }
    return null;
}

// Releases the hold on a guest experience the provider never answered.
//
// A card is held at request and captured on confirm. If the provider does not
// confirm within the window, the hold must be let go — a guest cannot be left
// with money frozen against a chef who went quiet. This cancels the
// authorisation and marks the order expired.
//
// The platform releases the hold on its own terms rather than waiting for
// Stripe's seven-day authorisation to lapse, the same reasoning as an unpaid
// booking's hold. Runs on the cron schedule; guarded by CRON_SECRET, header
// only, fail-closed.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const nowIso = new Date().toISOString();

    const { data: due } = await admin
        .from('service_orders')
        .select('id, stripe_payment_intent_id')
        .eq('status', 'authorised')
        .lt('expires_at', nowIso);

    let released = 0;
    const failures: string[] = [];

    for (const order of due || []) {
        try {
            if (order.stripe_payment_intent_id) {
                // Idempotency-keyed on the order: a hold already released by a
                // decline or a previous sweep does not error the run.
                await stripeRequest(
                    'POST',
                    '/payment_intents/' + order.stripe_payment_intent_id + '/cancel',
                    undefined,
                    'cancel-' + order.id
                );
            }
            await admin
                .from('service_orders')
                .update({ status: 'expired', cancelled_at: nowIso })
                .eq('id', order.id)
                // Only if still authorised — a provider who confirmed in the
                // same minute the sweep ran keeps their booking.
                .eq('status', 'authorised');
            released++;
        } catch (err: any) {
            failures.push(order.id + ': ' + (err && err.message));
        }
    }

    // SLOT HOLDS PAST THEIR WINDOW — reconcile against Stripe before releasing.
    //
    // A slot claims its seat when the guest starts Checkout and writes a
    // 'holding' order; the webhook turns a paid one into 'confirmed', and this
    // sweep releases the seat of one that was never paid. The trap this guards
    // against: a slot charge is captured IMMEDIATELY, so the guest's money
    // splits at Stripe the moment they pay — and if the confirming webhook then
    // fails its signature check (a stale signing secret, the classic one),
    // the order is stuck 'holding' with the money already taken. Expiring it
    // blind frees a seat that was paid for and leaves the guest charged with no
    // booking and the provider paid for nothing.
    //
    // So before expiring, ASK STRIPE whether the money moved. The hold stored no
    // PaymentIntent id — the webhook writes that — but a paid order's
    // PaymentIntent carries metadata.order_id, so findPaidPaymentIntent locates
    // it:
    //
    //   paid   → confirm the order and KEEP the seat. The webhook's outcome,
    //            reached another way. The money already moved; no Stripe act.
    //   unpaid → expire and release the seat, as before.
    //
    // A five-minute grace past expiry keeps the sweep from racing a
    // slightly-late webhook: the Checkout session and the hold both expire at 30
    // minutes (SLOT_HOLD_MINUTES), so a completed payment happened before
    // expiry and is therefore already visible to the List inside
    // findPaidPaymentIntent. Every write is guarded on `status = 'holding'`, so
    // a webhook that confirmed in the meantime is never overwritten and a seat
    // is never wrongly released.
    const graceIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleHolds } = await admin
        .from('service_orders')
        .select('id, parent_order_id, provider_id, provider_business_name, item_name, service_date, service_time, price, slot_session_id, quantity, created_at, guest_id, guest_email, guest_name, guest_phone')
        .eq('status', 'holding')
        .lt('expires_at', graceIso);

    let seatsReleased = 0;
    let reconciled = 0;
    for (const hold of staleHolds || []) {
        try {
            // Did the guest actually pay? If so, the webhook simply never landed
            // — confirm the order and keep the seat rather than expiring paid
            // money. Set the PaymentIntent id too, so a later refund/cancel has
            // the reference the webhook would have written.
            const paid = await findPaidPaymentIntent(hold.id, hold.created_at);
            if (paid) {
                const confirmPatch: Record<string, any> = { status: 'confirmed', stripe_payment_intent_id: paid.id };

                // An anonymous hold has no owner yet — the webhook usually mints
                // it, but this is the path for when the webhook never landed, so
                // mint here too. Without it, confirming a null-owner order would
                // fail the guest_present_once_paid CHECK and leave paid money
                // stuck. The payer address is the receipt email Stripe recorded.
                if (!hold.guest_id) {
                    try {
                        const resolved = await resolveGuestForPaidOrder(supabaseGuestStore(admin), {
                            typedEmail: hold.guest_email,
                            payerEmail: (paid && paid.receipt_email) || hold.guest_email,
                            name: hold.guest_name,
                            phone: hold.guest_phone,
                        });
                        confirmPatch.guest_id = resolved.id;
                    } catch (mintErr: any) {
                        // Leave it 'holding' (money is safe, seat kept) and try
                        // again next pass rather than confirming an ownerless order.
                        failures.push('hold ' + hold.id + ' paid but the guest could not be minted: ' + (mintErr && mintErr.message));
                        continue;
                    }
                }

                const { data: confirmed } = await admin
                    .from('service_orders')
                    .update(confirmPatch)
                    .eq('id', hold.id)
                    .eq('status', 'holding')   // a webhook that won the race keeps its own confirm
                    .select('id');
                if (confirmed && confirmed.length) {
                    reconciled++;
                    // The webhook confirms and notifies; when it never landed and
                    // we confirm here instead, an ADDED place (a per-person top-up)
                    // would otherwise be raised silently. Tell both sides, once —
                    // guarded on the fresh confirm above, so no double-send.
                    if (hold.parent_order_id) {
                        try { await notifyTopUpConfirmed(admin, hold); }
                        catch (notifyErr: any) { failures.push('hold ' + hold.id + ' confirmed but top-up notify failed: ' + (notifyErr && notifyErr.message)); }
                    }
                }
                continue;   // the seat stays taken — it was paid for
            }

            // Genuinely unpaid — release the hold and give the seat back.
            const { data: expired } = await admin
                .from('service_orders')
                .update({ status: 'expired', cancelled_at: nowIso })
                .eq('id', hold.id)
                .eq('status', 'holding')
                .select('id');
            if (expired && expired.length && hold.slot_session_id) {
                const { data: s } = await admin
                    .from('slot_sessions').select('seats_taken').eq('id', hold.slot_session_id).maybeSingle();
                if (s) {
                    await admin.from('slot_sessions')
                        .update({ seats_taken: Math.max(0, s.seats_taken - (hold.quantity || 1)) })
                        .eq('id', hold.slot_session_id);
                }
                seatsReleased++;
            }
        } catch (err: any) {
            failures.push('hold ' + hold.id + ': ' + (err && err.message));
        }
    }

    // REQUEST ORDERS THE WEBHOOK NEVER CREATED — rebuild from Stripe.
    //
    // A request-shape experience (a chef/baker/masseur booked against a stay)
    // holds the card at Checkout and writes NO row until checkout.session.completed
    // arrives — that webhook is the only thing that creates the order. If it never
    // lands (a stale signing secret, a dropped delivery, a transient throw) no row
    // is ever written: the provider is never told, and the hold lapses on its own
    // ~7 days later with the guest believing they booked and nothing anywhere for
    // anyone to notice. The exact fault the slot sweep above guards, one shape
    // along — and the slot path's answer, followed rather than reinvented: ASK
    // STRIPE whether the money moved, then make the record right.
    //
    // ASK STRIPE the way the slot sweep does — LIST PaymentIntents, don't search
    // (the List API is read-after-write consistent; Search lags its index by up
    // to a minute, the exact "read too early and call a paid order unpaid" trap).
    // The held request PI carries the whole order shape in its metadata (the
    // order route puts it on the PaymentIntent as well as the session for exactly
    // this), so a request PI that is held (or captured), is a service_order, and
    // has NO row yet is a lost-webhook order — rebuilt the ONE way the webhook
    // does, createRequestOrderFromSession, from a session-shaped view of the PI.
    //
    // Idempotent on the held PaymentIntent (the helper checks for an existing row
    // and the unique index backstops a race), so a PI the webhook already handled
    // is skipped — and no five-minute grace is needed the way the slot sweep uses
    // one, because rebuilding an order the webhook is about to create is harmless:
    // whichever writes it first, the other no-ops, and the record is the same
    // either way. So catch them as soon as the hold exists. Bounded to the hold's
    // own lifetime (7 days — a manual-capture authorisation lapses then).
    // PaymentIntent STATUS is read directly (requires_capture = held, succeeded =
    // captured) — the authoritative, never-late signal the slot reconcile reads.
    const LOOKBACK_DAYS = 7;
    const createdGte = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60;
    let rebuilt = 0;
    let startingAfter: string | null = null;
    try {
        for (let page = 0; page < 20; page++) {   // up to 2000 intents in the window — ample at this scale
            const query: Record<string, any> = { created: { gte: createdGte }, limit: 100 };
            if (startingAfter) query.starting_after = startingAfter;
            const list = await stripeRequest('GET', '/payment_intents', query);
            const data = (list && list.data) || [];
            for (const pi of data) {
                const md = (pi && pi.metadata) || {};
                if (md.kind !== 'service_order') continue;           // only the request shape
                // Held (or captured) — never a lapsed, cancelled or abandoned PI.
                if (pi.status !== 'requires_capture' && pi.status !== 'succeeded') continue;

                // Already recorded? Then the webhook (or an earlier pass) made it.
                const { data: existing } = await admin
                    .from('service_orders')
                    .select('id')
                    .eq('stripe_payment_intent_id', pi.id)
                    .maybeSingle();
                if (existing) continue;

                // A session-shaped view of the PaymentIntent, so the one order-
                // creation function serves the webhook (real session) and this
                // sweep (PI) alike. guest_email resolves from the profile the
                // metadata names, so receipt_email is only a fallback.
                const synthetic = {
                    metadata: md,
                    payment_intent: pi.id,
                    amount_total: pi.amount,
                    customer_details: { email: pi.receipt_email || null },
                };
                const res = await createRequestOrderFromSession(admin, synthetic);
                if (res.created) rebuilt++;
            }
            if (!list || !list.has_more || !data.length) break;
            startingAfter = data[data.length - 1].id;
        }
    } catch (err: any) {
        failures.push('request rebuild: ' + (err && err.message));
    }

    return NextResponse.json({ ok: true, released, seatsReleased, reconciled, rebuilt, failures });
}
