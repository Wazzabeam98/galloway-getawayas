import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { canTransition } from '@/lib/serviceOrders';
import { providerFirstName } from '@/lib/providerName';
import { guestMayCancelFree, shapeOf } from '@/lib/serviceSlots';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
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
        // How to cancel a CONFIRMED order that is inside the no-refund window:
        //   'refund'  — the default; only honoured when a full refund is still due.
        //   'ask'     — ask the provider to refund; the order stays confirmed.
        //   'forfeit' — the walk-away: cancel with no refund, on the record.
        const mode: string = (body && body.mode) || 'refund';
        if (!orderId) return NextResponse.json({ ok: false, error: 'Missing order' }, { status: 400 });

        const admin = adminClient();

        const { data: order } = await admin
            .from('service_orders')
            .select('id, guest_id, provider_id, status, shape, service_date, service_time, quantity, price, slot_session_id, stripe_payment_intent_id, provider_business_name, parent_order_id')
            .eq('id', orderId)
            .maybeSingle();

        if (!order) return NextResponse.json({ ok: false, error: 'No such booking' }, { status: 404 });
        if (order.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const now = new Date();
        const shape = shapeOf(order);
        // A top-up amends its parent; cancel the parent, never a top-up in
        // isolation (per-seat cancel is not built — the child rows stand alone,
        // so it is additive later). Send the guest to the booking itself.
        if (order.parent_order_id) {
            return NextResponse.json({ ok: false, error: 'Cancel the booking itself — added places go with it.' }, { status: 400 });
        }

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

        // THE TOP-UPS RIDE WITH THE BOOKING. An added place is its own row with
        // its own PaymentIntent and its own seats on the same session, linked by
        // parent_order_id and carrying no booking_id. Cancelling only the parent
        // row would refund the original but keep the top-up's money and leave its
        // seats taken — so the whole family is settled here, each child the same
        // way the parent just was. 'refund' reverses each child's PI; 'forfeit'
        // keeps each child's money; both release each child's seats. A child
        // still 'holding' (topped up, not yet paid) is simply released.
        const settleChildren = async (kind: 'refund' | 'forfeit') => {
            const { data: kids } = await admin
                .from('service_orders')
                .select('id, parent_order_id, status, quantity, slot_session_id, stripe_payment_intent_id, price')
                .eq('parent_order_id', order.id)
                .in('status', ['confirmed', 'holding', 'authorised']);
            // Belt-and-braces: only a genuine child of THIS order.
            for (const kid of (kids || []).filter((k: any) => k.parent_order_id === order.id)) {
                try {
                    const releaseKid = async () => {
                        if (!kid.slot_session_id) return;
                        const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', kid.slot_session_id).maybeSingle();
                        if (s) await admin.from('slot_sessions').update({ seats_taken: Math.max(0, s.seats_taken - (kid.quantity || 1)) }).eq('id', kid.slot_session_id);
                    };
                    if (kid.status === 'confirmed' && kid.stripe_payment_intent_id) {
                        if (kind === 'refund') {
                            await stripeRequest('POST', '/refunds',
                                { payment_intent: kid.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                                'refund-' + kid.id);
                            const { data: moved } = await admin.from('service_orders')
                                .update({ status: 'refunded', cancelled_at: now.toISOString() })
                                .eq('id', kid.id).eq('status', 'confirmed').select('id');
                            if (moved && moved.length) await releaseKid();
                        } else {
                            // forfeit — the payment stays with the provider; the seat reopens.
                            const { data: moved } = await admin.from('service_orders')
                                .update({ status: 'cancelled', cancelled_at: now.toISOString() })
                                .eq('id', kid.id).eq('status', 'confirmed').select('id');
                            if (moved && moved.length) await releaseKid();
                        }
                    } else if (kid.status === 'holding') {
                        const { data: moved } = await admin.from('service_orders')
                            .update({ status: 'cancelled', cancelled_at: now.toISOString() })
                            .eq('id', kid.id).eq('status', 'holding').select('id');
                        if (moved && moved.length) await releaseKid();
                    } else if (kid.status === 'authorised' && kid.stripe_payment_intent_id) {
                        await stripeRequest('POST', '/payment_intents/' + kid.stripe_payment_intent_id + '/cancel', undefined, 'cancel-' + kid.id);
                        await admin.from('service_orders').update({ status: 'cancelled', cancelled_at: now.toISOString() }).eq('id', kid.id).eq('status', 'authorised');
                    }
                } catch (kidErr: any) {
                    await logError('services-orders-cancel-child', { parent: order.id, child: kid.id, message: String(kidErr && kidErr.message) });
                }
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

        // --- a confirmed booking ------------------------------------------
        if (order.status === 'confirmed') {
            if (!order.stripe_payment_intent_id) return NextResponse.json({ ok: false, error: 'Nothing to cancel.' }, { status: 400 });

            const { data: prov } = await admin
                .from('service_providers')
                .select('cancellation_window_hours, business_name, contact_email, owner_id, guest_details')
                .eq('id', order.provider_id).maybeSingle();
            const windowHours = Number(prov && prov.cancellation_window_hours) || 48;
            // A non-refundable policy: there is never an automatic full refund,
            // whatever the clock says. The provider can still choose to refund
            // (the 'ask' door below); the walk-away ('forfeit') is unchanged.
            const noRefund = !!(prov && prov.guest_details && prov.guest_details.no_refund);
            // Name the person in the guest-facing prompts below ("Inside Fiona's
            // window", "Fiona's to decide"), not the listing.
            const business = await providerFirstName(admin, order.provider_id, order.provider_business_name || (prov && prov.business_name) || 'the provider');
            const free = !noRefund && guestMayCancelFree(shape, String(order.service_date), order.service_time || null, windowHours, now);

            // BEFORE THE CUTOFF: a full refund, automatic. mode is irrelevant here.
            if (free) {
                if (!canTransition('confirmed', 'refunded')) {
                    return NextResponse.json({ ok: false, error: 'That can’t be cancelled.' }, { status: 409 });
                }
                await stripeRequest('POST', '/refunds',
                    { payment_intent: order.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                    'refund-' + order.id);
                const { data: refunded } = await admin.from('service_orders')
                    .update({ status: 'refunded', cancelled_at: now.toISOString() })
                    .eq('id', order.id).eq('status', 'confirmed').select('id');
                if (refunded && refunded.length) await releaseSeat();   // a slot's time reopens
                await settleChildren('refund');                          // added places refund with it
                return NextResponse.json({ ok: true, status: 'refunded' });
            }

            // INSIDE THE WINDOW: no automatic refund. Two doors, plus the old block
            // as a safety net for a stray 'refund'.

            // ASK FIRST: stamp the request, put it on the order thread so the reply
            // lands where the guest will look, and nudge the provider. The order
            // stays 'confirmed' — nothing is cancelled until the provider acts.
            if (mode === 'ask') {
                await admin.from('service_orders')
                    .update({ cancellation_requested_at: now.toISOString() })
                    .eq('id', order.id).eq('status', 'confirmed');
                if (prov && prov.owner_id) {
                    await admin.from('messages').insert({
                        order_id: order.id, sender_id: user.id, recipient_id: prov.owner_id,
                        body: 'I’m no longer able to make this booking and would like to cancel — is a refund possible?',
                    });
                }
                try {
                    if (prov && prov.contact_email) {
                        await sendEmail(prov.contact_email, 'A guest has asked to cancel', emailLayout(
                            '<p>A guest has asked to cancel their booking for '
                            + escapeHtml(String(order.service_date))
                            + ' and would like a refund. It’s inside your cancellation window, so the choice is yours — refund them from your dashboard, or reply.</p>'
                            + button(SITE_URL + '/services/dashboard', 'Open your bookings'),
                            'You’re receiving this because you offer experiences on Galloway Getaways.'));
                    }
                } catch (mailErr) { console.error('[services/orders/cancel] ask notify', mailErr); }
                return NextResponse.json({ ok: true, status: 'confirmed', requested: true });
            }

            // WALK AWAY: cancel with no refund. The provider keeps the payment and
            // gets the date back; no Stripe act, because the money stays put. Store
            // exactly what the guest was shown, as the record if it is ever disputed.
            if (mode === 'forfeit') {
                if (!canTransition('confirmed', 'cancelled')) {
                    return NextResponse.json({ ok: false, error: 'That can’t be cancelled.' }, { status: 409 });
                }
                const price = Number(order.price) || 0;
                const ack = {
                    amount: price,
                    currency: 'gbp',
                    refunded: 0,
                    shown: 'Cancelling now won’t get your money back. Inside ' + business
                        + '’s cancellation window, the £' + price.toFixed(2)
                        + ' paid is not refunded. Guest chose to cancel anyway.',
                    at: now.toISOString(),
                    status_before: 'confirmed',
                };
                const { data: done } = await admin.from('service_orders')
                    .update({ status: 'cancelled', cancelled_at: now.toISOString(), cancel_ack: ack })
                    .eq('id', order.id).eq('status', 'confirmed').select('id');
                if (done && done.length) await releaseSeat();   // the date/seat reopens; provider keeps the money
                await settleChildren('forfeit');                 // added places forfeit with it — money stays, seats reopen
                try {
                    if (prov && prov.contact_email) {
                        await sendEmail(prov.contact_email, 'A guest cancelled — you keep the payment', emailLayout(
                            '<p>A guest has cancelled their booking for '
                            + escapeHtml(String(order.service_date))
                            + '. It was inside your cancellation window, so no refund was due — the payment stays yours, and the date is free again.</p>'
                            + button(SITE_URL + '/services/dashboard', 'Open your bookings'),
                            'You’re receiving this because you offer experiences on Galloway Getaways.'));
                    }
                } catch (mailErr) { console.error('[services/orders/cancel] forfeit notify', mailErr); }
                return NextResponse.json({ ok: true, status: 'cancelled', refunded: 0 });
            }

            // A 'refund' while inside the window — the new UI never sends this, but
            // keep a clear answer rather than a silent refusal.
            const withinMsg = 'That’s inside the cancellation window, so a refund is '
                + business + '’s to decide — ask them, or cancel without a refund.';
            return NextResponse.json({ ok: false, error: withinMsg }, { status: 409 });
        }

        return NextResponse.json({ ok: false, error: 'That booking has already ended.' }, { status: 409 });
    } catch (err: any) {
        await logError('services-orders-cancel', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not cancel that' }, { status: 500 });
    }
}
