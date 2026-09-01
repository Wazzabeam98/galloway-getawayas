import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { canTransition } from '@/lib/serviceOrders';
import { sendEmail, emailLayout, escapeHtml, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

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
// What the guest hears back. They authorised a hold and then, until now, were
// told nothing when it turned into a charge or was let go. Both are worth an
// email, and the money one especially: a card charged with no word is how a
// £180 line item becomes a dispute.
async function notifyGuest(order: any, outcome: 'confirmed' | 'declined' | 'refunded'): Promise<void> {
    const to = String(order.guest_email || '').trim();
    if (!to) return;

    const who = escapeHtml(order.provider_business_name || 'your experience');
    const date = escapeHtml(String(order.service_date || ''));
    const amount = '£' + Number(order.price || 0).toFixed(2);

    let subject: string;
    let html: string;

    if (outcome === 'refunded') {
        subject = 'You’ve been refunded for ' + (order.provider_business_name || 'your experience');
        html = emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;"><strong>' + who
            + '</strong> has cancelled your booking for <strong>' + date + '</strong> and refunded you '
            + escapeHtml(amount) + ' in full.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">The money is on its way back to your card. '
            + 'You’re welcome to book another experience for your stay.</p>',
            'You’re receiving this because you booked an experience through Galloway Getaways.'
        );
    } else if (outcome === 'confirmed') {
        subject = 'Your booking with ' + (order.provider_business_name || 'your experience') + ' is confirmed';
        html = emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">Good news — <strong>' + who
            + '</strong> has confirmed your booking for <strong>' + date + '</strong>.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Your card has now been charged '
            + escapeHtml(amount) + '. They are expecting you; they will be in touch to sort the details.</p>',
            'You’re receiving this because you booked an experience through Galloway Getaways.'
        );
    } else {
        subject = 'About your booking with ' + (order.provider_business_name || 'your experience');
        html = emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">Unfortunately <strong>' + who
            + '</strong> can’t make <strong>' + date + '</strong>.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Nothing has been charged — the hold on your card '
            + 'has been released. You’re welcome to try another experience for your stay.</p>',
            'You’re receiving this because you requested an experience through Galloway Getaways.'
        );
    }

    try {
        const sent = await sendEmail(to, subject, html);
        if (!sent) await logError('service-order-guest-email', { order: order.id, outcome, to });
    } catch (err: any) {
        await logError('service-order-guest-email', { order: order.id, outcome, message: String(err && err.message) });
    }
}

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

        if (!orderId || (decision !== 'confirm' && decision !== 'decline' && decision !== 'refund')) {
            return NextResponse.json({ ok: false, error: 'Say confirm, decline or refund.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: order } = await admin
            .from('service_orders')
            .select('id, provider_id, status, stripe_payment_intent_id, guest_email, guest_name, service_date, price, provider_business_name')
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

        // A PROVIDER REFUNDING A BOOKING THEY CONFIRMED.
        //
        // The guest's own cancel is free 48 hours out and points to the provider
        // inside that window; this is the provider keeping that promise — a
        // goodwill refund on a confirmed booking, at any time, their call. The
        // guest is told. confirmed → refunded is the only transition allowed
        // here, so a request or a declined order cannot be "refunded".
        if (decision === 'refund') {
            if (!order.stripe_payment_intent_id) {
                return NextResponse.json({ ok: false, error: 'No payment to refund.' }, { status: 400 });
            }
            if (!canTransition(order.status as any, 'refunded' as any)) {
                return NextResponse.json(
                    { ok: false, error: 'Only a confirmed booking can be refunded.' },
                    { status: 409 }
                );
            }
            await stripeRequest(
                'POST',
                '/refunds',
                { payment_intent: order.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                'refund-' + order.id
            );
            await admin
                .from('service_orders')
                .update({ status: 'refunded', cancelled_at: new Date().toISOString() })
                .eq('id', order.id)
                .eq('status', 'confirmed');

            await notifyGuest(order, 'refunded');

            return NextResponse.json({ ok: true, status: 'refunded' });
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

            // Tell the guest their card has now been charged and the evening is
            // on. Until now they heard nothing back after requesting — the money
            // moved in silence. Best-effort: the booking stands whether or not
            // the mail sends, but a failure is reported, not swallowed.
            await notifyGuest(order, 'confirmed');

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

        // Tell the guest the provider could not take it and their card was
        // released — so a pending hold vanishing is explained, not a mystery.
        await notifyGuest(order, 'declined');

        return NextResponse.json({ ok: true, status: 'declined' });
    } catch (err: any) {
        console.error('[services/orders/respond]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not answer that' },
            { status: 500 }
        );
    }
}
