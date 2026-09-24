import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { stripeRequest } from '@/lib/stripe';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { issueRefunds } from '@/lib/refundSpread';
import { clawBackPayout } from '@/lib/clawback';
import { whoAnswers, refundForDecrease, balanceAfter, round2 } from '@/lib/bookingChange';
import { applyBookingChange } from '@/lib/applyBookingChange';

export const dynamic = 'force-dynamic';

// Answering a proposed change. The counterparty (the side that did NOT propose
// it) accepts or declines; either side may decline to end it. Money only moves
// once both sides agree: a decrease is applied and refunded here; an increase
// sends the guest to Stripe (straight away when the host proposed, or after the
// host has approved a guest's proposal) and the booking is rewritten by the
// webhook once it clears.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const changeId: string = body && body.changeId;
        const action: string = body && body.action;
        if (!changeId || !['accept', 'decline'].includes(action)) {
            return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: chg } = await admin
            .from('booking_change_requests')
            .select('id, booking_id, host_id, guest_id, initiated_by, new_check_in, new_check_out, new_guests, new_children, new_pets, new_total, price_delta, status, stripe_checkout_session_id')
            .eq('id', changeId)
            .maybeSingle();
        if (!chg) return NextResponse.json({ ok: false, error: 'No such change' }, { status: 404 });

        // Who is acting: the booking's guest, or someone who can manage the listing.
        const isGuest = chg.guest_id === user.id;
        let actorRole: 'host' | 'guest' | null = isGuest ? 'guest' : null;
        if (!actorRole) {
            const { data: b } = await admin.from('bookings').select('listing_id').eq('id', chg.booking_id).maybeSingle();
            if (b && await checkListing(user.id, b.listing_id, 'can_bookings')) actorRole = 'host';
        }
        if (!actorRole) return NextResponse.json({ ok: false, error: 'Not your change' }, { status: 403 });

        const answerer = whoAnswers(chg.initiated_by as any);
        const nowIso = new Date().toISOString();
        const delta = round2(Number(chg.price_delta));

        // DECLINE / WITHDRAW — the counterparty declines, or the proposer withdraws.
        if (action === 'decline') {
            if (chg.status !== 'pending' && chg.status !== 'awaiting_guest_payment') {
                return NextResponse.json({ ok: false, error: 'This change has already been answered.' }, { status: 409 });
            }
            const terminal = actorRole === answerer ? 'declined' : 'cancelled';
            await admin.from('booking_change_requests')
                .update({ status: terminal, responded_at: nowIso, updated_at: nowIso })
                .eq('id', chg.id).in('status', ['pending', 'awaiting_guest_payment']);
            const otherId = actorRole === 'guest' ? chg.host_id : chg.guest_id;
            await notify(admin, otherId, actorRole === 'guest' ? 'A change was ' + terminal : 'Your host ' + (terminal === 'declined' ? 'declined' : 'withdrew') + ' the change',
                'The proposed change is off. The booking stays exactly as it was.',
                SITE_URL + '/dashboard/bookings/' + chg.booking_id);
            return NextResponse.json({ ok: true, status: terminal });
        }

        // ---- ACCEPT ----

        // The GUEST paying, after a guest proposal the host already approved.
        if (chg.status === 'awaiting_guest_payment') {
            if (actorRole !== 'guest') return NextResponse.json({ ok: false, error: 'Waiting for the guest to pay.' }, { status: 409 });
            return await guestCheckout(admin, chg, user.email || '', delta);
        }

        if (chg.status !== 'pending') {
            return NextResponse.json({ ok: false, error: 'This change has already been answered.' }, { status: 409 });
        }
        // Only the counterparty accepts a pending proposal.
        if (actorRole !== answerer) {
            return NextResponse.json({ ok: false, error: 'It’s not your change to accept.' }, { status: 409 });
        }

        // An INCREASE that still needs paying.
        if (delta > 0) {
            if (answerer === 'guest') {
                // Host proposed → the guest accepts and pays in one step.
                return await guestCheckout(admin, chg, user.email || '', delta);
            }
            // Guest proposed → the host is approving; the guest pays next.
            await admin.from('booking_change_requests')
                .update({ status: 'awaiting_guest_payment', responded_at: nowIso, updated_at: nowIso })
                .eq('id', chg.id).eq('status', 'pending');
            await notify(admin, chg.guest_id, 'Your host approved your change — pay to confirm',
                'Your host approved the change. Pay the extra £' + delta.toFixed(2) + ' to confirm it.',
                SITE_URL + '/reservations/change/' + chg.id);
            return NextResponse.json({ ok: true, status: 'awaiting_guest_payment' });
        }

        // A DECREASE or a SAME-PRICE change — apply now, refund only what's overpaid.
        const { data: claimed } = await admin.from('booking_change_requests')
            .update({ status: 'accepted', responded_at: nowIso, updated_at: nowIso })
            .eq('id', chg.id).eq('status', 'pending')
            .select('id');
        if (!claimed || !claimed.length) {
            return NextResponse.json({ ok: false, error: 'This change has already been answered.' }, { status: 409 });
        }

        const applied = await applyBookingChange(admin, chg as any);
        if (!applied.ok) {
            await admin.from('booking_change_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', chg.id);
            if (applied.oversold) return NextResponse.json({ ok: false, error: 'Those dates were just taken. Your booking is unchanged.' }, { status: 409 });
            if (applied.gone) return NextResponse.json({ ok: false, error: 'This booking is no longer active, so it can’t be changed.' }, { status: 409 });
            await logError('[bookings/change/respond] apply failed', applied.error, { path: 'bookings/change/respond' });
            return NextResponse.json({ ok: false, error: 'Could not apply the change. Your booking is unchanged.' }, { status: 500 });
        }

        let refunded = 0;
        {
            const { data: booking } = await admin.from('bookings')
                .select('id, host_id, amount_paid, amount_refunded, stripe_payment_intent_id, balance_payment_intent_id, payout_transfer_id, payout_amount')
                .eq('id', chg.booking_id).maybeSingle();
            const netPaid = round2(Number(booking?.amount_paid || 0) - Number(booking?.amount_refunded || 0));
            const want = refundForDecrease(netPaid, round2(chg.new_total));
            if (booking && want > 0) {
                try {
                    const issued = await issueRefunds(
                        booking, want,
                        { booking_id: chg.booking_id, reason: 'booking_change', initiated_by: 'system' },
                        (intentId: string) => 'booking-change-' + chg.id + '-' + intentId,
                    );
                    for (let i = 0; i < issued.refunds.length; i++) {
                        const { error: rErr } = await admin.from('payments').insert({
                            booking_id: chg.booking_id, kind: 'refund',
                            amount: round2(issued.shares[i] / 100), status: 'succeeded',
                            stripe_payment_intent_id: issued.charges[i].intentId,
                        });
                        if (rErr) await logError('[bookings/change/respond] refund missing from ledger', rErr, { path: 'bookings/change/respond' });
                    }
                    refunded = round2(issued.refundedPence / 100);
                    if (refunded > 0) {
                        await admin.rpc('record_booking_refund', { p_booking: chg.booking_id, p_amount: refunded });
                        // Recover the host's share if they have already been paid,
                        // exactly as every other refund path does.
                        if (booking.payout_transfer_id) {
                            await clawBackPayout(admin, booking, refunded, 'change-' + chg.id);
                        }
                    }
                    if (refunded < want) {
                        await logError('[bookings/change/respond] wanted £' + want.toFixed(2) + ' but only £' + refunded.toFixed(2) + ' refunded — reconcile at Stripe', issued.failure || { change: chg.id }, { path: 'bookings/change/respond' });
                    }
                } catch (refErr) {
                    await logError('[bookings/change/respond] refund failed after the change was applied — reconcile at Stripe', refErr, { path: 'bookings/change/respond' });
                }
            }
            // Write the balance after any refund: the new total less what is now
            // paid net of refunds.
            const finalBalance = balanceAfter(round2(chg.new_total), round2(netPaid - refunded));
            await admin.from('bookings').update({ balance_amount: finalBalance }).eq('id', chg.booking_id);
        }

        await admin.from('booking_change_requests')
            .update({ applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', chg.id);

        const otherId = actorRole === 'guest' ? chg.host_id : chg.guest_id;
        await notify(admin, otherId, 'A reservation change was accepted',
            'The change is done. The booking now runs ' + chg.new_check_in + ' to ' + chg.new_check_out + '.'
            + (refunded > 0 ? ' £' + refunded.toFixed(2) + ' was refunded to the guest.' : ''),
            SITE_URL + '/dashboard/bookings/' + chg.booking_id);
        return NextResponse.json({ ok: true, status: 'accepted', refunded });
    } catch (err: any) {
        await logError('[bookings/change/respond] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/change/respond' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}

// Open (or reuse) the guest's Checkout session for a price increase. The booking
// is rewritten by the webhook once it clears. Reusing the one session means a
// double-click can only ever make one payment.
async function guestCheckout(admin: any, chg: any, guestEmail: string, delta: number) {
    // Re-read the booking at checkout time: never take a payment for a change on
    // a booking that has been cancelled or declined out from under it.
    const { data: bk } = await admin.from('bookings').select('listing_id, status').eq('id', chg.booking_id).maybeSingle();
    if (!bk || (bk.status !== 'confirmed' && bk.status !== 'pending')) {
        await admin.from('booking_change_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', chg.id).in('status', ['pending', 'awaiting_guest_payment']);
        return NextResponse.json({ ok: false, error: 'This booking is no longer active, so the change can’t be paid for.' }, { status: 409 });
    }
    const listing = bk;
    const { data: title } = listing ? await admin.from('listings').select('title').eq('id', listing.listing_id).maybeSingle() : { data: null };
    const stayName = (title && title.title) || 'your stay';
    try {
        if (chg.stripe_checkout_session_id) {
            try {
                const existing = await stripeRequest('GET', '/checkout/sessions/' + chg.stripe_checkout_session_id);
                if (existing && existing.status === 'open' && existing.url) return NextResponse.json({ ok: true, url: existing.url });
                if (existing && existing.status === 'complete') return NextResponse.json({ ok: false, error: 'This looks like it’s already paid. Refresh the page.' }, { status: 409 });
            } catch { /* unreadable → open a fresh one */ }
        }
        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: guestEmail || undefined,
            payment_method_types: ['card'],
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: 'gbp',
                    unit_amount: Math.round(delta * 100),
                    product_data: { name: 'Change to your stay — ' + stayName, description: 'The extra amount for the changed dates or guests on your reservation.' },
                },
            }],
            payment_intent_data: { description: 'Galloway Getaways — reservation change · ' + stayName, metadata: { kind: 'booking_change', change_id: chg.id, booking_id: chg.booking_id } },
            success_url: SITE_URL + '/reservations/change/' + chg.id + '?paid=1',
            cancel_url: SITE_URL + '/reservations/change/' + chg.id + '?paid=cancelled',
            metadata: { kind: 'booking_change', change_id: chg.id, booking_id: chg.booking_id },
        }, 'booking-change-' + chg.id);
        // Remember the session and mark the row awaiting payment (whether it came
        // from a host proposal the guest just accepted, or a guest proposal the
        // host approved). The webhook moves it to 'accepted' on payment.
        await admin.from('booking_change_requests')
            .update({ status: 'awaiting_guest_payment', stripe_checkout_session_id: checkout.id, responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', chg.id).in('status', ['pending', 'awaiting_guest_payment']);
        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        await logError('[bookings/change/respond] checkout failed', err, { path: 'bookings/change/respond' });
        return NextResponse.json({ ok: false, error: 'Could not start the payment. Try again.' }, { status: 502 });
    }
}

async function notify(admin: any, userId: string, subject: string, line: string, href: string) {
    try {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        const to = (u && u.user && u.user.email) || '';
        if (to) await sendEmail(to, subject, emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(line) + '</p>' + button(href, 'Open the booking'),
            'You’re receiving this because you use Galloway Getaways.'));
    } catch { /* notify must not block the state change */ }
}
