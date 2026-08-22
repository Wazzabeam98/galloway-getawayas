import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { refundFraction } from '@/lib/cancellation';
import { logError } from '@/lib/logError';
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

// A bank asking the guest to confirm the payment is not a card problem. There
// is nothing for them to fix — they just have to be at their phone when the
// message arrives, and 72 hours is not long for that. A week is.
const MAX_ATTEMPTS_AUTHENTICATION = 7;

// Written at the front of failure_reason so a later run can tell why the last
// attempt failed without asking Stripe again. The payments table has no column
// for it, and matching on the prose would break the moment anyone reworded it.
const AUTHENTICATION_MARKER = 'authentication_required';

// '72 hours' reads oddly once it is a week, and 'seven days' reads oddly for a
// short deadline.
function deadlineText(hours: number): string {
    // 72 hours has always been said as 72 hours, and it reads as more urgent
    // than 'three days'. Only the longer deadline is worth saying in days.
    if (hours > 72 && hours % 24 === 0) {
        const days = hours / 24;
        return days + (days === 1 ? ' day' : ' days');
    }
    return hours + ' hours';
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

            // How long this guest gets depends on why the last attempt failed.
            // A declined card is theirs to fix now; a bank waiting on them to
            // approve the payment is not.
            const { data: lastFailure } = await admin
                .from('payments')
                .select('failure_reason')
                .eq('booking_id', booking.id)
                .eq('kind', 'balance')
                .eq('status', 'failed')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const awaitingAuthentication =
                !!lastFailure &&
                String(lastFailure.failure_reason || '').indexOf(AUTHENTICATION_MARKER) === 0;

            const maxAttempts = awaitingAuthentication ? MAX_ATTEMPTS_AUTHENTICATION : MAX_ATTEMPTS;
            const allowedText = deadlineText(maxAttempts * 24);

            // ----------------------------------------------------------
            // Every attempt has failed and the time allowed has run out.
            // Cancel on their behalf and refund whatever the listing's policy
            // allows today.
            // ----------------------------------------------------------
            if (attempts >= maxAttempts) {
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
                        // Nobody chose this — the balance could not be
                        // collected after the full failure ladder. Recorded so
                        // it can never be mistaken for a host cancellation,
                        // which carries a fee.
                        cancelled_at: new Date().toISOString(),
                        cancelled_by_role: 'system',
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
                                + '</strong>, and the ' + allowedText + ' we allow to sort it out have now passed, so the booking has been cancelled.</p>'
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
                                + '<p style="margin:0 0 16px;font-size:16px;">We tried '
                                + maxAttempts
                                + ' times over ' + allowedText + ' and let the guest know each time. Your calendar is open again for those dates.</p>'
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
            // Not the same thing as a decline, and the guest has to be told
            // something different, so it is tracked separately.
            let needsAuthentication = false;
            let failedIntentId: string | null = null;
            let succeededIntentId: string | null = null;

            // ----------------------------------------------------------
            // Claim the attempt BEFORE charging, and key the charge on it.
            //
            // The row is written first and its uuid is the idempotency key, so
            // the thing that says an attempt happened and the thing that stops
            // it happening twice are one object. Two objects can disagree.
            //
            // The key used to be built from the booking and its balance_due_date,
            // described in a comment here as "things that don't move". The due
            // date moves: it is an ordinary column, and moving it is exactly
            // how you make a balance chargeable today for testing. Reset it
            // afterwards and the key changes, which is the same shape as the
            // attempt-counter bug that already cost a double payment once.
            //
            // That comment also claimed a declined charge leaves nothing for
            // Stripe to replay. It does. Stripe saves the result of the first
            // request for a key "regardless of whether it succeeds or fails",
            // and replays it — so a reused key after a decline returns that
            // decline without the bank ever seeing it. Keys are pruned after
            // 24 hours, and the guard above lets an attempt through after 20,
            // so the old key had a four-hour window in which a manual re-run
            // would record a refusal that never happened. A key per attempt
            // closes it.
            //
            // A dangling 'attempting' row means a previous run died between
            // claiming and hearing back from Stripe. Reusing its id is the
            // point: the retry carries the same key, so if the charge did go
            // through, Stripe replays it instead of taking the money again.
            let attemptRowId: string | null = null;

            if (booking.stripe_customer_id && booking.stripe_payment_method_id) {
                const { data: dangling } = await admin
                    .from('payments')
                    .select('id, amount')
                    .eq('booking_id', booking.id)
                    .eq('kind', 'balance')
                    .eq('status', 'attempting')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (dangling && round2(Number(dangling.amount || 0)) === amount) {
                    attemptRowId = dangling.id;
                } else {
                    // A dangling row for a different amount cannot be reused:
                    // Stripe rejects a key replayed with different parameters.
                    // Close it off rather than leaving it to be picked up
                    // later and confuse the trail.
                    if (dangling) {
                        await admin
                            .from('payments')
                            .update({
                                status: 'abandoned',
                                failure_reason: 'Superseded — the balance changed before this attempt completed',
                            })
                            .eq('id', dangling.id);
                    }

                    const { data: claimed } = await admin
                        .from('payments')
                        .insert({
                            booking_id: booking.id,
                            kind: 'balance',
                            amount: amount,
                            status: 'attempting',
                        })
                        .select('id')
                        .maybeSingle();

                    attemptRowId = (claimed && claimed.id) || null;
                }
            }

            // No claim, no charge. Without a key this would be a bare
            // off-session charge with nothing to stop a retry taking the money
            // twice, which is worse than waiting for tomorrow's run.
            //
            // Skipped rather than failed, deliberately. Counting this as an
            // attempt would burn a rung on the guest's 72-hour ladder and
            // email them that their card was declined, when their card was
            // never presented and nothing is wrong with it. Our fault, our
            // problem — it goes to /admin/errors instead.
            if (booking.stripe_customer_id && booking.stripe_payment_method_id && !attemptRowId) {
                await logError(
                    'balance-charges: could not record an attempt for booking ' + booking.id
                        + ', so the balance was not charged',
                    null,
                    { path: '/api/cron/balance-charges' }
                );
                skipped++;
                continue;
            }

            if (booking.stripe_customer_id && booking.stripe_payment_method_id) {
                try {
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
                    }, 'balance-attempt-' + attemptRowId);

                    succeeded = intent && intent.status === 'succeeded';
                    if (intent && intent.id) succeededIntentId = intent.id;
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
                    // A bank asking the guest to confirm the payment is not a
                    // decline. Their card is fine — it simply cannot be charged
                    // while they are not here to approve it, which in the UK is
                    // commoner than an outright refusal. Stripe's own message
                    // for it opens with 'Your card was declined', so left as it
                    // was, both the record and the guest's email said the wrong
                    // thing.
                    needsAuthentication = !!(err && err.stripeCode === 'authentication_required');

                    failureMessage = needsAuthentication
                        ? AUTHENTICATION_MARKER
                            + ': the guest\u2019s bank asked them to authenticate this payment, which cannot be done while they are away'
                        : (err && err.message) || 'The card was declined';

                    // Stripe returns the intent it created alongside the error.
                    // Keeping its id leaves a trail from the booking to the
                    // attempt; without it there was nothing to look at.
                    const failedIntent = err && err.stripePaymentIntent;
                    if (failedIntent && failedIntent.id) {
                        failedIntentId = failedIntent.id;
                        await admin
                            .from('bookings')
                            .update({ balance_payment_intent_id: failedIntent.id })
                            .eq('id', booking.id);
                    }
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

                // Settles the row claimed above rather than writing a second
                // one, so the attempt and its outcome stay a single record and
                // anything counting attempts still counts the same number.
                await admin
                    .from('payments')
                    .update({
                        status: 'succeeded',
                        stripe_payment_intent_id: succeededIntentId,
                    })
                    .eq('id', attemptRowId);

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
            // The limit that applies from here is decided by *this* attempt,
            // not the one before it — a card that has just asked for
            // authentication earns the longer deadline straight away.
            const limitFromNow = needsAuthentication ? MAX_ATTEMPTS_AUTHENTICATION : maxAttempts;
            const leftText = deadlineText(Math.max(1, limitFromNow - attemptNumber + 1) * 24);

            await admin
                .from('bookings')
                .update({
                    balance_attempts: attemptNumber,
                    balance_last_attempt_at: new Date().toISOString(),
                })
                .eq('id', booking.id);

            // The same row again, settled as failed. The webhook for this
            // failure looks for a 'failed' row carrying the intent id so it
            // does not write the same failure a second time in different
            // words, so the intent id has to land here.
            if (attemptRowId) {
                await admin
                    .from('payments')
                    .update({
                        status: 'failed',
                        stripe_payment_intent_id: failedIntentId,
                        failure_reason: failureMessage,
                    })
                    .eq('id', attemptRowId);
            } else {
                // No claim was made — no saved card, or the claim itself
                // failed. There is still an attempt to record.
                await admin.from('payments').insert({
                    booking_id: booking.id,
                    kind: 'balance',
                    amount: amount,
                    status: 'failed',
                    stripe_payment_intent_id: failedIntentId,
                    failure_reason: failureMessage,
                });
            }

            const guestEmail = await emailFor(admin, booking.guest_id);
            if (guestEmail) {
                await sendEmail(
                    guestEmail,
                    needsAuthentication
                        ? 'Your bank needs you to confirm a payment'
                        : attemptNumber === 1
                            ? 'We couldn\u2019t take the balance for your stay'
                            : 'Reminder: your booking will be cancelled without payment',
                    emailLayout(
                        (needsAuthentication
                            ? '<p style="margin:0 0 16px;font-size:16px;">We tried to charge the remaining <strong>\u00A3'
                                + amount.toFixed(2)
                                + '</strong> for your stay at <strong>'
                                + escapeHtml(listing.title)
                                + '</strong>, and your bank asked for you to confirm it\u2019s really you.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">There is nothing wrong with your card. Banks ask for this on payments taken while you aren\u2019t there, and we can\u2019t answer it on your behalf \u2014 so the payment needs a minute of your time. Use the button below and your bank will ask you to approve it.</p>'
                            : '<p style="margin:0 0 16px;font-size:16px;">We tried to charge the remaining <strong>\u00A3'
                                + amount.toFixed(2)
                                + '</strong> for your stay at <strong>'
                                + escapeHtml(listing.title)
                                + '</strong>, but the payment didn\u2019t go through.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">This usually means the card has expired or there weren\u2019t enough funds \u2014 it\u2019s easily fixed. Use the button below to pay with any card.</p>')
                            + '<p style="margin:0 0 16px;font-size:16px;">If the balance isn\u2019t paid within <strong>'
                            + leftText
                            + '</strong>, the booking will be cancelled and the dates released.</p>'
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
