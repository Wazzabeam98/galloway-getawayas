import { logError } from '@/lib/logError';
import { guidanceFor } from '@/lib/disputes';
import { sendEmail, sendEmailToAll, recipients, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { verifyStripeSignature, stripeRequest } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Tells us, now. Not the 8am error digest: a dispute has a hard deadline
// measured in days, and a summary the next morning can burn a fifth of it.
//
// Goes to DISPUTES_ALERT_EMAIL, not to whoever happens to have `is_admin` set.
// That lookup read each director's own account address, which meant the one
// email carrying an evidence deadline — with the money already taken back —
// arrived in a personal Hotmail inbox. An alias is somewhere a deadline can be
// seen by whoever is actually looking, and it changes without a deploy.
async function alertDirectors(
    admin: any,
    eventType: string,
    dispute: any,
    bookingId: string | null
): Promise<void> {
    try {
        // Comma-split, so a second address reaches a second person rather than
        // being handed to Resend as one malformed recipient.
        const to = recipients(process.env.DISPUTES_ALERT_EMAIL);

        if (!to.length) {
            await logError('[webhook] DISPUTES_ALERT_EMAIL is not set — nobody was told about a dispute', {
                event: eventType,
                dispute: dispute && dispute.id,
                booking: bookingId,
            }, { path: 'stripe/webhook' });
            return;
        }

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

        const { sent, failed } = await sendEmailToAll(
            to,
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

        // sendEmailToAll returns rather than throwing, so the catch below
        // never sees an ordinary failure. On this email of all of them, a
        // silent one costs the evidence window and the money with it.
        //
        // Logged per address. If the variable names two directors and one copy
        // bounces, the other arriving must not make this look fine — the one
        // who did not get it is the one who might have been handling it.
        if (failed.length) {
            await logError('[webhook] a dispute alert did not send', {
                event: eventType,
                dispute: dispute && dispute.id,
                booking: bookingId,
                failed: failed.join(', '),
                reached: sent.join(', '),
            }, { path: 'stripe/webhook' });
        }
    } catch (err) {
        // A dispute that was recorded but not emailed is recoverable; one that
        // throws here and rolls back the whole webhook is not.
        await logError('[webhook] recorded a dispute but could not alert the directors', err, {
            path: 'stripe/webhook',
        });
    }
}

// -------------------------------------------------------------------------
// FAULT INJECTION — for the demonstration in WEBHOOK-FAILURE.md.
//
// This exists because "the handler throws and nobody finds out" is a claim
// that should be shown rather than argued, and because the fix for it should
// be shown working the same way. A real handler throws for reasons you cannot
// summon on demand — a network blip to Supabase, an unexpected event shape, a
// null where an object was assumed — so the throw is injected instead.
//
// IT CANNOT FIRE IN PRODUCTION. Three independent things all have to be true,
// and two of them are not things a mistake can arrange:
//
//   1. The event has to carry metadata.fault_stage. Nothing we create at
//      checkout ever sets it, so no real session has it.
//   2. The event has to pass Stripe's signature check, which happens before
//      any of this — so it has to come from something holding the signing
//      secret, not from anyone who can reach the URL.
//   3. The Stripe key has to be a TEST key. Production runs on sk_live_.
//      This is the same guard scripts/seed-lib.mjs uses before it is allowed
//      to touch anything, and no environment variable can turn it off.
//
// Delete it if you would rather not have it. scripts/webhook-fault.mjs is the
// only thing that sets the field, and it is a demonstration, not a test — the
// unit tests in tests/webhook-reporting.test.ts cover the same ground without
// it.
function injectedFault(stage: string, session: any): void {
    const wanted = session && session.metadata && session.metadata.fault_stage;
    if (!wanted) return;
    if (!(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) return;
    if (wanted !== stage) return;

    throw new Error('injected fault at ' + stage + ' (metadata.fault_stage)');
}

// Whatever the event was, this is the thing a person needs first: which
// booking is now wrong. Every event shape we handle carries it somewhere
// different, and this is called from a catch block, so it must not be able to
// throw on the way to reporting a throw.
function bookingIdFrom(event: any): string | null {
    try {
        const o = (event && event.data && event.data.object) || {};
        return (o.metadata && o.metadata.booking_id) || o.client_reference_id || null;
    } catch (err) {
        return null;
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

    // Any OTHER failure to record the event was discarded. Carrying on is the
    // right call — refusing to handle a payment because the audit row would
    // not write is worse than handling it — but it must not be silent. With
    // no row here the duplicate check above cannot fire, so a Stripe retry
    // WILL run this handler a second time, and the balance branch below is
    // not safe to run twice.
    if (eventInsertError) {
        await logError(
            '[webhook] could not record the event, so a redelivery of it will be handled again '
                + 'rather than recognised as a duplicate',
            eventInsertError,
            { path: 'stripe/webhook' }
        );
    }

    try {
        // -------------------------------------------------------------
        // A host finished (or changed) their Connect onboarding.
        // -------------------------------------------------------------
        if (event.type === 'account.updated') {
            const account = event.data.object;
            const due: string[] = (account.requirements && account.requirements.currently_due) || [];
            const payoutsOn = account.payouts_enabled === true;

            // The error was discarded here. supabase-js does not throw on a
            // failed write — it hands the error back in the result — so a
            // failure did not reach the catch at the bottom of this function
            // either. It reached nothing at all.
            //
            // What that costs: this row is how the site knows a host can be
            // paid. If the write fails, the host finishes their Stripe
            // onboarding, Stripe is satisfied, and the payout job goes on
            // skipping them because our copy still says they are not set up.
            // They chase you about a payout that was never attempted.
            const { error: accountError } = await admin
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

            if (accountError) {
                await logError(
                    '[webhook] could not record a host’s Stripe account state — payouts to '
                        + 'them will be skipped until this is put right',
                    accountError,
                    { path: 'stripe/webhook' }
                );
            }
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

                // The guest's money is at Stripe and nothing here has run yet.
                injectedFault('before-write', cs);

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
                    //
                    // Reported all the same, because "not fatal" is doing a
                    // lot of work in that sentence: without a saved card the
                    // balance cannot be taken automatically 30 days out, so
                    // the whole failure ladder is off for this booking and
                    // the first anyone would know is a guest who never paid.
                    // Whoever reads /admin/errors can go and fix the card on
                    // file while there is still a month to do it in.
                    console.error('[stripe/webhook] could not read payment intent', err);
                    await logError(
                        '[webhook] could not read the payment intent, so no card was saved — '
                            + 'the balance for this booking cannot be charged automatically',
                        err,
                        { path: 'stripe/webhook' }
                    );
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
                    // NOTE FOR ANYONE CHANGING THE RETRY BEHAVIOUR. This line
                    // ADDS to amount_paid rather than setting it, which is
                    // correct for one delivery and wrong for two. It is the
                    // single reason this handler cannot simply be retried —
                    // see the catch at the bottom and WEBHOOK-FAILURE.md.
                    const { error: balanceError } = await admin
                        .from('bookings')
                        .update({
                            payment_status: 'paid',
                            amount_paid: Math.round((Number((booking && booking.amount_paid) || 0) + amount) * 100) / 100,
                            balance_amount: 0,
                            stripe_payment_intent_id: cs.payment_intent || null,
                        })
                        .eq('id', bookingId);

                    if (balanceError) {
                        await logError(
                            '[webhook] a guest paid their balance and the booking could not be updated',
                            balanceError,
                            { path: 'stripe/webhook', userId: (booking && booking.guest_id) || undefined }
                        );
                    }

                    const { error: balanceLedgerError } = await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: 'balance',
                        amount: amount,
                        status: 'succeeded',
                        stripe_payment_intent_id: cs.payment_intent || null,
                    });

                    if (balanceLedgerError) {
                        await logError(
                            '[webhook] a balance payment is missing from the payments ledger',
                            balanceLedgerError,
                            { path: 'stripe/webhook' }
                        );
                    }

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

                    const { error: refundLedgerError } = await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: 'refund',
                        amount: amount,
                        status: 'succeeded',
                        stripe_payment_intent_id: cs.payment_intent,
                    });

                    if (refundLedgerError) {
                        await logError(
                            '[webhook] an oversold booking was refunded at Stripe but the refund is '
                                + 'missing from the payments ledger',
                            refundLedgerError,
                            { path: 'stripe/webhook' }
                        );
                    }

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

                // The booking has been confirmed. The payments ledger has
                // not been written. This is the "half its work" state that
                // decides whether a retry is safe.
                injectedFault('after-booking-update', cs);

                const { error: ledgerError } = await admin.from('payments').insert({
                    booking_id: bookingId,
                    kind: kind,
                    amount: amount,
                    status: 'succeeded',
                    stripe_payment_intent_id: cs.payment_intent || null,
                });

                // The booking says the guest paid and the ledger does not.
                // Nothing visible breaks — the guest has their stay — so this
                // would be found at the year end, in the accounts, by which
                // time nobody can say what happened.
                if (ledgerError) {
                    await logError(
                        '[webhook] a booking was confirmed but the payment is missing from the '
                            + 'payments ledger',
                        ledgerError,
                        { path: 'stripe/webhook' }
                    );
                }
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
                    const { error: failedRowError } = await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: (pi.metadata && pi.metadata.kind) || 'balance',
                        amount: Number(pi.amount || 0) / 100,
                        status: 'failed',
                        stripe_payment_intent_id: pi.id,
                        failure_reason: reason,
                    });

                    // The balance job reads the most recent failed row back to
                    // decide how long the guest gets before the booking is
                    // called off. A failure to write it does not stop the
                    // ladder — it makes the ladder count from the wrong place.
                    if (failedRowError) {
                        await logError(
                            '[webhook] could not record a failed payment — the balance failure '
                                + 'ladder for this booking may count from the wrong point',
                            failedRowError,
                            { path: 'stripe/webhook' }
                        );
                    }
                }
            }
        }
    } catch (err: any) {
        console.error('[stripe/webhook] handler failed:', event.type, err && err.message);

        // STILL 200, AND THAT IS DELIBERATE. See WEBHOOK-FAILURE.md for the
        // run that settles it, but briefly:
        //
        //   Returning 500 would not fix anything. The stripe_events row above
        //   is written BEFORE this try block, so Stripe's retry arrives, hits
        //   the duplicate check, and is answered 200 without the handler
        //   running at all. Measured: the booking was still pending_payment
        //   after the retry.
        //
        //   And if that were changed so a retry did re-run, the retry would
        //   not be safe. The balance branch ADDS to amount_paid rather than
        //   setting it, and `payments` has no unique key on the payment
        //   intent — checked by inserting the same row twice, which the
        //   database accepted. A retry over a partial write double-counts
        //   money. That is worse than the failure it is trying to repair.
        //
        // So the answer is not a retry. It is that somebody finds out within
        // minutes instead of when the guest emails. console.error is a Vercel
        // log nobody reads; this reaches /admin/errors and the 8am digest.
        //
        // The event id is in here on purpose: it is what you need to find the
        // event in Stripe, and to clear the stripe_events row by hand if you
        // decide to replay it after fixing the cause.
        await logError(
            '[webhook] handler threw on ' + event.type + ' — the event is recorded as delivered '
                + 'and nothing was retried',
            {
                event_id: event.id,
                event_type: event.type,
                message: (err && err.message) || String(err),
                stack: err && err.stack,
                booking_id: bookingIdFrom(event),
            },
            { path: 'stripe/webhook' }
        );
    }

    return NextResponse.json({ ok: true });
}
