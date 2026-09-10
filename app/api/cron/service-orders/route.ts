import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { stripeRequest } from '@/lib/stripe';

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
        .select('id, slot_session_id, quantity, created_at')
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
                const { data: confirmed } = await admin
                    .from('service_orders')
                    .update({ status: 'confirmed', stripe_payment_intent_id: paid.id })
                    .eq('id', hold.id)
                    .eq('status', 'holding')   // a webhook that won the race keeps its own confirm
                    .select('id');
                if (confirmed && confirmed.length) reconciled++;
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

    return NextResponse.json({ ok: true, released, seatsReleased, reconciled, failures });
}
