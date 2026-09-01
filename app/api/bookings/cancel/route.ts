import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundDue } from '@/lib/cancellation';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml } from '@/lib/email';

export const dynamic = 'force-dynamic';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

// When a cancelled stay refunds a confirmed experience, tell both sides — the
// guest that their dinner went back with the stay, and the provider that a
// booking they were counting on is off and the money reversed, so it is not a
// silent debit from their balance days later. Best-effort; a failed mail is
// logged, not thrown.
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
                    '<p style="margin:0 0 16px;font-size:16px;">Because you cancelled your stay, your booking with <strong>'
                    + who + '</strong> for <strong>' + date + '</strong> has been cancelled too and refunded '
                    + escapeHtml(amount) + ' in full.</p>',
                    'You’re receiving this because you booked an experience through Galloway Getaways.'
                )
            );
        } catch (e: any) { await logError('bookings-cancel-guest-order-email', { order: order.id, message: String(e && e.message) }); }
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
                    + '</strong> has cancelled their stay, so this booking is off. They have been refunded '
                    + escapeHtml(amount) + ' in full, and that amount has been reversed from your account.</p>',
                    'You’re receiving this because you offer experiences on Galloway Getaways.'
                )
            );
        }
    } catch (e: any) { await logError('bookings-cancel-provider-order-email', { order: order.id, message: String(e && e.message) }); }
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie and never checks its signature, so the id it returns is
        // whatever the caller wrote there — a forged cookie carrying anyone's
        // id is accepted. This route moves money, so the identity it acts on
        // has to be verified against the auth server, which getUser() does.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const bookingId: string = body && body.bookingId;

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, check_in, status, payment_status, amount_paid, amount_refunded, cleaning_fee, stripe_payment_intent_id, balance_amount')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        if (booking.guest_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        if (booking.status === 'cancelled' || booking.status === 'declined') {
            return NextResponse.json(
                { ok: false, error: 'This booking has already been cancelled.' },
                { status: 400 }
            );
        }

        // A stay that has started can't be called off from here — that's a
        // conversation with the host, not a button.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkIn = new Date(booking.check_in);
        checkIn.setHours(0, 0, 0, 0);

        if (checkIn.getTime() <= today.getTime()) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'This stay has already started or is starting today, so it can no longer be cancelled online. Please message your host.',
                },
                { status: 400 }
            );
        }

        const { data: listing } = await admin
            .from('listings')
            .select('cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const paid = Number(booking.amount_paid || 0);
        const alreadyRefunded = Number(booking.amount_refunded || 0);
        const refundable = round2(paid - alreadyRefunded);

        // One rule, in lib/cancellation.ts, shared with /api/stripe/refund,
        // the balance job and the two screens that predict this figure.
        const amount = refundDue({
            amountPaid: paid,
            alreadyRefunded: alreadyRefunded,
            cleaningFee: booking.cleaning_fee,
            checkIn: booking.check_in,
            policy: listing && listing.cancellation_policy,
        });

        // The money goes back before the booking changes. If Stripe refuses,
        // the guest still has their stay rather than neither.
        if (amount > 0 && booking.stripe_payment_intent_id) {
            try {
                await stripeRequest(
                    'POST',
                    '/refunds',
                    {
                        payment_intent: booking.stripe_payment_intent_id,
                        amount: Math.round(amount * 100),
                        metadata: {
                            booking_id: booking.id,
                            reason: 'guest_cancelled',
                            initiated_by: 'guest',
                        },
                    },
                    'guest-cancel-' + booking.id
                );
            } catch (err: any) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'We couldn\u2019t process your refund, so the booking has been left as it is. Please try again or message your host.',
                    },
                    { status: 500 }
                );
            }

            await admin.from('payments').insert({
                booking_id: booking.id,
                kind: 'refund',
                amount: amount,
                status: 'succeeded',
                stripe_payment_intent_id: booking.stripe_payment_intent_id,
            });
        }

        const totalRefunded = round2(alreadyRefunded + amount);

        await admin
            .from('bookings')
            .update({
                status: 'cancelled',
                amount_refunded: totalRefunded,
                payment_status:
                    totalRefunded <= 0
                        ? booking.payment_status
                        : totalRefunded >= round2(paid)
                            ? 'refunded'
                            : 'partially_refunded',
                // Nothing further is owed on a stay that isn't happening, so
                // the balance charge won't pick it up.
                balance_amount: 0,
                // This route is the guest's own cancel button, so the role is
                // never in doubt — but it still gets written down, because a
                // booking that records nothing is indistinguishable from one
                // the host called off.
                cancelled_at: new Date().toISOString(),
                cancelled_by_user: user.id,
                cancelled_by_role: 'guest',
            })
            .eq('id', booking.id);

        // THE DINNER GOES WITH THE STAY.
        //
        // A guest cancelling their cottage was leaving any experience they had
        // booked for it standing — a held card, or a captured £180, for a dinner
        // at a cottage they will not be in. That is the "still owing for a
        // dinner" the guest should never have to have a conversation about. So
        // the same cancel handles the orders on this booking:
        //   authorised — release the hold, nothing was taken.
        //   confirmed  — refund in full (reverse the fee and the transfer). The
        //                stay is off, so the dinner cannot happen; the guest is
        //                not left paying for it, and the provider is told.
        // Best-effort and reported, never fatal: the stay refund above has
        // already succeeded, so a hiccup here must not fail the cancellation —
        // the expiry sweep still releases an untaken hold as a backstop. Keys
        // match the order routes, so this is idempotent with a direct cancel.
        try {
            const { data: liveOrders } = await admin
                .from('service_orders')
                .select('id, status, stripe_payment_intent_id, guest_email, service_date, price, provider_id, provider_business_name')
                .eq('booking_id', booking.id)
                .in('status', ['authorised', 'confirmed']);

            for (const o of liveOrders || []) {
                try {
                    if (!o.stripe_payment_intent_id) continue;
                    if (o.status === 'authorised') {
                        await stripeRequest('POST', '/payment_intents/' + o.stripe_payment_intent_id + '/cancel', undefined, 'cancel-' + o.id);
                        await admin.from('service_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', o.id).eq('status', 'authorised');
                    } else {
                        await stripeRequest('POST', '/refunds', { payment_intent: o.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' }, 'refund-' + o.id);
                        await admin.from('service_orders').update({ status: 'refunded', cancelled_at: new Date().toISOString() }).eq('id', o.id).eq('status', 'confirmed');
                        await tellAboutStayCancel(admin, o);
                    }
                } catch (orderErr: any) {
                    await logError('[bookings/cancel] could not settle a service order on a cancelled stay', orderErr, { path: 'bookings/cancel' });
                }
            }
        } catch (cascadeErr: any) {
            await logError('[bookings/cancel] could not read service orders for a cancelled stay', cascadeErr, { path: 'bookings/cancel' });
        }

        return NextResponse.json({ ok: true, refunded: amount });
    } catch (err: any) {
        console.error('[bookings/cancel]', err && err.message);
        await logError('[bookings/cancel] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/cancel' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not cancel' },
            { status: 500 }
        );
    }
}
