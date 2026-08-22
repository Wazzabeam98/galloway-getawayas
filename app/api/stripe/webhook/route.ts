import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { verifyStripeSignature, stripeRequest } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

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
