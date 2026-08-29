import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { canTransition } from '@/lib/serviceOrders';

export const dynamic = 'force-dynamic';

// A provider answering a guest's request: confirm and the held card is
// captured, decline and the hold is released untaken.
//
// CAPTURE ON CONFIRM. The money moves here and nowhere else on the happy path —
// the guest's card was only held at request. Confirm captures it (and with it
// our application fee and the transfer to the provider, both already set on the
// authorised PaymentIntent). Decline cancels the authorisation and no money is
// taken.
//
// The Stripe act happens BEFORE the status is written, so an order can never
// read 'confirmed' while the money is still only held, nor 'declined' while a
// capture is still standing.
//
// getUser(), verified: this captures a real card, so the provider it acts for
// must be proven, not read from a forgeable cookie.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(function () { return {}; });
        const orderId: string = body && body.orderId;
        const decision: string = body && body.decision;

        if (!orderId || (decision !== 'confirm' && decision !== 'decline')) {
            return NextResponse.json({ ok: false, error: 'Say confirm or decline.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: order } = await admin
            .from('service_orders')
            .select('id, provider_id, status, stripe_payment_intent_id')
            .eq('id', orderId)
            .maybeSingle();

        if (!order) {
            return NextResponse.json({ ok: false, error: 'No such order' }, { status: 404 });
        }

        // The provider on the order has to be one the caller owns.
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id')
            .eq('id', order.provider_id)
            .maybeSingle();

        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your order' }, { status: 403 });
        }

        const target = decision === 'confirm' ? 'confirmed' : 'declined';

        // Only a held order may be answered. A second confirm, or a confirm on
        // an expired order, is refused rather than double-capturing.
        if (!canTransition(order.status as any, target as any)) {
            return NextResponse.json(
                { ok: false, error: 'This request has already been answered or has expired.' },
                { status: 409 }
            );
        }

        if (!order.stripe_payment_intent_id) {
            return NextResponse.json({ ok: false, error: 'No payment to act on.' }, { status: 400 });
        }

        if (decision === 'confirm') {
            // Capture the hold — the money moves now. Idempotency-keyed on the
            // order so a repeated confirm cannot capture twice.
            await stripeRequest(
                'POST',
                '/payment_intents/' + order.stripe_payment_intent_id + '/capture',
                undefined,
                'capture-' + order.id
            );

            await admin
                .from('service_orders')
                .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
                .eq('id', order.id);

            return NextResponse.json({ ok: true, status: 'confirmed' });
        }

        // Decline — release the hold, take nothing.
        await stripeRequest(
            'POST',
            '/payment_intents/' + order.stripe_payment_intent_id + '/cancel',
            undefined,
            'cancel-' + order.id
        );

        await admin
            .from('service_orders')
            .update({ status: 'declined', cancelled_at: new Date().toISOString() })
            .eq('id', order.id);

        return NextResponse.json({ ok: true, status: 'declined' });
    } catch (err: any) {
        console.error('[services/orders/respond]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not answer that' },
            { status: 500 }
        );
    }
}
