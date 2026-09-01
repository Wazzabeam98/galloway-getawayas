import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { canTransition, guestMayCancelFree } from '@/lib/serviceOrders';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A guest pulling out of an experience they requested.
//
// TWO CASES, ONE BUTTON.
//
//   authorised — the provider has not answered. The card was only ever held, so
//     cancelling releases the hold and takes nothing. Always allowed.
//   confirmed  — the provider said yes and the card was captured. Cancelling is
//     a refund now, and it follows the provider's own promise: 48 hours or more
//     before the date it is free (full refund); inside that window the guest is
//     pointed to the provider, who can still refund out of goodwill.
//
// getUser(), and the order must be the caller's OWN — a guest may only cancel
// what they booked. The Stripe act happens BEFORE the status is written, so a
// row never reads 'cancelled'/'refunded' while money is still held or taken.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(function () { return {}; });
        const orderId: string = body && body.orderId;
        if (!orderId) {
            return NextResponse.json({ ok: false, error: 'Missing order' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: order } = await admin
            .from('service_orders')
            .select('id, guest_id, status, service_date, stripe_payment_intent_id, provider_business_name')
            .eq('id', orderId)
            .maybeSingle();

        if (!order) {
            return NextResponse.json({ ok: false, error: 'No such booking' }, { status: 404 });
        }
        if (order.guest_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }
        if (!order.stripe_payment_intent_id) {
            return NextResponse.json({ ok: false, error: 'Nothing to cancel.' }, { status: 400 });
        }

        const now = new Date();

        // --- an unanswered request: release the hold -----------------------
        if (order.status === 'authorised') {
            // Idempotency-keyed on the order so a repeated cancel, or a decline
            // landing in the same moment, does not error.
            await stripeRequest(
                'POST',
                '/payment_intents/' + order.stripe_payment_intent_id + '/cancel',
                undefined,
                'cancel-' + order.id
            );
            await admin
                .from('service_orders')
                .update({ status: 'cancelled', cancelled_at: now.toISOString() })
                .eq('id', order.id)
                .eq('status', 'authorised');

            return NextResponse.json({ ok: true, status: 'cancelled' });
        }

        // --- a confirmed booking: a refund, under the 48-hour promise ------
        if (order.status === 'confirmed') {
            if (!canTransition('confirmed', 'refunded')) {
                return NextResponse.json({ ok: false, error: 'That can’t be cancelled.' }, { status: 409 });
            }
            if (!guestMayCancelFree(String(order.service_date), now)) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'That’s within 48 hours of the date, so it’s the provider’s to decide — '
                            + 'message ' + (order.provider_business_name || 'them') + ' and they can still refund you.',
                    },
                    { status: 409 }
                );
            }

            // Reverse the fee and the transfer with the refund, so both our cut
            // and the provider's take come back — the same call proven on test.
            await stripeRequest(
                'POST',
                '/refunds',
                { payment_intent: order.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                'refund-' + order.id
            );
            await admin
                .from('service_orders')
                .update({ status: 'refunded', cancelled_at: now.toISOString() })
                .eq('id', order.id)
                .eq('status', 'confirmed');

            return NextResponse.json({ ok: true, status: 'refunded' });
        }

        return NextResponse.json({ ok: false, error: 'That booking has already ended.' }, { status: 409 });
    } catch (err: any) {
        await logError('services-orders-cancel', { message: String(err && err.message) });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not cancel that' },
            { status: 500 }
        );
    }
}
