import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { stripeRequest } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    // SLOT HOLDS THAT WERE NEVER PAID.
    //
    // A slot claims its seat when the guest starts Checkout and writes a
    // 'holding' order; if they never pay, the seat must come back so the 2pm
    // reopens. There is no PaymentIntent to cancel — a hold stores one only once
    // the webhook confirms it — so this just lets the hold go and gives the seat
    // back.
    //
    // A five-minute grace past expiry, so a genuine payment whose webhook is a
    // little late still wins: the Checkout session expires at the same 15 minutes
    // as the hold, so a completed payment can only have happened before expiry,
    // and the grace keeps the sweep from racing its confirmation. The update is
    // guarded on `status = 'holding'`, so a booking the webhook confirmed in the
    // meantime is never touched, and its seat is never released.
    const graceIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleHolds } = await admin
        .from('service_orders')
        .select('id, slot_session_id, quantity')
        .eq('status', 'holding')
        .lt('expires_at', graceIso);

    let seatsReleased = 0;
    for (const hold of staleHolds || []) {
        try {
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

    return NextResponse.json({ ok: true, released, seatsReleased, failures });
}
