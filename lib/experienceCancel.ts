// A cancelled stay takes its experiences with it.
//
// When a booking is called off, every confirmed experience order on it must be
// refunded to the guest, its provider told not to turn up, and any slot seat it
// held handed back. This is that ONE cascade — so the two cancel routes cannot
// drift. They did: the guest route (/api/bookings/cancel) ran this, the host
// route (/api/stripe/refund) skipped it entirely, so a host cancelling a stay
// left the guest still paying for a dinner and the chef arriving at an empty
// cottage. Both routes call this now.
//
// Best-effort: the stay refund has already succeeded by the time this runs, so a
// hiccup settling one order is logged, never thrown — the expiry sweep releases
// an untaken hold as a backstop. The Stripe keys match the order routes, so this
// is idempotent with a direct cancel or a retry.
//
// Relative imports on purpose: this module is exercised by a unit test, and the
// '@/' alias is a build-time path Node cannot resolve at runtime.
import { sendEmail, emailLayout, escapeHtml } from './email';
import { logError } from './logError';
import { stripeRequest } from './stripe';

// Tell both sides — the guest that their dinner went back with the stay, and the
// provider that a booking they were counting on is off and the money reversed,
// so it is not a silent debit days later, and above all not a wasted trip to a
// cottage nobody is in.
async function tellAboutStayCancel(admin: any, order: any): Promise<void> {
    const who = escapeHtml(order.provider_business_name || 'your experience');
    const date = escapeHtml(String(order.service_date || ''));
    const amount = '£' + Number(order.price || 0).toFixed(2);

    if (order.guest_email) {
        try {
            await sendEmail(
                String(order.guest_email),
                'Your ' + (order.provider_business_name || 'experience') + ' booking was cancelled with your stay',
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Because your stay was cancelled, your booking with <strong>'
                    + who + '</strong> for <strong>' + date + '</strong> has been cancelled too and refunded '
                    + escapeHtml(amount) + ' in full.</p>',
                    'You’re receiving this because you booked an experience through Galloway Getaways.'
                )
            );
        } catch (e: any) { await logError('experience-cancel-guest-order-email', { order: order.id, message: String(e && e.message) }); }
    }

    try {
        const { data: prov } = await admin
            .from('service_providers')
            .select('contact_email')
            .eq('id', order.provider_id)
            .maybeSingle();
        if (prov && prov.contact_email) {
            await sendEmail(
                String(prov.contact_email),
                'A booking was cancelled: ' + date,
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">The guest booked with you for <strong>' + date
                    + '</strong> has had their stay cancelled, so this booking is off — please don’t turn up. They have been refunded '
                    + escapeHtml(amount) + ' in full, and that amount has been reversed from your account.</p>',
                    'You’re receiving this because you offer experiences on Galloway Getaways.'
                )
            );
        }
    } catch (e: any) { await logError('experience-cancel-provider-order-email', { order: order.id, message: String(e && e.message) }); }
}

export async function cancelStayExperienceOrders(admin: any, bookingId: string): Promise<void> {
    try {
        const { data: liveOrders } = await admin
            .from('service_orders')
            .select('id, status, stripe_payment_intent_id, guest_email, service_date, price, provider_id, provider_business_name, slot_session_id, quantity')
            .eq('booking_id', bookingId)
            .in('status', ['authorised', 'confirmed']);

        // Give a slot's seat back — a confirmed slot order held a seat on its
        // session, and a refund that leaves seats_taken up reads as full to the
        // next guest. The request shapes (comes_to_you, made_to_order) carry no
        // slot_session_id, so this is a no-op for them.
        const releaseSeat = async (o: any) => {
            if (!o.slot_session_id) return;
            const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', o.slot_session_id).maybeSingle();
            if (s) {
                await admin.from('slot_sessions')
                    .update({ seats_taken: Math.max(0, s.seats_taken - (o.quantity || 1)) })
                    .eq('id', o.slot_session_id);
            }
        };

        for (const o of liveOrders || []) {
            try {
                if (!o.stripe_payment_intent_id) continue;
                if (o.status === 'authorised') {
                    await stripeRequest('POST', '/payment_intents/' + o.stripe_payment_intent_id + '/cancel', undefined, 'cancel-' + o.id);
                    await admin.from('service_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', o.id).eq('status', 'authorised');
                } else {
                    await stripeRequest('POST', '/refunds', { payment_intent: o.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' }, 'refund-' + o.id);
                    // Only release the seat when this call is the one that moved
                    // the order off 'confirmed' — so a retry or a race with a
                    // direct cancel cannot double-decrement.
                    const { data: moved } = await admin.from('service_orders').update({ status: 'refunded', cancelled_at: new Date().toISOString() }).eq('id', o.id).eq('status', 'confirmed').select('id');
                    if (moved && moved.length) await releaseSeat(o);
                    await tellAboutStayCancel(admin, o);
                }
            } catch (orderErr: any) {
                await logError('[experienceCancel] could not settle a service order on a cancelled stay', orderErr, { path: 'lib/experienceCancel' });
            }
        }
    } catch (cascadeErr: any) {
        await logError('[experienceCancel] could not read service orders for a cancelled stay', cascadeErr, { path: 'lib/experienceCancel' });
    }
}
