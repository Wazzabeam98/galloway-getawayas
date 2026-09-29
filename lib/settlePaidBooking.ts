// A GUEST PAID FOR A STAY — THE ONE WAY A COTTAGE PAYMENT IS SETTLED.
//
// Lifted out of the Stripe webhook unchanged in what it does, so that the three
// places that can learn a guest has paid all settle it through the same code:
//
//   - the webhook, when checkout.session.completed arrives (the normal path);
//   - the reconcile cron (app/api/cron/booking-payments), when that event was
//     lost or failed its signature check and a charged guest would otherwise
//     sit at pending_payment with nobody told;
//   - the success page (/booking-confirmed/[id]), which asks Stripe itself when
//     the guest gets back before the webhook does.
//
// NEVER TWICE. Any two of those can run at once for the same payment — the
// guest lands on the success page in the same second the webhook arrives. The
// deposit/full confirm is therefore a compare-and-set on status =
// 'pending_payment': Postgres serialises the two UPDATEs on the row lock, the
// second re-checks the WHERE against the committed row, matches nothing, and
// returns without writing the ledger or sending a single email. The ledger's
// one-row-per-intent index is still there underneath as a second wall.
//
// The same guard mends an older hole: a redelivered paid event used to
// rewrite status from scratch, so a request booking the host had already
// accepted (pending -> confirmed) could be put back to 'pending' by a replay.
//
// `cs` is a Checkout Session object — from the webhook event, or fetched from
// Stripe by the cron and the success page. Nothing here trusts the browser.

import { logError } from '@/lib/logError';
import { logMoneyFailure } from '@/lib/moneyAlert';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, detailRows, SITE_URL } from '@/lib/email';
import { stripeRequest } from '@/lib/stripe';
import { displayName } from '@/lib/utils';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';
import { guestBookedEmail, guestRequestReceivedEmail, hostNewBookingEmail, arrivalLineFrom } from '@/lib/bookingEmails';
import { cancellationPosition } from '@/lib/cancellationView';
import { closeOpenBookingRequests } from '@/lib/closeBookingRequests';

export interface SettleResult {
    ok: true;
    [key: string]: any;
}

/** The booking a Checkout Session paid for, if it is a cottage stay at all. */
export function bookingIdOf(cs: any): string | null {
    return (cs && ((cs.metadata && cs.metadata.booking_id) || cs.client_reference_id)) || null;
}

export async function settlePaidBookingSession(
    admin: any,
    cs: any,
    eventId: string | null
): Promise<SettleResult> {
    const bookingId = bookingIdOf(cs);
    const kind = (cs.metadata && cs.metadata.kind) || 'full';
    if (!bookingId || cs.payment_status !== 'paid') return { ok: true, skipped: 'not a paid booking session' };

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
        .select('id, status, total_price, listing_id, amount_paid, amount_refunded, guests, balance_amount, balance_due_date, guest_id, check_in, check_out, host_id')
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
                { booking_id: bookingId, amount: amount, event_id: eventId },
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
            await logMoneyFailure(
                '[webhook] a guest paid their balance and the booking could not be updated',
                balanceError,
                { path: 'stripe/webhook', userId: (booking && booking.guest_id) || undefined }
            );
        }

        return { ok: true, counted: !alreadyCounted };
    }

    // Instant Book listings confirm on payment; request
    // bookings go back to pending for the host to accept.
    let nextStatus = 'pending';
    let listingTitle = 'your stay';
    let listingRow: any = null;
    if (booking) {
        const { data: listing } = await admin
            .from('listings')
            .select('instant_book, title, check_in_time, check_in_end_time, check_out_time, cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();
        listingRow = listing || null;
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

    // The compare-and-set described at the top of this file. Only a booking
    // still waiting on this payment is moved; one the webhook, the cron or the
    // success page has already settled comes back as zero rows.
    const { data: confirmedRows, error: confirmError } = await admin
        .from('bookings')
        .update(paidPatch)
        .eq('id', bookingId)
        .eq('status', 'pending_payment')
        .select('id');

    // 23P01 is the exclusion constraint: somebody else's stay was
    // confirmed for these nights while this guest was paying. The
    // database is the only thing that can say so for certain, and
    // it has just said so.
    if (confirmError) {
        const oversold = confirmError.code === '23P01';

        await logMoneyFailure(
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
            return { ok: true };
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

        // An oversold stay is off, so close anything still open against it.
        await closeOpenBookingRequests(admin, bookingId);

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

        return { ok: true, oversold: true, refunded: amount };
    }

    // Already settled by whichever of the three paths got here first — or the
    // booking has since moved on (accepted, cancelled). Nothing to write and
    // nobody to email again.
    if (!confirmedRows || confirmedRows.length === 0) {
        if (!booking) {
            await logMoneyFailure(
                '[settle] a guest paid for a booking that does not exist — reconcile at Stripe',
                { booking_id: bookingId, payment_intent: cs.payment_intent || null, event_id: eventId },
                { path: 'stripe/webhook' }
            );
        }
        return { ok: true, already: true };
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

    // THE TWO EMAILS THAT HAD NO HOME.
    //
    // The host is told a booking has come in — 'New booking' for
    // Instant Book, 'New booking request' for one they must accept.
    // Nothing called notify('booking_created'), so until now the
    // host learned of a booking only by opening the dashboard.
    //
    // And an Instant-Book guest is told they're booked. The
    // "You're booked" email is otherwise sent only when a host
    // clicks accept; an Instant-Book stay confirms itself here with
    // no click, so its guest — promised an email by /booking-confirmed
    // — was never sent one. A request-flow guest still gets their
    // confirmation from the host's acceptance, so is skipped here.
    //
    // Gated on firstDelivery so a redelivered paid event does not
    // send either twice. Best-effort: the money has landed and the
    // stay is live whether or not these send.
    if (firstDelivery && booking && booking.host_id) {
        try {
            const [{ data: hostUser }, { data: guestUser }] = await Promise.all([
                admin.auth.admin.getUserById(booking.host_id),
                admin.auth.admin.getUserById(booking.guest_id),
            ]);
            const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';
            const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';

            const { data: names } = await admin
                .from('profiles')
                .select('id, full_name, preferred_name, show_full_name')
                .in('id', [booking.host_id, booking.guest_id]);
            const byId: Record<string, any> = {};
            (names || []).forEach((p: any) => { byId[p.id] = p; });
            const hostProfile = byId[booking.host_id] || {};
            const guestProfile = byId[booking.guest_id] || {};

            // The host greeted by their own name; the guest named to
            // the host through the privacy switch.
            const hostFirst = ((hostProfile.preferred_name || hostProfile.full_name || 'there')
                .trim().split(' ')[0]) || 'there';
            const guestFirst = (displayName(guestProfile, 'A guest').split(' ')[0]) || 'A guest';
            const instant = nextStatus === 'confirmed';

            const hostMail = hostNewBookingEmail({
                hostFirst,
                guestFirst,
                listingTitle,
                checkIn: booking.check_in,
                checkOut: booking.check_out,
                guests: booking.guests || 1,
                total: Number(booking.total_price || 0),
                instant,
                bookingId: booking.id,
            });
            if (hostEmail) await sendEmail(hostEmail, hostMail.subject, hostMail.html);

            // The guest greeted by their own name, which does not
            // consult the privacy switch — it is their own name in
            // their own inbox.
            const guestOwnFirst = ((guestProfile.preferred_name || guestProfile.full_name || 'there')
                .trim().split(' ')[0]) || 'there';

            if (instant && guestEmail) {
                // Instant Book confirmed itself here, so the guest gets
                // the full "You're booked" now.
                const guestMail = guestBookedEmail({
                    guestFirst: guestOwnFirst,
                    listingTitle,
                    checkIn: booking.check_in,
                    checkOut: booking.check_out,
                    arrivalLine: arrivalLineFrom(listingRow || {}),
                    guests: booking.guests || 1,
                    total: Number(booking.total_price || 0),
                    amountPaid: Number(booking.amount_paid || amount || 0),
                    amountRefunded: Number(booking.amount_refunded || 0),
                    balanceAmount: Number(booking.balance_amount || 0),
                    balanceDueDate: booking.balance_due_date || null,
                    // Live from the stamped policy, the same deadline
                    // the cards show — not a stored column that lands
                    // a day early under BST.
                    freeCancelUntil: cancellationPosition({
                        checkIn: booking.check_in,
                        policy: listingRow && listingRow.cancellation_policy,
                    }).freeUntilKey,
                });
                await sendEmail(guestEmail, guestMail.subject, guestMail.html);
            } else if (!instant && guestEmail) {
                // A request-to-book guest has PAID and is now waiting on
                // the host. Their "You're booked" only comes if and when
                // the host accepts — so without this, a guest who paid
                // and heard nothing (host slow, host silent, or the
                // accept-time notify erroring) got no email at all. Tell
                // them their money is held and exactly how it comes back
                // if the host never responds.
                const reqMail = guestRequestReceivedEmail({
                    guestFirst: guestOwnFirst,
                    listingTitle,
                    checkIn: booking.check_in,
                    checkOut: booking.check_out,
                    guests: booking.guests || 1,
                    total: Number(booking.total_price || 0),
                    amountPaid: Number(booking.amount_paid || amount || 0),
                });
                await sendEmail(guestEmail, reqMail.subject, reqMail.html);
            }
        } catch (err) {
            // A booking notification that fails must never affect the
            // booking: the money has landed and the stay is live.
            await logError(
                '[webhook] a booking was paid but the host/guest notification could not be sent',
                err,
                { path: 'stripe/webhook', userId: (booking && booking.guest_id) || undefined }
            );
        }
    }

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


    return { ok: true };
}
