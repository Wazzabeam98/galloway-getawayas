import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { issueRefunds } from '@/lib/refundSpread';
import { clawBackPayout } from '@/lib/clawback';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

// A host giving money back without calling the stay off — something went
// wrong, the guest is still coming, and the host decides what that's worth.
// The platform doesn't judge the amount; it just moves the money and takes it
// off what the host is eventually paid.
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
        const requested = Number(body && body.amount);

        if (!bookingId || !requested || isNaN(requested) || requested <= 0) {
            return NextResponse.json(
                { ok: false, error: 'Enter an amount to refund.' },
                { status: 400 }
            );
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, status, payment_status, amount_paid, amount_refunded, stripe_payment_intent_id, balance_payment_intent_id, payout_transfer_id, payout_amount')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        if (booking.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        const paid = round2(Number(booking.amount_paid || 0));
        const alreadyRefunded = round2(Number(booking.amount_refunded || 0));
        const refundable = round2(paid - alreadyRefunded);

        if (refundable <= 0) {
            return NextResponse.json(
                { ok: false, error: 'There is nothing left to refund on this booking.' },
                { status: 400 }
            );
        }

        const amount = round2(requested);

        if (amount > refundable) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'That is more than the £' + refundable.toFixed(2) + ' the guest has paid.',
                },
                { status: 400 }
            );
        }

        if (!booking.stripe_payment_intent_id) {
            return NextResponse.json(
                { ok: false, error: 'No payment was found for this booking.' },
                { status: 400 }
            );
        }

        // Spread across every charge behind the stay, through the one helper
        // all the refunding routes share. Naming `stripe_payment_intent_id`
        // alone is only half the money on a deposit booking, and Stripe
        // refuses a refund larger than the charge it names — so a host trying
        // to give back more than the deposit got an error and the guest got
        // nothing. See lib/refundSpread.ts.
        const issued = await issueRefunds(
            booking,
            amount,
            {
                booking_id: booking.id,
                reason: 'host_goodwill',
                initiated_by: 'host',
            },
            // Distinct per amount, so a host can refund twice if they choose to
            // but a double-click can't.
            function (intentId) {
                return 'host-refund-' + booking.id + '-' + Math.round(amount * 100) + '-' + intentId;
            }
        );

        if (issued.refundedPence <= 0) {
            await logError(
                '[bookings/host-refund] a host asked to refund \u00A3' + amount.toFixed(2)
                    + ' and nothing could be sent back',
                issued.failure || { booking_id: booking.id, due: amount },
                { path: 'api/bookings/host-refund', userId: booking.host_id }
            );
            return NextResponse.json(
                {
                    ok: false,
                    error: 'We couldn\u2019t send that refund. Nothing has been taken from you '
                        + '\u2014 please try again shortly.',
                },
                { status: 502 }
            );
        }

        const refund = issued.refunds[0];
        const refundedNow = round2(issued.refundedPence / 100);

        if (issued.refundedPence < Math.round(amount * 100)) {
            await logError(
                '[bookings/host-refund] \u00A3' + amount.toFixed(2) + ' was asked for but only \u00A3'
                    + refundedNow.toFixed(2) + ' could be refunded',
                issued.failure || { booking_id: booking.id, due: amount, sent: refundedNow },
                { path: 'api/bookings/host-refund', userId: booking.host_id }
            );
        }

        for (let i = 0; i < issued.refunds.length; i++) {
            await admin.from('payments').insert({
                booking_id: booking.id,
                kind: 'refund',
                amount: round2(issued.shares[i] / 100),
                status: 'succeeded',
                stripe_payment_intent_id: issued.charges[i].intentId,
            });
        }

        // The stay is still happening, so the status is left alone; only the
        // money changes — and it moves atomically in the database, not
        // read-then-written here. A guest cancel or a second host refund
        // landing in the window of this one must SUM, not overwrite the figure
        // read before the money moved. record_booking_refund locks the row,
        // adds what we just refunded (clamped at what was paid) and returns how
        // much actually fit and the payment_status derived from it.
        const { data: appliedRow, error: refundWriteError } = await admin
            .rpc('record_booking_refund', { p_booking: booking.id, p_amount: refundedNow })
            .maybeSingle();
        // The RPC's row type is not in the generated Supabase types.
        const applied = appliedRow as { applied: number } | null;

        if (refundWriteError || !applied) {
            // The money has already gone back, so failing to record it is the
            // dangerous case — the booking then looks less refunded than it is
            // and its refundable guard reads wrong on the next refund.
            await logError(
                '[bookings/host-refund] refunded £' + refundedNow.toFixed(2)
                    + ' but could not record it against the booking',
                refundWriteError || { booking_id: booking.id, amount: refundedNow },
                { path: 'api/bookings/host-refund', userId: booking.host_id }
            );
        } else if (round2(Number(applied.applied)) < refundedNow) {
            // Less was added than we asked to: the total hit what was paid
            // because a concurrent refund took the headroom. The money left at
            // Stripe, so a person has to reconcile it.
            await logError(
                '[bookings/host-refund] £' + refundedNow.toFixed(2) + ' was refunded but only £'
                    + round2(Number(applied.applied)).toFixed(2)
                    + ' fit under what was paid — a concurrent refund overlapped; reconcile at Stripe',
                Object.assign({ booking_id: booking.id }, applied),
                { path: 'api/bookings/host-refund', userId: booking.host_id }
            );
        }

        // If they've already been paid for this stay, recover it.
        if (booking.payout_transfer_id) {
            await clawBackPayout(admin, booking, refundedNow, refund && refund.id);
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const { data: guestUser } = await admin.auth.admin.getUserById(booking.guest_id);
        const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';

        if (guestEmail) {
            await sendEmail(
                guestEmail,
                'Your host has refunded you \u00A3' + refundedNow.toFixed(2),
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Your host has sent back <strong>\u00A3'
                        + refundedNow.toFixed(2)
                        + '</strong> on your stay at <strong>'
                        + escapeHtml((listing && listing.title) || 'their place')
                        + '</strong>.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">It goes back to the card you paid with, usually within five to ten days. Your booking is unchanged and your stay is going ahead as planned.</p>'
                        + button(SITE_URL + '/trips', 'View your trip'),
                    'You\u2019re receiving this because you have a booking with Galloway Getaways.'
                )
            );
        }

        // What actually went back, not what was asked for. A host told
        // \u00A3200 went when \u00A3150 did will tell the guest the same thing.
        return NextResponse.json({
            ok: true,
            refunded: refundedNow,
            remaining: round2(refundable - refundedNow),
        });
    } catch (err: any) {
        console.error('[bookings/host-refund]', err && err.message);
        await logError('[bookings/host-refund] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/host-refund' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not process the refund' },
            { status: 500 }
        );
    }
}
