import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import {
    applicationFeePence, guestMayRespond, guestMayPay, escalationDeadline, round2, toPence,
} from '@/lib/resolutions';

export const dynamic = 'force-dynamic';

// The GUEST answering a money request: accept and pay, decline (which escalates
// to an admin), or suggest a different amount (back to the host).
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const resolutionId: string = body && body.resolutionId;
        const action: string = body && body.action;
        if (!resolutionId || !['accept', 'decline', 'counter'].includes(action)) {
            return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: res } = await admin
            .from('booking_resolutions')
            .select('id, booking_id, host_id, guest_id, direction, reason, amount, commission_rate, status, stripe_checkout_session_id')
            .eq('id', resolutionId)
            .maybeSingle();
        if (!res) return NextResponse.json({ ok: false, error: 'No such request' }, { status: 404 });
        if (res.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your request' }, { status: 403 });
        if (res.direction !== 'request') return NextResponse.json({ ok: false, error: 'Not a request you can answer' }, { status: 400 });
        // Accept can run from 'pending' or from 'awaiting_guest_payment' (a
        // repeat click, which reuses the open session below); decline and
        // counter are 'pending'-only.
        const allowed = action === 'accept' ? guestMayPay(res.status as any) : guestMayRespond(res.status as any);
        if (!allowed) {
            return NextResponse.json({ ok: false, error: 'This request has already been answered.' }, { status: 409 });
        }

        const nowIso = new Date().toISOString();

        // ACCEPT → pay. A Stripe page charges the guest; the host's share is
        // transferred to their connected account, less the platform fee (10% on
        // extras, nothing on damage). The webhook marks it paid on capture.
        if (action === 'accept') {
            const { data: host } = await admin
                .from('profiles').select('stripe_account_id, stripe_payouts_enabled').eq('id', res.host_id).maybeSingle();
            if (!host || !host.stripe_account_id || !host.stripe_payouts_enabled) {
                return NextResponse.json({ ok: false, error: 'Your host can’t receive this yet. Please try again later.' }, { status: 409 });
            }
            const { data: listing } = await admin
                .from('bookings').select('listing_id').eq('id', res.booking_id).maybeSingle();
            const { data: title } = listing
                ? await admin.from('listings').select('title').eq('id', listing.listing_id).maybeSingle()
                : { data: null };
            const stayName = (title && title.title) || 'your stay';
            const amount = round2(Number(res.amount));
            try {
                // REUSE, DON'T RE-OPEN. If the guest already accepted, a Checkout
                // session is on the row — return it while it is still open rather
                // than starting a second one. A Checkout session can only be paid
                // once, so one session is one payment.
                if (res.stripe_checkout_session_id) {
                    try {
                        const existing = await stripeRequest('GET', '/checkout/sessions/' + res.stripe_checkout_session_id);
                        if (existing && existing.status === 'open' && existing.url) {
                            return NextResponse.json({ ok: true, url: existing.url });
                        }
                        if (existing && existing.status === 'complete') {
                            return NextResponse.json({ ok: false, error: 'This looks like it’s already paid. Refresh the page.' }, { status: 409 });
                        }
                        // expired/cancelled → fall through and open a fresh one.
                    } catch { /* unreadable → open a fresh one below */ }
                }
                const checkout = await stripeRequest('POST', '/checkout/sessions', {
                    mode: 'payment',
                    customer_email: user.email || undefined,
                    payment_method_types: ['card'],
                    line_items: [{
                        quantity: 1,
                        price_data: {
                            currency: 'gbp',
                            unit_amount: toPence(amount),
                            product_data: {
                                name: (res.reason === 'damage' ? 'Damage / cleaning' : 'Extra services') + ' — ' + stayName,
                                description: 'Payment to your host for ' + (res.reason === 'damage' ? 'damage or extra cleaning' : 'extra services') + ' on your stay.',
                            },
                        },
                    }],
                    payment_intent_data: {
                        on_behalf_of: host.stripe_account_id,
                        transfer_data: { destination: host.stripe_account_id },
                        application_fee_amount: applicationFeePence(toPence(amount), Number(res.commission_rate) || 0),
                        description: 'Galloway Getaways — ' + (res.reason === 'damage' ? 'damage reimbursement' : 'extra services') + ' · ' + stayName,
                        metadata: { kind: 'resolution_request', resolution_id: res.id, booking_id: res.booking_id },
                    },
                    success_url: SITE_URL + '/resolutions/' + res.id + '?paid=1',
                    cancel_url: SITE_URL + '/resolutions/' + res.id + '?paid=cancelled',
                    metadata: { kind: 'resolution_request', resolution_id: res.id, booking_id: res.booking_id },
                    // Idempotent on the request: two near-simultaneous accepts (a
                    // genuine double-click) collapse to ONE session, and a return
                    // within the session's 24h life replays that same one. Only
                    // once both the session and this key have expired does a later
                    // accept open a genuinely new session.
                }, 'resolution-accept-' + res.id);
                // Park the row in awaiting_guest_payment and remember the session,
                // so the page offers "continue to payment" and a repeat accept
                // reuses this session. Guarded to the pre-payment states so a
                // webhook that has already marked it paid is never walked back.
                await admin.from('booking_resolutions')
                    .update({ status: 'awaiting_guest_payment', stripe_checkout_session_id: checkout.id, responded_at: nowIso, updated_at: nowIso })
                    .eq('id', res.id).in('status', ['pending', 'awaiting_guest_payment']);
                return NextResponse.json({ ok: true, url: checkout.url });
            } catch (err: any) {
                await logError('[resolutions/respond] accept checkout failed', err, { path: 'bookings/resolutions/respond' });
                return NextResponse.json({ ok: false, error: 'Could not start the payment. Try again.' }, { status: 502 });
            }
        }

        // DECLINE → escalate to an admin (the house rule: a decline is a dispute).
        if (action === 'decline') {
            await admin.from('booking_resolutions')
                .update({ status: 'escalated', responded_at: nowIso, escalated_at: nowIso, updated_at: nowIso })
                .eq('id', res.id).eq('status', 'pending');
            await notifyEscalation(admin, res, 'The guest declined the request.');
            return NextResponse.json({ ok: true, status: 'escalated' });
        }

        // COUNTER → suggest a different amount; back to the host to accept or
        // decline. The 72h clock restarts for the host's turn.
        const counter = round2(Number(body && body.counterAmount));
        if (!(counter > 0)) return NextResponse.json({ ok: false, error: 'Enter an amount to suggest.' }, { status: 400 });
        await admin.from('booking_resolutions')
            .update({ status: 'countered', counter_amount: counter, responded_at: nowIso, updated_at: nowIso, expires_at: escalationDeadline(nowIso) })
            .eq('id', res.id).eq('status', 'pending');
        try {
            const { data: hostUser } = await admin.auth.admin.getUserById(res.host_id);
            const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';
            if (hostEmail) {
                await sendEmail(hostEmail, 'Your guest suggested £' + counter.toFixed(2), emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Your guest has suggested <strong>£' + counter.toFixed(2)
                    + '</strong> instead of the £' + round2(Number(res.amount)).toFixed(2) + ' you requested.</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">You can accept their amount or decline (which sends it to us to resolve).</p>'
                    + button(SITE_URL + '/dashboard/bookings/' + res.booking_id, 'Open the booking'),
                    'You’re receiving this because you host with Galloway Getaways.'));
            }
        } catch (mailErr) {
            await logError('[resolutions/respond] counter notify failed', mailErr, { path: 'bookings/resolutions/respond' });
        }
        return NextResponse.json({ ok: true, status: 'countered' });
    } catch (err: any) {
        await logError('[resolutions/respond] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/resolutions/respond' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}

async function notifyEscalation(admin: any, res: any, why: string) {
    try {
        const to = process.env.DISPUTES_ALERT_EMAIL || '';
        if (to) {
            await sendEmail(to, 'A money request was escalated', emailLayout(
                '<p>' + escapeHtml(why) + '</p>'
                + '<p>Booking ' + escapeHtml(String(res.booking_id)) + ', £' + round2(Number(res.amount)).toFixed(2)
                + ' (' + escapeHtml(String(res.reason)) + ').</p>'
                + button(SITE_URL + '/admin/resolutions', 'Open the resolutions queue'),
                'Galloway Getaways admin alert.'));
        }
    } catch { /* alerting must never block the state change */ }
}
