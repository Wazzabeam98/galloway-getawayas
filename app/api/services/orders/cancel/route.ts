import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { canTransition } from '@/lib/serviceOrders';
import { guestMayCancelFree, shapeOf } from '@/lib/serviceSlots';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A guest pulling out of an experience.
//
// THREE CASES, ONE BUTTON.
//
//   authorised — a request the provider has not answered. The card was only
//     held, so cancelling releases the hold and takes nothing.
//   holding    — a slot the guest started paying for but has not finished. The
//     seat was claimed; give it back and let the hold go. Nothing was charged.
//   confirmed  — the provider said yes (or the slot was paid) and the card was
//     captured. Cancelling is a refund, under the provider's policy, which is
//     SHAPE-AWARE: days before the date for a cake or a chef, hours before the
//     time for a slot. Before the cutoff it is a full refund; inside it, it is
//     the provider's to decide. A slot's seat is released on a refund so the
//     time reopens.
//
// getUser(), the order must be the caller's own, and the Stripe act happens
// before the status is written, so a row never reads 'refunded' while money is
// still taken.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const orderId: string = body && body.orderId;
        if (!orderId) return NextResponse.json({ ok: false, error: 'Missing order' }, { status: 400 });

        const admin = adminClient();

        const { data: order } = await admin
            .from('service_orders')
            .select('id, guest_id, provider_id, status, shape, service_date, service_time, quantity, slot_session_id, stripe_payment_intent_id, provider_business_name')
            .eq('id', orderId)
            .maybeSingle();

        if (!order) return NextResponse.json({ ok: false, error: 'No such booking' }, { status: 404 });
        if (order.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const now = new Date();
        const shape = shapeOf(order);

        // Give a slot's seat back — decrement the session it was claimed against.
        const releaseSeat = async () => {
            if (!order.slot_session_id) return;
            const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', order.slot_session_id).maybeSingle();
            if (s) {
                await admin.from('slot_sessions')
                    .update({ seats_taken: Math.max(0, s.seats_taken - (order.quantity || 1)) })
                    .eq('id', order.slot_session_id);
            }
        };

        // --- a slot part-way through Checkout: release the seat ------------
        if (order.status === 'holding') {
            const { data: done } = await admin
                .from('service_orders').update({ status: 'cancelled', cancelled_at: now.toISOString() })
                .eq('id', order.id).eq('status', 'holding').select('id');
            if (done && done.length) await releaseSeat();
            return NextResponse.json({ ok: true, status: 'cancelled' });
        }

        // --- an unanswered request: release the card hold ------------------
        if (order.status === 'authorised') {
            if (!order.stripe_payment_intent_id) return NextResponse.json({ ok: false, error: 'Nothing to cancel.' }, { status: 400 });
            await stripeRequest('POST', '/payment_intents/' + order.stripe_payment_intent_id + '/cancel', undefined, 'cancel-' + order.id);
            await admin.from('service_orders').update({ status: 'cancelled', cancelled_at: now.toISOString() })
                .eq('id', order.id).eq('status', 'authorised');
            return NextResponse.json({ ok: true, status: 'cancelled' });
        }

        // --- a confirmed booking: a refund, under the shape-aware policy ---
        if (order.status === 'confirmed') {
            if (!order.stripe_payment_intent_id) return NextResponse.json({ ok: false, error: 'Nothing to cancel.' }, { status: 400 });
            if (!canTransition('confirmed', 'refunded')) {
                return NextResponse.json({ ok: false, error: 'That can’t be cancelled.' }, { status: 409 });
            }

            // The provider's window (not yet snapshotted onto the order — the
            // cancellation-tiers work does that; for now read it live).
            const { data: prov } = await admin
                .from('service_providers').select('cancellation_window_hours').eq('id', order.provider_id).maybeSingle();
            const windowHours = Number(prov && prov.cancellation_window_hours) || 48;

            if (!guestMayCancelFree(shape, String(order.service_date), order.service_time || null, windowHours, now)) {
                const withinMsg = shape === 'slot'
                    ? 'That’s inside the cancellation window for this time, so it’s ' + (order.provider_business_name || 'the provider') + '’s to decide — message them and they can still refund you.'
                    : 'That’s inside the cancellation window, so it’s ' + (order.provider_business_name || 'the provider') + '’s to decide — message them and they can still refund you.';
                return NextResponse.json({ ok: false, error: withinMsg }, { status: 409 });
            }

            await stripeRequest('POST', '/refunds',
                { payment_intent: order.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                'refund-' + order.id);
            const { data: refunded } = await admin.from('service_orders')
                .update({ status: 'refunded', cancelled_at: now.toISOString() })
                .eq('id', order.id).eq('status', 'confirmed').select('id');
            if (refunded && refunded.length) await releaseSeat();   // a slot's time reopens

            return NextResponse.json({ ok: true, status: 'refunded' });
        }

        return NextResponse.json({ ok: false, error: 'That booking has already ended.' }, { status: 409 });
    } catch (err: any) {
        await logError('services-orders-cancel', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not cancel that' }, { status: 500 });
    }
}
