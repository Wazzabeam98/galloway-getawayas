import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { issueRefunds } from '@/lib/refundSpread';
import { guestMayAnswerChange, refundForChange, round2 } from '@/lib/bookingChange';
import { applyBookingChange } from '@/lib/applyBookingChange';

export const dynamic = 'force-dynamic';

// The GUEST answering a proposed change: accept (which moves the money and
// rewrites the stay) or decline. A price increase sends them to Stripe and the
// booking is rewritten by the webhook once they pay; a refund or a zero-cost
// change is applied here directly.
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
            .select('id, booking_id, host_id, guest_id, new_check_in, new_check_out, new_guests, new_children, new_pets, new_total, price_delta, status, stripe_checkout_session_id')
            .eq('id', changeId)
            .maybeSingle();
        if (!chg) return NextResponse.json({ ok: false, error: 'No such change' }, { status: 404 });
        if (chg.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your change' }, { status: 403 });
        if (!guestMayAnswerChange(chg.status as any)) {
            return NextResponse.json({ ok: false, error: 'This change has already been answered.' }, { status: 409 });
        }

        const nowIso = new Date().toISOString();
        const delta = round2(Number(chg.price_delta));

        // DECLINE → nothing moves; tell the host.
        if (action === 'decline') {
            await admin.from('booking_change_requests')
                .update({ status: 'declined', responded_at: nowIso, updated_at: nowIso })
                .eq('id', chg.id).eq('status', 'pending');
            await notifyHost(admin, chg.host_id, 'Your guest declined the change',
                'Your guest has declined the proposed change. Their booking stays exactly as it was.',
                SITE_URL + '/dashboard/bookings/' + chg.booking_id);
            return NextResponse.json({ ok: true, status: 'declined' });
        }

        // ACCEPT with a PRICE INCREASE → send the guest to Stripe. The booking is
        // rewritten by the webhook once the payment clears. Reuse the one session
        // on a repeat click so a double-click can only ever produce one payment.
        if (delta > 0) {
            const { data: listing } = await admin
                .from('bookings').select('listing_id').eq('id', chg.booking_id).maybeSingle();
            const { data: title } = listing
                ? await admin.from('listings').select('title').eq('id', listing.listing_id).maybeSingle()
                : { data: null };
            const stayName = (title && title.title) || 'your stay';
            try {
                if (chg.stripe_checkout_session_id) {
                    try {
                        const existing = await stripeRequest('GET', '/checkout/sessions/' + chg.stripe_checkout_session_id);
                        if (existing && existing.status === 'open' && existing.url) {
                            return NextResponse.json({ ok: true, url: existing.url });
                        }
                        if (existing && existing.status === 'complete') {
                            return NextResponse.json({ ok: false, error: 'This looks like it’s already paid. Refresh the page.' }, { status: 409 });
                        }
                    } catch { /* unreadable → open a fresh one */ }
                }
                const checkout = await stripeRequest('POST', '/checkout/sessions', {
                    mode: 'payment',
                    customer_email: user.email || undefined,
                    payment_method_types: ['card'],
                    line_items: [{
                        quantity: 1,
                        price_data: {
                            currency: 'gbp',
                            unit_amount: Math.round(delta * 100),
                            product_data: {
                                name: 'Change to your stay — ' + stayName,
                                description: 'The extra amount for the changed dates or guests on your reservation.',
                            },
                        },
                    }],
                    payment_intent_data: {
                        description: 'Galloway Getaways — reservation change · ' + stayName,
                        metadata: { kind: 'booking_change', change_id: chg.id, booking_id: chg.booking_id },
                    },
                    success_url: SITE_URL + '/reservations/change/' + chg.id + '?paid=1',
                    cancel_url: SITE_URL + '/reservations/change/' + chg.id + '?paid=cancelled',
                    metadata: { kind: 'booking_change', change_id: chg.id, booking_id: chg.booking_id },
                }, 'booking-change-' + chg.id);
                await admin.from('booking_change_requests')
                    .update({ stripe_checkout_session_id: checkout.id, responded_at: nowIso, updated_at: nowIso })
                    .eq('id', chg.id).eq('status', 'pending');
                return NextResponse.json({ ok: true, url: checkout.url });
            } catch (err: any) {
                await logError('[bookings/change/respond] accept checkout failed', err, { path: 'bookings/change/respond' });
                return NextResponse.json({ ok: false, error: 'Could not start the payment. Try again.' }, { status: 502 });
            }
        }

        // ACCEPT with NO CHARGE (a refund, or a same-price date/guest change).
        // Claim the row first so this runs exactly once, then rewrite the booking
        // (the exclusion constraint is the availability guard), then — only if a
        // refund is owed — send the money back.
        const { data: claimed } = await admin.from('booking_change_requests')
            .update({ status: 'accepted', responded_at: nowIso, updated_at: nowIso })
            .eq('id', chg.id).eq('status', 'pending')
            .select('id');
        if (!claimed || !claimed.length) {
            return NextResponse.json({ ok: false, error: 'This change has already been answered.' }, { status: 409 });
        }

        const applied = await applyBookingChange(admin, chg as any);
        if (!applied.ok) {
            // Nothing moved. Roll the claim into a terminal 'cancelled' with a
            // clear reason, so the stay is left exactly as it was.
            await admin.from('booking_change_requests')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('id', chg.id);
            if (applied.oversold) {
                return NextResponse.json({ ok: false, error: 'Those dates were just taken. Your booking is unchanged — ask your host to try different dates.' }, { status: 409 });
            }
            await logError('[bookings/change/respond] apply failed', applied.error, { path: 'bookings/change/respond' });
            return NextResponse.json({ ok: false, error: 'Could not apply the change. Your booking is unchanged.' }, { status: 500 });
        }

        // Refund the decrease, capped at what the guest has paid net of refunds.
        let refunded = 0;
        if (delta < 0) {
            const { data: booking } = await admin.from('bookings')
                .select('id, amount_paid, amount_refunded, stripe_payment_intent_id, balance_payment_intent_id')
                .eq('id', chg.booking_id).maybeSingle();
            const netPaid = round2(Number(booking?.amount_paid || 0) - Number(booking?.amount_refunded || 0));
            const want = refundForChange(delta, netPaid);
            if (booking && want > 0) {
                try {
                    const issued = await issueRefunds(
                        booking, want,
                        { booking_id: chg.booking_id, reason: 'booking_change', initiated_by: 'guest' },
                        (intentId: string) => 'booking-change-' + chg.id + '-' + intentId,
                    );
                    for (let i = 0; i < issued.refunds.length; i++) {
                        // Refund rows are outside the one-row-per-intent index, and
                        // this runs once behind the claim above — any error is real.
                        const { error: rErr } = await admin.from('payments').insert({
                            booking_id: chg.booking_id, kind: 'refund',
                            amount: round2(issued.shares[i] / 100), status: 'succeeded',
                            stripe_payment_intent_id: issued.charges[i].intentId,
                        });
                        if (rErr) await logError('[bookings/change/respond] refund missing from ledger', rErr, { path: 'bookings/change/respond' });
                    }
                    refunded = round2(issued.refundedPence / 100);
                    if (refunded > 0) await admin.rpc('record_booking_refund', { p_booking: chg.booking_id, p_amount: refunded });
                    if (refunded < want) {
                        await logError('[bookings/change/respond] wanted £' + want.toFixed(2) + ' but only £' + refunded.toFixed(2) + ' refunded — reconcile at Stripe', issued.failure || { change: chg.id }, { path: 'bookings/change/respond' });
                    }
                } catch (refErr) {
                    await logError('[bookings/change/respond] refund failed after the change was applied — reconcile at Stripe', refErr, { path: 'bookings/change/respond' });
                }
            }
        }

        await admin.from('booking_change_requests')
            .update({ applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', chg.id);

        await notifyHost(admin, chg.host_id, 'Your guest accepted the change',
            'Your guest accepted the change to their stay. The booking now runs ' + chg.new_check_in + ' to ' + chg.new_check_out + '.'
            + (refunded > 0 ? ' They were refunded £' + refunded.toFixed(2) + '.' : ''),
            SITE_URL + '/dashboard/bookings/' + chg.booking_id);
        return NextResponse.json({ ok: true, status: 'accepted', refunded });
    } catch (err: any) {
        await logError('[bookings/change/respond] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/change/respond' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}

async function notifyHost(admin: any, hostId: string, subject: string, line: string, href: string) {
    try {
        const { data: h } = await admin.auth.admin.getUserById(hostId);
        const to = (h && h.user && h.user.email) || '';
        if (to) await sendEmail(to, subject, emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(line) + '</p>' + button(href, 'Open the booking'),
            'You’re receiving this because you host with Galloway Getaways.'));
    } catch { /* notify must not block the state change */ }
}
