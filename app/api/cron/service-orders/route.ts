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

    return NextResponse.json({ ok: true, released, failures });
}
