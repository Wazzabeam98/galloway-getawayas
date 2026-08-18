import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundFraction } from '@/lib/cancellation';
import {
    sendEmail,
    emailLayout,
    escapeHtml,
    formatDate,
    button,
    SITE_URL,
} from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Runs once a day, so an attempt a day gives the 24h / 48h retries and the
// cancellation on the fourth day — 72 hours after the guest was first told.
const MAX_ATTEMPTS = 3;

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

async function emailFor(admin: any, userId: string): Promise<string> {
    const { data } = await admin.auth.admin.getUserById(userId);
    return (data && data.user && data.user.email) || '';
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const today = new Date().toISOString().split('T')[0];

    const { data: due } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out, balance_amount, balance_due_date, balance_attempts, balance_last_attempt_at, amount_paid, amount_refunded, stripe_customer_id, stripe_payment_method_id, stripe_payment_intent_id, payment_status, status')
        .eq('payment_status', 'deposit_paid')
        .in('status', ['confirmed', 'pending'])
        .lte('balance_due_date', today)
        .gt('balance_amount', 0);

    let charged = 0;
    let failed = 0;
    let cancelled = 0;
    let skipped = 0;

    for (const booking of due || []) {
        try {
            const attempts = Number(booking.balance_attempts || 0);

            // One attempt per day. If today's run has already touched this
            // booking, leave it alone.
            if (booking.balance_last_attempt_at) {
                const last = new Date(booking.balance_last_attempt_at);
                if (Date.now() - last.getTime() < 20 * 3600 * 1000) {
                    skipped++;
                    continue;
                }
            }

            const listingRes = await admin
                .from('listings')
                .select('title, cancellation_policy')
                .eq('id', booking.listing_id)
                .maybeSingle();
            const listing = listingRes.data || { title: 'your stay', cancellation_policy: null };

            // ----------------------------------------------------------
            // Three attempts have already failed. The guest was told at the
            // first failure, so 72 hours have passed. Cancel on their behalf
            // and refund whatever the listing's policy allows today.
            // ----------------------------------------------------------
            if (attempts >= MAX_ATTEMPTS) {
                const paid = Number(booking.amount_paid || 0);
                const alreadyRefunded = Number(booking.amount_refunded || 0);
                const refundable = round2(paid - alreadyRefunded);
                const fraction = refundFraction(booking.check_in, listing.cancellation_policy);
                const refundAmount = round2(refundable * fraction);

                if (refundAmount > 0 && booking.stripe_payment_intent_id) {
                    await stripeRequest('POST', '/refunds', {
                        payment_intent: booking.stripe_payment_intent_id,
                        amount: Math.round(refundAmount * 100),
                        metadata: {
                            booking_id: booking.id,
                            reason: 'balance_unpaid',
                            initiated_by: 'system',
                        },
                    });

                    await admin.from('payments').insert({
                        booking_id: booking.id,
                        kind: 'refund',
                        amount: refundAmount,
                        status: 'succeeded',
                        stripe_payment_intent_id: booking.stripe_payment_intent_id,
                    });
                }

                const totalRefunded = round2(alreadyRefunded + refundAmount);

                await admin
                    .from('bookings')
                    .update({
                        status: 'cancelled',
                        payment_status: totalRefunded >= round2(paid) ? 'refunded' : 'partially_refunded',
                        amount_refunded: totalRefunded,
                        // The stay is off, so nothing is owed on it any more.
                        balance_amount: 0,
                    })
                    .eq('id', booking.id);

                const guestEmail = await emailFor(admin, booking.guest_id);
                if (guestEmail) {
                    await sendEmail(
                        guestEmail,
                        'Your booking at ' + listing.title + ' has been cancelled',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">We weren\u2019t able to collect the remaining balance for your stay at <strong>'
                                + escapeHtml(listing.title)
                                + '</strong>, and the 72 hours we allow to sort it out have now passed, so the booking has been cancelled.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">'
                                + (refundAmount > 0
                                    ? 'A refund of \u00A3' + refundAmount.toFixed(2) + ' is on its way back to your card. It usually takes five to ten days to appear.'
                                    : 'Under the cancellation policy for these dates, no refund is due on what you have already paid.')
                                + '</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">The dates are free again, so you are very welcome to book afresh if your plans allow.</p>'
                                + button(SITE_URL, 'Browse places to stay'),
                            'You\u2019re receiving this because you had a booking with Galloway Getaways.'
                        )
                    );
                }

                const hostEmail = await emailFor(admin, booking.host_id);
                if (hostEmail) {
                    await sendEmail(
                        hostEmail,
                        'Booking cancelled \u2014 balance unpaid',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">A booking at <strong>'
                                + escapeHtml(listing.title)
                                + '</strong> for '
                                + formatDate(booking.check_in)
                                + ' has been cancelled because the guest\u2019s remaining balance couldn\u2019t be collected.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">We tried three times over 72 hours and let the guest know each time. Your calendar is open again for those dates.</p>'
                                + button(SITE_URL + '/dashboard/bookings', 'View your bookings'),
                            'You\u2019re receiving this because you host on Galloway Getaways.'
                        )
                    );
                }

                cancelled++;
                continue;
            }

            // ----------------------------------------------------------
            // Try to take the balance off-session, using the card saved when
            // the deposit was paid.
            // ----------------------------------------------------------
            const amount = round2(Number(booking.balance_amount || 0));
            let succeeded = false;
            let failureMessage = 'No saved card for this booking';

            if (booking.stripe_customer_id && booking.stripe_payment_method_id) {
                try {
                    // The key at the end is what stops a guest ever being
                    // charged twice for the same balance. It is built from
                    // things that don't move — the booking and its due date —
                    // and deliberately not from the attempt count, because a
                    // restore, a repair script or a stray database edit can
                    // reset a counter, and this has to hold even then.
                    //
                    // A genuine retry after a decline is unaffected: a failed
                    // charge leaves nothing for Stripe to replay.
                    const intent = await stripeRequest('POST', '/payment_intents', {
                        amount: Math.round(amount * 100),
                        currency: 'gbp',
                        customer: booking.stripe_customer_id,
                        payment_method: booking.stripe_payment_method_id,
                        off_session: true,
                        confirm: true,
                        description: 'Galloway Getaways balance ' + booking.id,
                        metadata: {
                            booking_id: booking.id,
                            kind: 'balance',
                        },
                    }, 'balance-' + booking.id + '-' + String(booking.balance_due_date || ''));

                    succeeded = intent && intent.status === 'succeeded';
                    if (!succeeded) {
                        failureMessage = 'Payment status: ' + ((intent && intent.status) || 'unknown');
                    }

                    if (intent && intent.id) {
                        await admin
                            .from('bookings')
                            .update({ balance_payment_intent_id: intent.id })
                            .eq('id', booking.id);
                    }
                } catch (err: any) {
                    failureMessage = (err && err.message) || 'The card was declined';
                }
            }

            if (succeeded) {
                await admin
                    .from('bookings')
                    .update({
                        payment_status: 'paid',
                        amount_paid: round2(Number(booking.amount_paid || 0) + amount),
                        // Nothing is outstanding any more, so the column that
                        // says what is outstanding has to say zero.
                        balance_amount: 0,
                        balance_attempts: attempts + 1,
                        balance_last_attempt_at: new Date().toISOString(),
                    })
                    .eq('id', booking.id);

                await admin.from('payments').insert({
                    booking_id: booking.id,
                    kind: 'balance',
                    amount: amount,
                    status: 'succeeded',
                });

                const guestEmail = await emailFor(admin, booking.guest_id);
                if (guestEmail) {
                    await sendEmail(
                        guestEmail,
                        'Payment received \u2014 you\u2019re all paid up for ' + listing.title,
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">The remaining \u00A3'
                                + amount.toFixed(2)
                                + ' for your stay at <strong>'
                                + escapeHtml(listing.title)
                                + '</strong> has been charged to the card you booked with. Nothing further to pay.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">Check-in is '
                                + formatDate(booking.check_in)
                                + '. We hope you have a lovely time.</p>'
                                + button(SITE_URL + '/trips', 'View your trip'),
                            'You\u2019re receiving this because you have a booking with Galloway Getaways.'
                        )
                    );
                }

                charged++;
                continue;
            }

            // ----------------------------------------------------------
            // Failed. Log it, count the attempt, and tell the guest how long
            // they have and how to fix it.
            // ----------------------------------------------------------
            const attemptNumber = attempts + 1;
            const hoursLeft = (MAX_ATTEMPTS - attemptNumber + 1) * 24;

            await admin
                .from('bookings')
                .update({
                    balance_attempts: attemptNumber,
                    balance_last_attempt_at: new Date().toISOString(),
                })
                .eq('id', booking.id);

            await admin.from('payments').insert({
                booking_id: booking.id,
                kind: 'balance',
                amount: amount,
                status: 'failed',
                failure_reason: failureMessage,
            });

            const guestEmail = await emailFor(admin, booking.guest_id);
            if (guestEmail) {
                await sendEmail(
                    guestEmail,
                    attemptNumber === 1
                        ? 'We couldn\u2019t take the balance for your stay'
                        : 'Reminder: your booking will be cancelled without payment',
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">We tried to charge the remaining <strong>\u00A3'
                            + amount.toFixed(2)
                            + '</strong> for your stay at <strong>'
                            + escapeHtml(listing.title)
                            + '</strong>, but the payment didn\u2019t go through.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">This usually means the card has expired or there weren\u2019t enough funds \u2014 it\u2019s easily fixed. Use the button below to pay with any card.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">If the balance isn\u2019t paid within <strong>'
                            + hoursLeft
                            + ' hours</strong>, the booking will be cancelled and the dates released.</p>'
                            + button(SITE_URL + '/trips?pay=' + booking.id, 'Pay the balance')
                            + '<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Check-in is '
                            + formatDate(booking.check_in)
                            + '.</p>',
                        'You\u2019re receiving this because you have a booking with Galloway Getaways.'
                    )
                );
            }

            failed++;
        } catch (err: any) {
            console.error('[cron/balance-charges]', booking.id, err && err.message);
            failed++;
        }
    }

    return NextResponse.json({
        ok: true,
        charged: charged,
        failed: failed,
        cancelled: cancelled,
        skipped: skipped,
    });
}
