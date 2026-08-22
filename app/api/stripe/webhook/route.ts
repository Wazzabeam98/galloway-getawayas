import { logError } from '@/lib/logError';
import { guidanceFor } from '@/lib/disputes';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { verifyStripeSignature, stripeRequest } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Tells both directors, now. Not the 8am error digest: a dispute has a hard
// deadline measured in days, and a summary the next morning can burn a fifth
// of it.
async function alertDirectors(
    admin: any,
    eventType: string,
    dispute: any,
    bookingId: string | null
): Promise<void> {
    try {
        const { data: owners } = await admin
            .from('profiles')
            .select('id')
            .eq('is_admin', true);

        if (!owners || owners.length === 0) return;

        const amount = (Number(dispute.amount || 0) / 100).toFixed(2);
        const dueBy = dispute.evidence_details && dispute.evidence_details.due_by
            ? new Date(dispute.evidence_details.due_by * 1000)
            : null;
        const guidance = guidanceFor(dispute.reason);

        const opened = eventType === 'charge.dispute.created';
        const reinstated = eventType === 'charge.dispute.funds_reinstated';
        const won = dispute.status === 'won' || reinstated;

        const heading = opened
            ? 'Chargeback opened — \u00A3' + amount
            : won
                ? 'Chargeback resolved in our favour — \u00A3' + amount
                : 'Chargeback lost — \u00A3' + amount;

        const body = opened
            ? '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(guidance.meaning) + '</p>'
                + '<p style="margin:0 0 16px;font-size:16px;">Stripe has taken <strong>\u00A3'
                + amount + '</strong> from the balance while this is decided. '
                + (dueBy
                    ? 'Evidence is due by <strong>' + escapeHtml(formatDate(dueBy.toISOString())) + '</strong>.'
                    : 'Stripe has not given a deadline — check in Stripe directly.')
                + '</p>'
                + '<p style="margin:0 0 8px;font-size:16px;"><strong>What to gather:</strong></p>'
                + '<ul style="margin:0 0 16px;font-size:15px;">'
                + guidance.evidence.map(function (e: string) {
                    return '<li>' + escapeHtml(e) + '</li>';
                }).join('')
                + '</ul>'
                + '<p style="margin:0 0 8px;font-size:16px;"><strong>What we already hold:</strong></p>'
                + '<ul style="margin:0 0 16px;font-size:15px;">'
                + guidance.weHold.map(function (e: string) {
                    return '<li>' + escapeHtml(e) + '</li>';
                }).join('')
                + '</ul>'
                + '<p style="margin:0 0 16px;font-size:15px;color:#6b7280;">Nothing has been submitted to '
                + 'Stripe. Submitting is final and cannot be revised, so it is left to a person.</p>'
            : '<p style="margin:0 0 16px;font-size:16px;">Stripe has closed this dispute with the status '
                + '<strong>' + escapeHtml(String(dispute.status || 'unknown')) + '</strong>.'
                + (won ? ' The money has been returned.' : ' The money is gone.') + '</p>';

        for (const owner of owners) {
            const { data: user } = await admin.auth.admin.getUserById(owner.id);
            const email = (user && user.user && user.user.email) || '';
            if (!email) continue;

            await sendEmail(
                email,
                heading,
                emailLayout(
                    '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">'
                        + heading + '</h1>'
                        + body
                        + button(
                            SITE_URL + (bookingId ? '/dashboard/bookings/' + bookingId : '/admin'),
                            bookingId ? 'Open the booking' : 'Owner tools'
                        ),
                    'You are receiving this because you are a director of Galloway Getaways.'
                )
            );
        }
    } catch (err) {
        // A dispute that was recorded but not emailed is recoverable; one that
        // throws here and rolls back the whole webhook is not.
        await logError('[webhook] recorded a dispute but could not alert the directors', err, {
            path: 'stripe/webhook',
        });
    }
}

export async function POST(request: Request) {
    // The signature covers the exact bytes Stripe sent, so read the body as
    // text before anything parses it.
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Stripe gives every event destination its own signing secret. Platform
    // payments and connected-account updates can therefore arrive at this one
    // URL signed with different secrets, so each configured secret is tried.
    const secrets = [
        process.env.STRIPE_WEBHOOK_SECRET || '',
        process.env.STRIPE_WEBHOOK_SECRET_2 || '',
    ].filter(function (value) {
        return value.length > 0;
    });

    let valid = false;
    for (let i = 0; i < secrets.length; i++) {
        const matched = await verifyStripeSignature(rawBody, signature, secrets[i]);
        if (matched) {
            valid = true;
            break;
        }
    }

    if (!valid) {
        console.error('[stripe/webhook] bad signature');
        return NextResponse.json({ ok: false }, { status: 400 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch (err) {
        return NextResponse.json({ ok: false }, { status: 400 });
    }

    const admin = adminClient();

    // Stripe retries, so the same event can arrive twice. The primary key
    // on event_id turns a repeat into a harmless conflict.
    // Named for what it is. It used to be called logError, which shadowed the
    // import of the same name from lib/logError — the collision MAINTENANCE.md
    // warns about.
    const { error: eventInsertError } = await admin
        .from('stripe_events')
        .insert({ event_id: event.id, event_type: event.type, payload: event });

    if (eventInsertError && eventInsertError.code === '23505') {
        return NextResponse.json({ ok: true, duplicate: true });
    }

    try {
        // -------------------------------------------------------------
        // A host finished (or changed) their Connect onboarding.
        // -------------------------------------------------------------
        if (event.type === 'account.updated') {
            const account = event.data.object;
            const due: string[] = (account.requirements && account.requirements.currently_due) || [];
            const payoutsOn = account.payouts_enabled === true;

            await admin
                .from('profiles')
                .update({
                    stripe_charges_enabled: account.charges_enabled === true,
                    stripe_payouts_enabled: payoutsOn,
                    stripe_details_submitted: account.details_submitted === true,
                    stripe_requirements_due: due.length ? due.join(', ') : null,
                    identity_verified: payoutsOn,
                    identity_verified_at: payoutsOn ? new Date().toISOString() : null,
                    stripe_updated_at: new Date().toISOString(),
                })
                .eq('stripe_account_id', account.id);
        }

        // -------------------------------------------------------------
        // A guest completed the Stripe payment page.
        // -------------------------------------------------------------
        if (event.type === 'checkout.session.completed') {
            const cs = event.data.object;
            const bookingId = (cs.metadata && cs.metadata.booking_id) || cs.client_reference_id;
            const kind = (cs.metadata && cs.metadata.kind) || 'full';

            if (bookingId && cs.payment_status === 'paid') {
                const amount = Number(cs.amount_total || 0) / 100;

                // The card is saved on the PaymentIntent, so fetch it to
                // record what to charge for the balance later.
                let paymentMethodId: string | null = null;
                let customerId: string | null = (cs.customer as string) || null;

                try {
                    if (cs.payment_intent) {
                        const pi = await stripeRequest('GET', '/payment_intents/' + cs.payment_intent);
                        paymentMethodId = pi.payment_method || null;
                        if (!customerId) customerId = pi.customer || null;
                    }
                } catch (err) {
                    // Not fatal — the guest has paid. Only the automatic
                    // balance charge needs these, and there's a pay link
                    // as a fallback.
                    console.error('[stripe/webhook] could not read payment intent', err);
                }

                const { data: booking } = await admin
                    .from('bookings')
                    .select('id, status, total_price, listing_id, amount_paid, guest_id, check_in')
                    .eq('id', bookingId)
                    .maybeSingle();

                // A balance paid by hand from the reminder email. The booking
                // is already live, so only the money changes — the status and
                // the deposit already recorded are left alone.
                if (kind === 'balance') {
                    await admin
                        .from('bookings')
                        .update({
                            payment_status: 'paid',
                            amount_paid: Math.round((Number((booking && booking.amount_paid) || 0) + amount) * 100) / 100,
                            balance_amount: 0,
                            stripe_payment_intent_id: cs.payment_intent || null,
                        })
                        .eq('id', bookingId);

                    await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: 'balance',
                        amount: amount,
                        status: 'succeeded',
                        stripe_payment_intent_id: cs.payment_intent || null,
                    });

                    return NextResponse.json({ ok: true });
                }

                // Instant Book listings confirm on payment; request
                // bookings go back to pending for the host to accept.
                let nextStatus = 'pending';
                let listingTitle = 'your stay';
                if (booking) {
                    const { data: listing } = await admin
                        .from('listings')
                        .select('instant_book, title')
                        .eq('id', booking.listing_id)
                        .maybeSingle();
                    if (listing && listing.instant_book === true) nextStatus = 'confirmed';
                    listingTitle = (listing && listing.title) || listingTitle;
                }

                const paidPatch: Record<string, any> = {
                    payment_status: kind === 'deposit' ? 'deposit_paid' : 'paid',
                    amount_paid: amount,
                    paid_at: new Date().toISOString(),
                    stripe_payment_intent_id: cs.payment_intent || null,
                    stripe_customer_id: customerId,
                    stripe_payment_method_id: paymentMethodId,
                    status: nextStatus,
                    confirmed_at: nextStatus === 'confirmed' ? new Date().toISOString() : null,
                };

                // Paid in full, so nothing is outstanding. Set here as well as
                // at checkout, because this is the point the money landed.
                if (kind !== 'deposit') {
                    paidPatch.balance_amount = 0;
                }

                const { error: confirmError } = await admin
                    .from('bookings')
                    .update(paidPatch)
                    .eq('id', bookingId);

                // 23P01 is the exclusion constraint: somebody else's stay was
                // confirmed for these nights while this guest was paying. The
                // database is the only thing that can say so for certain, and
                // it has just said so.
                if (confirmError) {
                    const oversold = confirmError.code === '23P01';

                    await logError(
                        oversold
                            ? 'stripe/webhook: the dates were taken while the guest was paying'
                            : 'stripe/webhook: a paid booking could not be updated',
                        confirmError,
                        { path: 'stripe/webhook', userId: (booking && booking.guest_id) || undefined }
                    );

                    if (!oversold || !cs.payment_intent) {
                        // Not something a refund fixes. The money is here and
                        // the booking is not updated, which is exactly what
                        // /admin/errors is for.
                        return NextResponse.json({ ok: true });
                    }

                    // The guest has paid for nights they cannot have. The money
                    // goes back first, before the booking is touched, so they
                    // are never told the stay is off while it is still here.
                    // Keyed on the payment intent, so a redelivered event
                    // refunds once.
                    await stripeRequest(
                        'POST',
                        '/refunds',
                        {
                            payment_intent: cs.payment_intent,
                            amount: Math.round(amount * 100),
                            metadata: {
                                booking_id: bookingId,
                                reason: 'dates_taken_while_paying',
                                initiated_by: 'system',
                            },
                        },
                        'oversold-' + cs.payment_intent
                    );

                    await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: 'refund',
                        amount: amount,
                        status: 'succeeded',
                        stripe_payment_intent_id: cs.payment_intent,
                    });

                    // Only now, with the money on its way back.
                    await admin
                        .from('bookings')
                        .update({
                            status: 'cancelled',
                            payment_status: 'refunded',
                            // What happened is recorded truthfully: they paid,
                            // and they were paid back.
                            amount_paid: amount,
                            amount_refunded: amount,
                            balance_amount: 0,
                            // The overlap constraint fired: two confirmed
                            // stays on one week, so this one was refunded
                            // automatically. Nobody cancelled it, and it must
                            // never be read as a host having done so.
                            cancelled_at: new Date().toISOString(),
                            cancelled_by_role: 'system',
                            stripe_payment_intent_id: cs.payment_intent,
                        })
                        .eq('id', bookingId);

                    const guestId = booking && booking.guest_id;
                    const { data: guestUser } = guestId
                        ? await admin.auth.admin.getUserById(guestId)
                        : { data: null as any };
                    const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';

                    if (guestEmail) {
                        await sendEmail(
                            guestEmail,
                            'We\u2019re sorry \u2014 those dates went while you were paying',
                            emailLayout(
                                '<p style="margin:0 0 16px;font-size:16px;">We are very sorry. Somebody else\u2019s booking for <strong>'
                                    + escapeHtml(listingTitle)
                                    + '</strong> was confirmed for '
                                    + formatDate(booking ? booking.check_in : '')
                                    + ' in the moments while you were paying, so we cannot give you those nights.</p>'
                                    + '<p style="margin:0 0 16px;font-size:16px;">You have not been charged. The full <strong>\u00A3'
                                    + amount.toFixed(2)
                                    + '</strong> has already been sent back to your card and usually takes five to ten days to appear.</p>'
                                    + '<p style="margin:0 0 16px;font-size:16px;">This should not happen and it is our fault, not yours. If you would like help finding somewhere else for those dates, just reply to this email.</p>'
                                    + button(SITE_URL, 'Find another place'),
                                'You\u2019re receiving this because you tried to book with Galloway Getaways.'
                            )
                        );
                    }

                    return NextResponse.json({ ok: true, oversold: true, refunded: amount });
                }

                await admin.from('payments').insert({
                    booking_id: bookingId,
                    kind: kind,
                    amount: amount,
                    status: 'succeeded',
                    stripe_payment_intent_id: cs.payment_intent || null,
                });
            }
        }

        // -------------------------------------------------------------
        // A chargeback. The platform carries full liability for these, so
        // until now the first anyone knew was money missing from the balance.
        //
        // Stripe gives a deadline — commonly 7 to 21 days depending on the
        // card network — and a dispute nobody notices is lost by default
        // rather than on the facts. So this records it, and tells the
        // directors immediately rather than waiting for the 8am digest.
        //
        // Four events, because a dispute moves: created, updated (the guest's
        // bank adds something, or the deadline shifts), closed (won or lost),
        // and funds_reinstated (we won and the money came back).
        // -------------------------------------------------------------
        if (event.type.indexOf('charge.dispute.') === 0) {
            const d = event.data.object;

            // Find the booking from the payment intent. A dispute with no
            // booking behind it is still recorded — it is money leaving —
            // it just cannot say which stay.
            let bookingId: string | null = null;
            if (d.payment_intent) {
                const { data: booking } = await admin
                    .from('bookings')
                    .select('id')
                    .eq('stripe_payment_intent_id', d.payment_intent)
                    .maybeSingle();
                bookingId = (booking && booking.id) || null;
            }

            const dueBy = d.evidence_details && d.evidence_details.due_by
                ? new Date(d.evidence_details.due_by * 1000).toISOString()
                : null;

            const closed = event.type === 'charge.dispute.closed';
            const reinstated = event.type === 'charge.dispute.funds_reinstated';

            // Upserted on Stripe's own id, because these events arrive out of
            // order and more than once. Whatever the latest event says wins.
            const { error: upsertError } = await admin
                .from('disputes')
                .upsert(
                    {
                        booking_id: bookingId,
                        stripe_dispute_id: d.id,
                        stripe_charge_id: d.charge || null,
                        stripe_payment_intent_id: d.payment_intent || null,
                        amount: Number(d.amount || 0) / 100,
                        currency: (d.currency || 'gbp').toUpperCase(),
                        reason: d.reason || null,
                        status: d.status || null,
                        evidence_due_by: dueBy,
                        opened_at: d.created ? new Date(d.created * 1000).toISOString() : null,
                        closed_at: closed ? new Date().toISOString() : null,
                        funds_reinstated_at: reinstated ? new Date().toISOString() : null,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'stripe_dispute_id' }
                );

            if (upsertError) {
                await logError('[webhook] could not record dispute ' + d.id, upsertError, {
                    path: 'stripe/webhook',
                });
            }

            // Only shout when it opens or resolves. An 'updated' event can
            // fire several times and a stream of emails trains people to
            // ignore the one that matters.
            if (event.type === 'charge.dispute.created' || closed || reinstated) {
                await alertDirectors(admin, event.type, d, bookingId);
            }

            return NextResponse.json({ received: true, dispute: d.id });
        }

        // -------------------------------------------------------------
        // A charge failed — most likely a balance taken off-session.
        // -------------------------------------------------------------
        if (event.type === 'payment_intent.payment_failed') {
            const pi = event.data.object;
            const bookingId = pi.metadata && pi.metadata.booking_id;
            const reason = (pi.last_payment_error && pi.last_payment_error.message) || 'Payment failed';

            if (bookingId) {
                // The balance job records its own failures, and it knows things
                // this event does not — chiefly whether the bank wanted the
                // guest to authenticate, which Stripe's message calls a
                // decline. Writing this one as well left two rows for one
                // failure, in different words, and the job reads the most
                // recent one back to decide how long the guest gets.
                const { data: already } = await admin
                    .from('payments')
                    .select('id')
                    .eq('stripe_payment_intent_id', pi.id)
                    .eq('status', 'failed')
                    .limit(1)
                    .maybeSingle();

                if (!already) {
                    await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: (pi.metadata && pi.metadata.kind) || 'balance',
                        amount: Number(pi.amount || 0) / 100,
                        status: 'failed',
                        stripe_payment_intent_id: pi.id,
                        failure_reason: reason,
                    });
                }
            }
        }
    } catch (err: any) {
        console.error('[stripe/webhook] handler failed:', event.type, err && err.message);
        // Still return 200 — the event is logged, and reporting a failure
        // just makes Stripe retry a broken handler forever.
    }

    return NextResponse.json({ ok: true });
}
