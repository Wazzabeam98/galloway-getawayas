import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/adminAudit';
import { stripeRequest } from '@/lib/stripe';
import { logError } from '@/lib/logError';
import { logMoneyFailure } from '@/lib/moneyAlert';
import { formatGBP } from '@/lib/formatMoney';
import { ukDate, londonDayKey } from '@/lib/dayKey';
import { firstName } from '@/lib/utils';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from '@/lib/email';
import { ORDER_FUNDS_COLUMNS, fundsFlowOf, issueExperienceRefund, clawbackDue, providerSharePence } from '@/lib/experienceFunds';
import { checkAdminOrderRefund, adminRefundKey, orderIsRefundable } from '@/lib/adminOrderRefund';

export const dynamic = 'force-dynamic';

// AN ADMIN REFUNDING ALL OR PART OF AN EXPERIENCE ORDER.
//
// The experience twin of /api/bookings/host-refund, run by a director from
// /admin/experience-orders. The money goes back the right way for the order:
//
//   held, before the payout run  from the money we hold. The payout run then
//                                pays the provider only on what is left (total
//                                less our fee, pro rata) — or nothing at all.
//   held, after the payout run   from us, and the provider's share of it clawed
//                                back through the existing clawback; what their
//                                Stripe balance cannot cover is written on the
//                                order (payout_clawback_owed) and emailed to the
//                                directors. Never netted off a future payout.
//   direct (legacy)              refund_application_fee + reverse_transfer, the
//                                way those orders always refunded.
// All three through lib/experienceFunds — there is one refund path, not two.
//
// ORDER OF OPERATIONS, and why each step is where it is:
//   1. who: getUser() (verified by the auth server, never getSession()) and
//      is_admin. Everything after runs as the service role.
//   2. what is left, read from STRIPE and the order — not the browser. The
//      browser's idea of what was refunded is only a precondition: if it no
//      longer matches, the admin is looking at a stale page and is told so.
//   3. the refund row (service_order_refunds), inserted BEFORE Stripe. Its id is
//      the idempotency key; only one may be pending per order, so a double
//      click cannot reach Stripe twice.
//   4. the money at Stripe. If that fails nothing else changes: the row is
//      marked failed, the order is untouched, nobody is emailed, and the admin
//      sees Stripe's error.
//   5. amount_refunded, atomically (record_order_refund sums under a lock).
//   6. the clawback, for a held order already paid out (inside step 4's helper).
//   7. the status — a full refund → 'refunded'; a part refund leaves it as is.
//   8. the audit row completed: who, what, why, when, flow, before/after payout,
//      the Stripe refund, the reversal and any shortfall.
//   9. the emails, guest and provider — only now the money has moved.

const r2 = (n: number) => Math.round(n * 100) / 100;

// A pending row older than this is a request that died mid-flight (the function
// was killed). It is resolved before a new refund may start — see below.
const STALE_PENDING_MS = 5 * 60 * 1000;

const ORDER_COLUMNS =
    'id, provider_id, guest_id, status, cancel_ack, service_date, shape, slot_session_id, quantity, price, commission_rate, amount_refunded, '
    + 'item_name, provider_business_name, guest_name, guest_email, stripe_payment_intent_id, ' + ORDER_FUNDS_COLUMNS;

function fail(status: number, error: string) {
    return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
    let requestId: string | null = null;
    try {
        const admin = adminClient();
        // 1. WHO.
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return fail(401, 'Not signed in');
        if (!(await isAdmin(user.id))) return fail(403, 'Not permitted');

        const body = await request.json().catch(() => ({}));
        const orderId: string = body && typeof body.orderId === 'string' ? body.orderId : '';
        if (!orderId) return fail(400, 'Missing order');

        // The column list is built from ORDER_FUNDS_COLUMNS, so the generated
        // types cannot follow it; the row is read as the plain object it is.
        const { data: orderRow } = await admin.from('service_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
        const order: any = orderRow;
        if (!order) return fail(404, 'Order not found');
        if (!orderIsRefundable(order)) return fail(409, 'Only a paid order can be refunded here.');

        // 2. WHAT IS LEFT — from Stripe, the source of truth for money, and the
        //    order. A refund made in the Stripe dashboard counts.
        const pi = await stripeRequest('GET', '/payment_intents/' + order.stripe_payment_intent_id);
        const chargeId = pi && (typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge && pi.latest_charge.id));
        const charge = chargeId ? await stripeRequest('GET', '/charges/' + String(chargeId)) : null;
        if (!charge || charge.status !== 'succeeded' || charge.captured !== true) {
            return fail(409, 'This order’s payment has not been taken, so there is nothing to refund.');
        }
        const chargePence = Math.round(Number(charge.amount || 0));
        const stripeRefunded = r2(Number(charge.amount_refunded || 0) / 100);
        const dbRefunded = r2(Number(order.amount_refunded || 0));

        // Stripe and the order must agree before any more money moves. If Stripe
        // shows more refunded than the order records, something refunded outside
        // this route (the dashboard, or a request that died after Stripe) — a
        // person reconciles it rather than this route refunding on top of a
        // figure it cannot trust.
        if (stripeRefunded !== dbRefunded) {
            await logMoneyFailure(
                '[admin/experience-orders/refund] Stripe shows ' + formatGBP(stripeRefunded) + ' refunded on this order but the order records '
                    + formatGBP(dbRefunded) + ' — refused until it is reconciled',
                { order_id: order.id, payment_intent: order.stripe_payment_intent_id, stripe_refunded: stripeRefunded, order_refunded: dbRefunded },
                { path: 'api/admin/experience-orders/refund', userId: user.id }
            );
            return fail(409, 'Stripe shows ' + formatGBP(stripeRefunded) + ' already refunded but the order records ' + formatGBP(dbRefunded)
                + '. The directors have been emailed — reconcile it before refunding more.');
        }
        // The page's figure is a precondition, never an input: a mismatch means
        // someone refunded since the page loaded (or this is a late second click).
        const expected = Number(body && body.expectedRefunded);
        if (!Number.isFinite(expected) || r2(expected) !== dbRefunded) {
            return fail(409, 'This order has changed since you opened the page. Refresh and check before refunding.');
        }

        const refundable = r2(Math.min(chargePence / 100 - stripeRefunded, Number(order.price || 0) - dbRefunded));
        const check = checkAdminOrderRefund({ amount: body && body.amount, reason: body && body.reason, refundable });
        if (check.ok === false) return fail(400, check.error);
        const amount = check.amount;
        const reason = check.reason;
        const amountPence = Math.round(amount * 100);

        const flow = fundsFlowOf(order);
        const afterPayout = flow === 'held' && !!order.payout_transfer_id;

        // 3. THE REFUND ROW, before any money moves.
        await settleStalePending(admin, order);
        const { data: row, error: rowError } = await admin
            .from('service_order_refunds')
            .insert({
                order_id: order.id,
                provider_id: order.provider_id,
                admin_id: user.id,
                amount,
                reason,
                funds_flow: flow,
                after_payout: afterPayout,
                refunded_before: stripeRefunded,
                status: 'pending',
            })
            .select('id')
            .single();
        if (rowError || !row) {
            if (rowError && (rowError as any).code === '23505') {
                return fail(409, 'A refund on this order is already being made. Refresh in a moment.');
            }
            throw rowError || new Error('could not start the refund');
        }
        requestId = String(row.id);

        // 4. THE MONEY. Nothing else has changed yet, and nothing will if this fails.
        const refundedAfterPence = Math.round(stripeRefunded * 100) + amountPence;
        const platformFeePence = order.platform_fee === null || order.platform_fee === undefined ? null : Math.round(Number(order.platform_fee) * 100);
        let issued: Awaited<ReturnType<typeof issueExperienceRefund>>;
        try {
            issued = await issueExperienceRefund(admin, order, adminRefundKey(requestId), {
                amountPence,
                metadata: { service_order_id: order.id, admin_refund_request: requestId, initiated_by: 'admin' },
                clawbackPounds: afterPayout
                    ? clawbackDue({
                        amountPence: chargePence,
                        refundedAfterPence,
                        platformFeePence,
                        commissionRate: order.commission_rate,
                        payoutAmount: order.payout_amount,
                        payoutReversed: order.payout_reversed,
                        payoutClawbackOwed: order.payout_clawback_owed,
                    })
                    : undefined,
            });
        } catch (err: any) {
            const message = (err && err.message) || 'Stripe refused the refund';
            await admin.from('service_order_refunds')
                .update({ status: 'failed', error: message.slice(0, 500), completed_at: new Date().toISOString() })
                .eq('id', requestId);
            await logError('[admin/experience-orders/refund] Stripe refused an admin refund — nothing changed', err, {
                path: 'api/admin/experience-orders/refund', userId: user.id,
            });
            return fail(502, 'Stripe didn’t take the refund, so nothing has changed: ' + message);
        }
        const refund = issued.refund;
        const clawback = issued.clawback;

        // 5. RECORD IT — summed under a lock, never read-then-written here.
        const { data: appliedRow, error: recordError } = await admin
            .rpc('record_order_refund', { p_order: order.id, p_amount: amount })
            .maybeSingle();
        const applied = appliedRow as { new_amount_refunded: number; price: number; applied: number } | null;
        if (recordError || !applied) {
            await logMoneyFailure(
                '[admin/experience-orders/refund] refunded ' + formatGBP(amount) + ' at Stripe but could not record it on the order',
                recordError || { order_id: order.id, amount },
                { path: 'api/admin/experience-orders/refund', userId: user.id }
            );
        } else if (r2(Number(applied.applied)) < amount) {
            await logMoneyFailure(
                '[admin/experience-orders/refund] ' + formatGBP(amount) + ' was refunded but only ' + formatGBP(Number(applied.applied))
                    + ' fit under what was paid — a concurrent refund overlapped; reconcile at Stripe',
                Object.assign({ order_id: order.id }, applied),
                { path: 'api/admin/experience-orders/refund', userId: user.id }
            );
        }

        // 7. STATUS. Full when nothing is left on the charge.
        const fullyRefunded = refundedAfterPence >= chargePence;
        let status = order.status;
        if (fullyRefunded) {
            const { data: moved } = await admin
                .from('service_orders')
                .update({ status: 'refunded', cancelled_at: new Date().toISOString() })
                .eq('id', order.id)
                .in('status', ['confirmed', 'cancelled'])
                .select('id');
            if (moved && moved.length) {
                status = 'refunded';
                // A refunded slot booking gives its seat back, as a provider's
                // own refund does — only when this call moved it off confirmed.
                if (order.status === 'confirmed' && order.shape === 'slot' && order.slot_session_id) {
                    const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', order.slot_session_id).maybeSingle();
                    if (s) {
                        await admin.from('slot_sessions')
                            .update({ seats_taken: Math.max(0, Number(s.seats_taken || 0) - (order.quantity || 1)) })
                            .eq('id', order.slot_session_id);
                    }
                }
            }
        }

        // 8. THE AUDIT ROW, completed.
        const reversalId = flow === 'direct'
            ? ((refund && (typeof refund.transfer_reversal === 'string' ? refund.transfer_reversal : refund.transfer_reversal && refund.transfer_reversal.id)) || null)
            : (clawback && clawback.reversalId) || null;
        const reversed = clawback ? r2(clawback.reversed) : 0;
        // Owed = the provider's balance could not cover it (recorded on the
        // order, directors emailed by the clawback). A reversal that failed for
        // any other reason is not their debt — it is ours to reconcile, and the
        // clawback has already alerted the directors.
        const shortfall = clawback ? r2(clawback.owed) : 0;
        const reversalFailed = clawback ? r2(clawback.failed) : 0;
        const { error: auditError } = await admin.from('service_order_refunds')
            .update({
                status: 'succeeded',
                stripe_refund_id: (refund && refund.id) || null,
                reversal_id: reversalId,
                reversed,
                shortfall,
                error: reversalFailed > 0 ? 'the refund went through but ' + formatGBP(reversalFailed) + ' of the payout could not be reversed — reconcile by hand' : null,
                completed_at: new Date().toISOString(),
            })
            .eq('id', requestId);
        if (auditError) {
            await logError('[admin/experience-orders/refund] a refund went through but its audit row could not be completed', {
                request_id: requestId, order_id: order.id, admin_id: user.id, amount, reason, refund: refund && refund.id, error: auditError.message,
            }, { path: 'api/admin/experience-orders/refund', userId: user.id });
        }

        // 9. TELL BOTH SIDES — only now the money has moved.
        const providerPayoutAfter = flow === 'held' && !afterPayout
            ? r2(providerSharePence({ amountPence: chargePence, refundedPence: refundedAfterPence, platformFeePence, commissionRate: order.commission_rate }) / 100)
            : null;
        await tellGuest(admin, order, amount, reason, fullyRefunded);
        await tellProvider(admin, order, amount, reason, fullyRefunded, {
            flow, afterPayout, reversed, owed: shortfall, payoutAfter: providerPayoutAfter,
        });

        return NextResponse.json({
            ok: true,
            refunded: amount,
            remaining: r2(refundable - amount),
            status,
            afterPayout,
            reversed,
            shortfall,
        });
    } catch (err: any) {
        if (requestId) {
            // Died after the row was written: leave the row pending if Stripe may
            // have been reached — settleStalePending resolves it against Stripe.
            await logMoneyFailure('[admin/experience-orders/refund] failed part-way — check the order at Stripe', err, {
                path: 'api/admin/experience-orders/refund',
            });
        } else {
            await logError('[admin/experience-orders/refund] ' + ((err && err.message) || 'failed'), err, { path: 'api/admin/experience-orders/refund' });
        }
        return fail(500, 'Could not process the refund.');
    }
}

// A refund row left 'pending' by a request that died mid-flight would block
// every later refund on the order (one pending per order). Once it is old
// enough that it cannot still be running, look for its refund at Stripe — the
// refund carries the row id in its metadata. Found: it went through (and the
// Stripe-vs-order check above has already confirmed it was recorded), so it is
// marked succeeded. Not found: it never reached Stripe, so it is abandoned.
async function settleStalePending(admin: any, order: any): Promise<void> {
    const { data: pending } = await admin
        .from('service_order_refunds')
        .select('id, created_at')
        .eq('order_id', order.id)
        .eq('status', 'pending');
    const stale = (pending || []).filter((p: any) => Date.now() - new Date(p.created_at).getTime() > STALE_PENDING_MS);
    if (!stale.length) return;
    const list = await stripeRequest('GET', '/refunds', { payment_intent: order.stripe_payment_intent_id, limit: 100 });
    for (const p of stale) {
        const found = ((list && list.data) || []).find((r: any) => r && r.metadata && r.metadata.admin_refund_request === p.id);
        await admin.from('service_order_refunds')
            .update(found
                ? { status: 'succeeded', stripe_refund_id: found.id, error: 'completed by a later request: the original stopped after Stripe', completed_at: new Date().toISOString() }
                : { status: 'abandoned', error: 'the request stopped before reaching Stripe', completed_at: new Date().toISOString() })
            .eq('id', p.id)
            .eq('status', 'pending');
    }
}

async function guestFirstName(admin: any, order: any): Promise<string> {
    if (order.guest_id) {
        const { data: p } = await admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', order.guest_id).maybeSingle();
        const n = p ? firstName(p, '') : '';
        if (n) return n;
    }
    return String(order.guest_name || '').trim().split(/\s+/)[0] || '';
}

function isUpcoming(order: any): boolean {
    return String(order.service_date || '') >= londonDayKey();
}

async function tellGuest(admin: any, order: any, amount: number, reason: string, full: boolean): Promise<void> {
    try {
        let to = String(order.guest_email || '').trim();
        if (!to && order.guest_id) {
            const { data: u } = await admin.auth.admin.getUserById(order.guest_id);
            to = (u && u.user && u.user.email) || '';
        }
        if (!to) return;
        const name = await guestFirstName(admin, order);
        const who = escapeHtml(order.provider_business_name || 'your experience');
        const date = escapeHtml(ukDate(order.service_date));
        const status = full
            ? (isUpcoming(order)
                ? 'That’s the whole amount, so this booking is now cancelled and the provider knows not to expect you.'
                : 'That’s the whole amount you paid.')
            : 'The rest of your booking is unchanged.';
        await sendEmail(
            to,
            'You’ve been refunded ' + formatGBP(amount),
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">Hi ' + escapeHtml(name || 'there') + ',</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">We’ve refunded you <strong>' + formatGBP(amount)
                    + '</strong> for your booking with <strong>' + who + '</strong> on ' + date + '. ' + status + '</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;"><strong>Why:</strong> ' + escapeHtml(reason) + '</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">It goes back to the card you paid with, usually within five to ten days.</p>'
                    + button(SITE_URL + '/trips', 'View your trips'),
                'You’re receiving this because you booked an experience through Galloway Getaways.',
                undefined, NEUTRAL_SUBTITLE
            )
        );
    } catch (err: any) {
        await logError('[admin/experience-orders/refund] guest email failed', { order_id: order.id, message: err && err.message });
    }
}

async function tellProvider(
    admin: any,
    order: any,
    amount: number,
    reason: string,
    full: boolean,
    money: { flow: 'direct' | 'held'; afterPayout: boolean; reversed: number; owed: number; payoutAfter: number | null }
): Promise<void> {
    try {
        const { data: prov } = await admin.from('service_providers').select('contact_email').eq('id', order.provider_id).maybeSingle();
        const to = String((prov && prov.contact_email) || '').trim();
        if (!to) return;
        const guest = escapeHtml((await guestFirstName(admin, order)) || 'your guest');
        const date = escapeHtml(ukDate(order.service_date));

        // Where the provider's money stands now — what the code actually did,
        // never a promise it doesn't keep.
        let money_line: string;
        if (money.flow === 'held' && !money.afterPayout) {
            money_line = money.payoutAfter && money.payoutAfter > 0
                ? 'You hadn’t been paid for this booking yet, so nothing comes out of your account. Your payout for it will be <strong>'
                    + formatGBP(money.payoutAfter) + '</strong>, the day after the booking.'
                : 'You hadn’t been paid for this booking yet, so nothing comes out of your account — and there is now nothing to pay out for it.';
        } else if (money.flow === 'held') {
            money_line = 'You’d already been paid for this booking, so '
                + (money.reversed > 0 ? '<strong>' + formatGBP(money.reversed) + '</strong> has been taken back from your Stripe balance' : 'nothing could be taken back from your Stripe balance')
                + (money.owed > 0
                    ? '. <strong>' + formatGBP(money.owed) + '</strong> is still owed, because your Stripe balance didn’t cover it — we’ll be in touch about it.'
                    : '.');
        } else {
            money_line = 'Your share of that amount has been taken back from your Stripe account.';
        }
        const status = full && isUpcoming(order)
            ? '<p style="margin:0 0 16px;font-size:16px;">That’s the whole amount, so the booking is cancelled — please don’t go.</p>'
            : '';

        await sendEmail(
            to,
            'A booking was refunded: ' + ukDate(order.service_date),
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">We’ve refunded ' + guest + ' <strong>' + formatGBP(amount)
                    + '</strong> for their booking with you on ' + date + '.</p>'
                    + status
                    + '<p style="margin:0 0 16px;font-size:16px;"><strong>Why:</strong> ' + escapeHtml(reason) + '</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + money_line + '</p>'
                    + button(SITE_URL + '/services/dashboard/earnings', 'View your earnings'),
                'You’re receiving this because you offer experiences on Galloway Getaways.',
                undefined, NEUTRAL_SUBTITLE
            )
        );
    } catch (err: any) {
        await logError('[admin/experience-orders/refund] provider email failed', { order_id: order.id, message: err && err.message });
    }
}
