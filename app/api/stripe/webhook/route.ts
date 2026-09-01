import { logError } from '@/lib/logError';
import { guidanceFor } from '@/lib/disputes';
import { sendEmail, sendEmailToAll, recipients, emailLayout, escapeHtml, formatDate, button, detailRows, SITE_URL } from '@/lib/email';
import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { verifyStripeSignature, stripeRequest } from '@/lib/stripe';
import { expiryFrom } from '@/lib/serviceOrders';
import { displayName } from '@/lib/utils';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';

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

            // A SLOT BOOKING WAS PAID.
            //
            // The seat was already claimed when the guest started Checkout, and a
            // 'holding' order was written then. Payment is automatic-capture, so
            // completing Checkout means the money moved: turn the hold into a
            // confirmed booking. Idempotent twice over — the stripe_events unique
            // insert dedupes redelivery, and the update only touches a row still
            // 'holding', so a replay after the sweep already expired it does
            // nothing. The seat is not touched here; it was taken at booking.
            if (kind === 'slot_order') {
                const orderId = cs.metadata && cs.metadata.order_id;
                const slotPi = (cs.payment_intent as string) || null;
                if (orderId) {
                    const { error: slotConfErr } = await admin
                        .from('service_orders')
                        .update({ status: 'confirmed', stripe_payment_intent_id: slotPi })
                        .eq('id', orderId)
                        .eq('status', 'holding');
                    if (slotConfErr) {
                        console.error('[webhook] slot-order confirm', orderId, slotConfErr.message);
                    }
                    // TODO(marketplace next phase): email the provider the new
                    // booking (the diary notification) and the guest their
                    // confirmation.
                }
            }

            // A TRADESMAN PUTTING A CARD ON FILE.
            //
            // Nothing is charged here and nothing should be: the subscription
            // was created with `trial_end` set from his existing
            // `trial_ends_at`, so Stripe bills him for the first time on the
            // day we put in writing rather than today. What this event means is
            // only that he finished the Checkout page.
            //
            // This write is what "has a card" means everywhere else — the
            // reminder ladder stops, the grace clock stops, and the listing
            // stops being at risk. It is deliberately NOT written when the
            // session is created, because an abandoned checkout must never
            // leave a row claiming he pays us.
            if (kind === 'provider_subscription') {
                const providerId = (cs.metadata && cs.metadata.provider_id) || null;
                const subscriptionId = (cs.subscription as string) || null;
                const customerId = (cs.customer as string) || null;

                if (providerId && subscriptionId) {
                    const { error: subError } = await admin
                        .from('service_providers')
                        .update({
                            stripe_subscription_id: subscriptionId,
                            stripe_customer_id: customerId,
                            // Trialing, not active: he has a card and a
                            // subscription, and Stripe has charged him nothing
                            // yet. customer.subscription.updated moves it on
                            // when the trial actually ends.
                            subscription_status: 'trialing',
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', providerId)
                        // Guarded on there being no subscription yet. A
                        // redelivered event, or a second checkout completed by
                        // an old link, must not overwrite a live subscription
                        // id with a different one — that would leave us
                        // reconciling against the wrong subscription and him
                        // paying twice.
                        .is('stripe_subscription_id', null);

                    if (subError) {
                        await logError(
                            '[webhook] could not record a provider subscription',
                            subError,
                            { path: 'stripe/webhook' }
                        );
                    }
                }
            }

            // A guest experience. The card is HELD, not charged — the session
            // completing means the hold is placed, and the order now waits for
            // the provider to confirm before a penny moves. Created here, once,
            // because the stripe_events unique insert above dedupes redelivery.
            if (kind === 'service_order') {
                const md = cs.metadata || {};
                const piId = (cs.payment_intent as string) || null;

                const { data: prov } = await admin
                    .from('service_providers')
                    .select('id, business_name, trade, contact_email, exclusive_per_date')
                    .eq('id', md.provider_id)
                    .maybeSingle();

                const { data: guest } = await admin
                    .from('profiles')
                    .select('id, full_name, preferred_name, show_full_name, phone, email')
                    .eq('id', md.guest_id)
                    .maybeSingle();

                const guestsNum = md.guests ? parseInt(md.guests, 10) : null;
                const nowIso = new Date().toISOString();

                const { data: order, error: orderErr } = await admin
                    .from('service_orders')
                    .insert({
                        provider_id: md.provider_id,
                        guest_id: md.guest_id,
                        listing_id: md.listing_id || null,
                        booking_id: md.booking_id || null,
                        trade: (prov && prov.trade) || null,
                        // Snapshotted so the one-per-date unique index can see it
                        // (an index predicate reads only its own table's columns).
                        // A chef/masseur is exclusive; a baker is not.
                        exclusive_per_date: !!(prov && prov.exclusive_per_date),
                        service_date: md.service_date,
                        guests: Number.isFinite(guestsNum as number) ? guestsNum : null,
                        price: Number(cs.amount_total || 0) / 100,
                        commission_rate: Number(md.commission_rate) || 0.10,
                        status: 'authorised',
                        // The provider is a third party — a chef, a photographer, a
                        // guide — so this goes through displayName() like any other
                        // place one person is named to another. It is stored rather
                        // than looked up at read time, so an unhonoured value here
                        // would outlive the setting that should have masked it.
                        //
                        // Empty fallback, stored as null: the provider's dashboard
                        // omits the "For ..." line entirely when there is no name,
                        // which reads better than "For Guest".
                        guest_name: displayName(guest, '') || null,
                        guest_phone: guest ? guest.phone : null,
                        guest_email: (guest && guest.email) || cs.customer_details?.email || null,
                        note: md.note || null,
                        provider_business_name: prov ? prov.business_name : null,
                        // The item the guest picked, snapshotted so editing or
                        // removing it later never rewrites this order. item_id is
                        // a soft link (null if that metadata is absent).
                        item_id: md.item_id || null,
                        item_name: md.item_name || null,
                        item_description: md.item_description || null,
                        // The unit, per-unit price and count, snapshotted with
                        // the rest. price (above) is the total actually charged;
                        // these say how it was arrived at — "6 × £30 per person".
                        item_unit: md.item_unit || null,
                        unit_price: md.unit_price ? Number(md.unit_price) : null,
                        quantity: md.quantity ? parseInt(md.quantity, 10) : 1,
                        stripe_payment_intent_id: piId,
                        expires_at: expiryFrom(nowIso),
                        created_at: nowIso,
                    })
                    .select('id')
                    .single();

                // LOST THE RACE (chefs only). Two guests can both pass the order
                // route's pre-check for a chef in the same moment; the partial
                // unique index (20260901160000, chef-only) then lets exactly one
                // order exist and rejects the other. The rejected guest has a
                // hold on their card for an evening that is no longer theirs —
                // so release it here, at once, rather than leaving them held for
                // 48 hours for nothing. A baker has no such index, so this never
                // fires for them (they can take many orders per date).
                //
                // '23505' is a unique violation. Any other insert error is a
                // real failure: the hold stands and the sweep will release it,
                // and it is reported rather than swallowed.
                if (orderErr) {
                    const raced = (orderErr as any).code === '23505';
                    if (raced && piId) {
                        try {
                            await stripeRequest(
                                'POST',
                                '/payment_intents/' + piId + '/cancel',
                                undefined,
                                'cancel-race-' + piId
                            );
                        } catch (cancelErr: any) {
                            await logError('[webhook] could not release a raced service-order hold', cancelErr, { path: 'stripe/webhook' });
                        }
                    }
                    await logError(
                        raced
                            ? '[webhook] a second guest lost the race for a slot; their hold was released'
                            : '[webhook] a service order could not be recorded',
                        orderErr,
                        { path: 'stripe/webhook' }
                    );
                    // Handled: the event is dealt with, so Stripe should not retry.
                    return NextResponse.json({ ok: true });
                }

                // Tell the provider there is something to answer. Best-effort:
                // the hold is placed whether or not the mail sends, and the
                // provider dashboard shows it regardless.
                try {
                    if (prov && prov.contact_email && order) {
                        await sendEmail(
                            prov.contact_email,
                            'A guest would like to book you',
                            emailLayout(
                                '<p>A guest staying nearby has asked to book '
                                + escapeHtml(prov.business_name || 'your experience')
                                + ' for ' + escapeHtml(String(md.service_date)) + '.</p>'
                                + '<p>Their card is held, not charged. Confirm within 48 hours to '
                                + 'take the booking; if you can’t make it, decline and the hold is '
                                + 'released.</p>'
                                // Their dashboard, where the request is waiting
                                // to confirm or decline. The old link carried
                                // ?section=orders, which nothing reads, so it
                                // dropped the chef on the trade picker — the
                                // first link a provider ever clicks, dead. A
                                // guest provider's dashboard now lives here.
                                + button(SITE_URL + '/services/dashboard', 'View the request'),
                                'You’re receiving this because you offer experiences on Galloway Getaways.'
                            )
                        );
                    }
                } catch (mailErr) {
                    console.error('[stripe/webhook] service order notify failed', mailErr);
                }

                return NextResponse.json({ ok: true });
            }

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
                    .select('id, status, total_price, listing_id, amount_paid, guest_id, check_in, check_out, host_id')
                    .eq('id', bookingId)
                    .maybeSingle();

                // A balance paid by hand from the reminder email. The booking
                // is already live, so only the money changes — the status and
                // the deposit already recorded are left alone.
                if (kind === 'balance') {
                    // THE LEDGER ROW GOES FIRST, AND IT IS WHAT DECIDES.
                    //
                    // This used to update the booking first and then write the
                    // ledger row, with amount_paid = amount_paid + amount.
                    // Adding is the right sum — the deposit is already in that
                    // column and the balance is on top of it — but it is right
                    // exactly once, and nothing made it once. One £150 balance
                    // handled twice left a £300 booking claiming £450 had been
                    // paid. Refunds and host payouts are both worked out from
                    // that figure. MONEY-IDEMPOTENCY.md has the run.
                    //
                    // The fix is not to set instead of add — setting it to
                    // `amount` would forget the deposit and understate what
                    // the guest paid, which is the same bug pointing the other
                    // way. It is to know whether this payment has already been
                    // counted, and the database is the only thing that can say
                    // so for certain.
                    //
                    // So: insert the ledger row first, and let the unique index
                    // from 20260829090000_payments_one_row_per_intent.sql
                    // answer the question. A 23505 here is not a failure, it is
                    // the answer "this payment intent is already in the ledger"
                    // — so leave amount_paid alone.
                    //
                    // THIS NEEDS THAT MIGRATION APPLIED FIRST. Without the
                    // index nothing ever conflicts, alreadyCounted is never
                    // true, and this quietly goes back to double-counting.
                    // AND IT NEEDS AN INTENT ID ON THE ROW. The index only
                    // covers rows where stripe_payment_intent_id is not null —
                    // it has to, because the balance job claims an `attempting`
                    // row before a payment intent exists. So a balance row
                    // written without one is not protected: nothing conflicts,
                    // alreadyCounted is never true, and the double-count is
                    // back, silently.
                    //
                    // Not hypothetical. Every `balance` row on production today
                    // — three succeeded, three failed, all from mid-August —
                    // has a null intent. They are historical and no two of them
                    // are duplicates, but they are what this looks like when it
                    // happens. A checkout session for a balance always carries
                    // a payment intent, so if this ever fires something has
                    // changed at Stripe's end and the protection is off.
                    if (!cs.payment_intent) {
                        await logError(
                            '[webhook] a balance payment arrived with no payment intent, so it '
                                + 'cannot be protected against being counted twice',
                            { booking_id: bookingId, amount: amount, event_id: event.id },
                            { path: 'stripe/webhook' }
                        );
                    }

                    const { error: balanceLedgerError } = await admin.from('payments').insert({
                        booking_id: bookingId,
                        kind: 'balance',
                        amount: amount,
                        status: 'succeeded',
                        stripe_payment_intent_id: cs.payment_intent || null,
                    });

                    const alreadyCounted =
                        !!balanceLedgerError && balanceLedgerError.code === '23505';

                    if (balanceLedgerError && !alreadyCounted) {
                        await logError(
                            '[webhook] a balance payment is missing from the payments ledger',
                            balanceLedgerError,
                            { path: 'stripe/webhook' }
                        );
                    }

                    // Everything except the money is safe to write again:
                    // 'paid' is 'paid', and a zero balance is a zero balance.
                    const balancePatch: Record<string, any> = {
                        payment_status: 'paid',
                        balance_amount: 0,
                        stripe_payment_intent_id: cs.payment_intent || null,
                    };

                    if (!alreadyCounted) {
                        balancePatch.amount_paid =
                            Math.round((Number((booking && booking.amount_paid) || 0) + amount) * 100) / 100;
                    }

                    const { error: balanceError } = await admin
                        .from('bookings')
                        .update(balancePatch)
                        .eq('id', bookingId);

                    if (balanceError) {
                        await logError(
                            '[webhook] a guest paid their balance and the booking could not be updated',
                            balanceError,
                            { path: 'stripe/webhook', userId: (booking && booking.guest_id) || undefined }
                        );
                    }

                    return NextResponse.json({ ok: true, counted: !alreadyCounted });
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
                //
                // 23505 is NOT that. It is the unique index from
                // 20260829090000_payments_one_row_per_intent.sql saying this
                // payment is already recorded, which is a redelivery working
                // exactly as intended. Caught by delivering a paid event twice
                // against the running site: the ledger correctly held one row
                // and /admin/errors got a "the payment is missing" alarm about
                // a payment that was right there. A page of false alarms is a
                // page nobody reads.
                //
                // Unlike the balance branch, nothing else here needs to know:
                // this update SETS amount_paid to the amount of this payment
                // rather than adding to it, so running it again writes the
                // same number.
                if (ledgerError && ledgerError.code !== '23505') {
                    await logError(
                        '[webhook] a booking was confirmed but the payment is missing from the '
                            + 'payments ledger',
                        ledgerError,
                        { path: 'stripe/webhook' }
                    );
                }

                // A WORK DAY JUST GOT A GUEST ON IT.
                //
                // The host asked a tradesman to come on a day this booking now
                // covers. Neither blocks the other — a two-hour job the
                // afternoon a guest arrives is fine — but it is a clash the host
                // would otherwise find only by opening the calendar, and the
                // whole point is that this booking arrived while they were not
                // looking. So they are emailed: cottage, date, trade, enough to
                // decide without opening anything.
                //
                // Guarded on the 23505 above: a redelivered paid event finds the
                // payment already in the ledger, and must not send this twice.
                // Only accepted, planned enquiries carry a date, so only they can
                // land on a day. "Asked for", never "booked" — the wording comes
                // from lib/serviceEnquiries and is the same line the calendar and
                // the emails already hold.
                const firstDelivery = !(ledgerError && ledgerError.code === '23505');

                if (
                    firstDelivery && booking
                    && booking.listing_id && booking.check_in && booking.check_out && booking.host_id
                ) {
                    try {
                        const { data: clashes } = await admin
                            .from('service_enquiries')
                            .select('trade, business_name, preferred_date, window_from, window_to')
                            .eq('listing_id', booking.listing_id)
                            .eq('status', 'accepted')
                            .eq('urgency', 'planned')
                            .gte('preferred_date', booking.check_in)
                            .lt('preferred_date', booking.check_out);

                        if (clashes && clashes.length) {
                            const { data: hostUser } = await admin.auth.admin.getUserById(booking.host_id);
                            const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';

                            if (hostEmail) {
                                const rows = clashes.map((c: any) => ({
                                    label: tradeLabel(c.trade) || 'Work',
                                    // requestedWhen begins "Asked for" — dropped
                                    // here only because the line above already
                                    // says these are days you asked for.
                                    value: (requestedWhen(c) || 'a day during this stay')
                                        .replace(/^Asked for /, ''),
                                }));

                                await sendEmail(
                                    hostEmail,
                                    'A booking landed on a day you’ve got work coming — ' + listingTitle,
                                    emailLayout(
                                        '<p style="margin:0 0 16px;font-size:16px;">A new booking for <strong>'
                                            + escapeHtml(listingTitle)
                                            + '</strong> covers '
                                            + formatDate(booking.check_in) + ' to ' + formatDate(booking.check_out)
                                            + ', and that overlaps a day you have a trade coming to the cottage.</p>'
                                        + '<p style="margin:0 0 8px;font-size:16px;">What you asked for on those dates:</p>'
                                        + detailRows(rows)
                                        + '<p style="margin:16px 0;font-size:16px;">Nothing is blocked and nothing has changed — a short job and a guest can share a day. But it is a different conversation with the tradesman, so we wanted you to know before it caught you out.</p>'
                                        + button(SITE_URL + '/dashboard/calendar', 'Open your calendar'),
                                        'You’re receiving this because a booking overlapped work you asked for on your Galloway Getaways cottage.'
                                    )
                                );
                            }
                        }
                    } catch (err) {
                        // A courtesy email that fails must never affect the
                        // booking: the money has landed and the stay is live.
                        await logError(
                            '[webhook] could not warn the host that a booking overlaps work they asked for',
                            err,
                            { path: 'stripe/webhook' }
                        );
                    }
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
        // THE SUBSCRIPTION MOVING, AFTER HE HAS A CARD.
        //
        // From here on the money is Stripe Billing's problem rather than ours:
        // it retries, it dunns, it updates expired cards. What we keep is a
        // copy of its verdict, because the directory has to know whether to
        // show him.
        //
        // The vocabulary is Stripe's own, copied rather than translated. A
        // mapping between two sets of status names is a thing that can be
        // wrong in a way nobody notices until somebody is either billed twice
        // or never billed at all.
        //
        // NOTE WHICH STATUS HIDES A LISTING: only 'unpaid'. past_due does not,
        // because Stripe is still retrying and a listing that flickers off on
        // the first failed card and back on the retry is worse than one that
        // waits for the answer. See visibleInDirectory.
        if (event.type === 'customer.subscription.updated'
            || event.type === 'customer.subscription.deleted') {
            const sub = event.data.object;
            const subscriptionId = String(sub.id || '');

            // Deleted means cancelled outright — by Stripe after its retries
            // gave up, or by us. Either way he is no longer paying, so the
            // listing comes down. 'canceled' rather than 'unpaid' would be
            // more faithful to Stripe and would leave him listed, which is the
            // wrong way round for the one case where we know he is not paying.
            const status = event.type === 'customer.subscription.deleted'
                ? 'unpaid'
                : String(sub.status || 'active');

            if (subscriptionId) {
                const { error: statusError } = await admin
                    .from('service_providers')
                    .update({ subscription_status: status, updated_at: new Date().toISOString() })
                    .eq('stripe_subscription_id', subscriptionId);

                if (statusError) {
                    await logError(
                        '[webhook] could not record a subscription status change',
                        statusError,
                        { path: 'stripe/webhook' }
                    );
                }
            }
        }

        // A payment that failed. Recorded, not acted on.
        //
        // Stripe will retry on its own schedule and this event fires on every
        // attempt, so doing anything irreversible here would act three or four
        // times on one failure. The status change that matters arrives as
        // customer.subscription.updated when Stripe moves him to past_due, and
        // as .deleted when it gives up.
        if (event.type === 'invoice.payment_failed') {
            const inv = event.data.object;
            const subscriptionId = (inv.subscription as string) || '';

            if (subscriptionId) {
                const { data: prov } = await admin
                    .from('service_providers')
                    .select('id, business_name, contact_email')
                    .eq('stripe_subscription_id', subscriptionId)
                    .maybeSingle();

                await logError(
                    '[webhook] a provider subscription payment failed',
                    new Error('invoice ' + String(inv.id || '') + ' failed for '
                        + String((prov && prov.business_name) || subscriptionId)),
                    { path: 'stripe/webhook' }
                );
            }
        }

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
                    //
                    // 23505 excepted. The `already` check just above is not
                    // atomic, so the balance job and this event can race to
                    // write the same failure. The unique index settles it, and
                    // one of them losing is the mechanism working rather than
                    // something worth waking anybody for.
                    if (failedRowError && failedRowError.code !== '23505') {
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
