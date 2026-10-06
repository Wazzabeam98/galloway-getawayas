// The money and the mechanics of deactivating an account, kept out of the route
// so it can be read and tested on its own. The route does auth and sign-out;
// everything money-shaped is here.
//
// TWO SIDES, TREATED DIFFERENTLY ON PURPOSE.
//
//   * The person's OWN upcoming trips (they are the guest) are CANCELLED here,
//     with the cancellation policy applied — their money, their choice to
//     leave, so the policy docks what it would dock on any guest cancel.
//   * Other people's reservations on the person's listings/experiences/trades
//     are NOT touched. They BLOCK deactivation instead (deactivationBlockers),
//     because force-cancelling a stranger's confirmed, paid stay from a
//     self-serve button is the one refund we will not issue without a human.
//
// The cancel here is composed from the same primitives the guest-cancel route
// and the stripe/refund route use — refundDue (the one place the tiered refund
// is worked out), issueRefunds (the one place a refund is issued), and the
// record_booking_refund RPC (which moves amount_refunded atomically). This file
// invents no money maths of its own; it only sequences those pieces, the way
// app/api/bookings/cancel/route.ts does. Money moves before the booking's
// status changes (CLAUDE.md).

import { issueRefunds } from '@/lib/refundSpread';
import { refundDue } from '@/lib/cancellation';
import { logError } from '@/lib/logError';
import { logMoneyFailure } from '@/lib/moneyAlert';
import { closeOpenBookingRequests } from '@/lib/closeBookingRequests';
import { cancelStayExperienceOrders } from '@/lib/experienceCancel';
import { londonDayKey } from '@/lib/dayKey';
import { sendEmail, emailLayout, escapeHtml, button, formatDate, SITE_URL } from '@/lib/email';
import { firstName } from '@/lib/utils';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface Blocker {
    // 'own_trip' only ever comes from the DELETION set (deletionBlockers) — a
    // deactivation cancels the person's own upcoming trips rather than blocking.
    kind: 'listing' | 'experience' | 'trade' | 'stay_in_progress' | 'own_trip';
    entityId: string;
    entityName: string;
    detail: string;
}

function mapBlockers(data: any): Blocker[] {
    return (data || []).map((r: any) => ({
        kind: r.kind,
        entityId: r.entity_id,
        entityName: r.entity_name,
        detail: r.detail,
    }));
}

// The single source of what stops a deactivation — the SQL function, so the
// friendly pre-check and the hard guard in the RPC are the same test.
export async function deactivationBlockers(admin: any, uid: string): Promise<Blocker[]> {
    const { data, error } = await admin.rpc('account_deactivation_blockers', { target: uid });
    if (error) throw new Error(error.message);
    return mapBlockers(data);
}

// What stops a DELETION: everything that stops a deactivation PLUS the person's
// own upcoming trips. Deletion is permanent and does not cancel-and-refund those
// trips the way deactivation does, so a paid future stay must be cancelled first
// rather than left behind an erased guest. Same single-function discipline: the
// account page's pre-check and admin_anonymise_account's hard guard both go
// through account_deletion_blockers, so they can never drift apart.
export async function deletionBlockers(admin: any, uid: string): Promise<Blocker[]> {
    const { data, error } = await admin.rpc('account_deletion_blockers', { target: uid });
    if (error) throw new Error(error.message);
    return mapBlockers(data);
}

export interface TripCancelSummary {
    considered: number;
    cancelled: number;
    refundedTotal: number;
    // A trip whose refund could not be put through. If this is non-empty the
    // caller must NOT deactivate — some of the person's money is unresolved.
    failures: Array<{ bookingId: string; reason: string }>;
}

// Cancel every one of the person's own strictly-future trips, refunding under
// the policy. A trip that has already started is never here — it is a blocker,
// so the route has already refused before reaching this. Idempotent: a trip
// that is no longer pending/confirmed (a previous run cancelled it) is skipped
// by the query, so a retry after a partial failure resumes cleanly.
export async function cancelOwnUpcomingTrips(
    admin: any,
    uid: string,
    guestEmail: string | null,
): Promise<TripCancelSummary> {
    const today = londonDayKey();
    const summary: TripCancelSummary = { considered: 0, cancelled: 0, refundedTotal: 0, failures: [] };

    const { data: trips, error } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out, status, amount_paid, amount_refunded, cleaning_fee, stripe_payment_intent_id, balance_payment_intent_id, balance_amount')
        .eq('guest_id', uid)
        .in('status', ['pending', 'confirmed'])
        .gt('check_in', today);

    if (error) throw new Error(error.message);

    for (const booking of (trips || [])) {
        summary.considered += 1;

        const { data: listing } = await admin
            .from('listings')
            .select('title, cancellation_policy')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const paid = Number(booking.amount_paid || 0);
        const alreadyRefunded = Number(booking.amount_refunded || 0);
        const refundable = round2(paid - alreadyRefunded);

        // Same rule as the guest-cancel route: a request the host has not yet
        // confirmed ('pending') is withdrawn with everything back, whatever the
        // dates; a confirmed stay follows the one shared policy in
        // lib/cancellation.ts.
        const amount = booking.status === 'pending'
            ? refundable
            : refundDue({
                amountPaid: paid,
                alreadyRefunded: alreadyRefunded,
                cleaningFee: booking.cleaning_fee,
                checkIn: booking.check_in,
                policy: listing && listing.cancellation_policy,
            });

        // The money goes back BEFORE the booking changes.
        let refundedNow = 0;
        if (amount > 0 && booking.stripe_payment_intent_id) {
            const issued = await issueRefunds(
                booking,
                amount,
                { booking_id: booking.id, reason: 'account_deactivated', initiated_by: 'guest' },
                function (intentId: string) { return 'deactivate-cancel-' + booking.id + '-' + intentId; },
            );

            if (issued.refundedPence <= 0) {
                // Nothing could be refunded — leave the stay exactly as it is and
                // flag it, as the cancel route does. This trip blocks the
                // deactivation; the caller aborts rather than closing the
                // account with the person's money stranded.
                await logMoneyFailure(
                    '[deactivate] a trip refund was due but nothing could be refunded, so the stay is left as it is',
                    issued.failure || { booking_id: booking.id, due: amount },
                    { path: 'lib/deactivateAccount', userId: uid },
                );
                summary.failures.push({ bookingId: booking.id, reason: 'refund_failed' });
                continue;
            }

            refundedNow = round2(issued.refundedPence / 100);

            if (issued.refundedPence < Math.round(amount * 100)) {
                await logMoneyFailure(
                    '[deactivate] owed £' + amount.toFixed(2) + ' but only £' + refundedNow.toFixed(2) + ' could be refunded',
                    issued.failure || { booking_id: booking.id, due: amount, sent: refundedNow },
                    { path: 'lib/deactivateAccount', userId: uid },
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
        }

        // Record the refunded total atomically (locks the row, clamps at what
        // was paid, owns payment_status), exactly as the cancel route does.
        if (refundedNow > 0) {
            const { data: appliedRow, error: refundWriteError } = await admin
                .rpc('record_booking_refund', { p_booking: booking.id, p_amount: refundedNow })
                .maybeSingle();
            const applied = appliedRow as { applied: number; amount_paid: number } | null;
            if (refundWriteError || !applied) {
                await logMoneyFailure(
                    '[deactivate] refunded £' + refundedNow.toFixed(2) + ' but could not record it against the booking',
                    refundWriteError || { booking_id: booking.id, amount: refundedNow },
                    { path: 'lib/deactivateAccount', userId: uid },
                );
            }
        }

        // The stay is off. payment_status is owned by the RPC above (or left as
        // it was when nothing was refunded), so it is not written here.
        await admin
            .from('bookings')
            .update({
                status: 'cancelled',
                balance_amount: 0,
                cancelled_at: new Date().toISOString(),
                cancelled_by_user: uid,
                cancelled_by_role: 'guest',
            })
            .eq('id', booking.id);

        await closeOpenBookingRequests(admin, booking.id);

        summary.cancelled += 1;
        summary.refundedTotal = round2(summary.refundedTotal + refundedNow);

        // Tell the guest and the host, and take any experiences down with the
        // stay — the same courtesies and the same cascade the cancel route runs.
        // All best-effort: the refund has already happened.
        await notifyTripCancelled(admin, booking, listing, guestEmail, refundedNow, uid);
        await cancelStayExperienceOrders(admin, booking.id);
    }

    return summary;
}

async function notifyTripCancelled(
    admin: any,
    booking: any,
    listing: any,
    guestEmail: string | null,
    refundedNow: number,
    uid: string,
): Promise<void> {
    const rawTitle = (listing && listing.title) || 'your stay';
    try {
        if (guestEmail) {
            const title = escapeHtml(rawTitle);
            const refundLine = refundedNow > 0
                ? 'A refund of <strong>£' + refundedNow.toFixed(2) + '</strong> is on its way back to your card. It usually takes five to ten days to appear.'
                : 'Under the cancellation policy for these dates, no refund was due on what you had already paid.';
            await sendEmail(
                guestEmail,
                'Your booking at ' + rawTitle + ' has been cancelled',
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Because you deactivated your account, your stay at <strong>'
                        + title + '</strong> has been cancelled.</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + refundLine + '</p>'
                    + button(SITE_URL + '/trips', 'View booking'),
                    'You’re receiving this because you deactivated your Galloway Getaways account.',
                ),
            );
        }
    } catch (receiptErr: any) {
        await logError('[deactivate] the trip cancellation receipt could not be sent', receiptErr, { path: 'lib/deactivateAccount', userId: uid });
    }

    try {
        const [{ data: hostUser }, { data: guestProfile }] = await Promise.all([
            admin.auth.admin.getUserById(booking.host_id),
            admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', booking.guest_id).maybeSingle(),
        ]);
        const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';
        if (hostEmail) {
            const guestFirst = escapeHtml(firstName(guestProfile, 'Your guest'));
            const hostTitle = escapeHtml(rawTitle);
            await sendEmail(
                hostEmail,
                'Reservation cancelled — ' + rawTitle,
                emailLayout(
                    '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">Reservation cancelled</h1>'
                    + '<p style="margin:0 0 16px;">' + guestFirst + ' has cancelled their stay at <strong>' + hostTitle
                    + '</strong> from ' + escapeHtml(formatDate(booking.check_in)) + ' to ' + escapeHtml(formatDate(booking.check_out))
                    + '. Those dates are open on your calendar again.</p>'
                    + button(SITE_URL + '/dashboard/bookings/' + booking.id, 'View the reservation'),
                    "You're receiving this because you host on Galloway Getaways. Booking emails can't be switched off.",
                ),
            );
        }
    } catch (hostMailErr: any) {
        await logError('[deactivate] the host was not told about the cancellation', hostMailErr, { path: 'lib/deactivateAccount', userId: uid });
    }
}

// Every live Stripe subscription the person's trade listings carry. Commission
// providers and trades still in the free trial have no subscription id and are
// not returned.
export async function providerSubscriptionIds(admin: any, uid: string): Promise<string[]> {
    const { data, error } = await admin
        .from('service_providers')
        .select('stripe_subscription_id')
        .eq('owner_id', uid)
        .not('stripe_subscription_id', 'is', null);
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => r.stripe_subscription_id).filter(Boolean);
}
