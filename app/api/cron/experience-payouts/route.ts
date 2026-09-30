import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL, NEUTRAL_SUBTITLE } from '@/lib/email';
import { logError } from '@/lib/logError';
import { logMoneyFailure, alertDirectorsNow } from '@/lib/moneyAlert';
import { readSchedule, arrivalSentence } from '@/lib/payoutTiming';
import { isAutomatedTestAddress } from '@/lib/testAddresses';
import { providerSharePence } from '@/lib/experienceFunds';
import { recordCronRun } from '@/lib/cronHeartbeat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// PAYING PROVIDERS THE DAY AFTER THE EXPERIENCE.
//
// The sibling of /api/cron/host-payouts, for guest experiences. An order made
// from 30 Sep 2026 is a PLATFORM charge (service_orders.funds_flow = 'held'):
// the guest's money sits with Galloway Getaways from capture until the
// experience has happened, so a provider who does not turn up can be refunded
// from money we still hold rather than chased for it. This run is where the
// provider is then paid — the day after the service date, as a host is paid
// the day after check-in: their share (the charge less our 10%, frozen on the
// order as platform_fee) transferred to their Connect account, drawn on the
// order's own charge.
//
// An order from before that change ('direct') was a destination charge and
// the provider was paid by Stripe at capture. It is never selected here — the
// query asks for 'held' only, the database refuses to flip an order's flow once
// it has a payment, and the charge is checked at Stripe before anything is sent
// in case a destination charge were ever mis-marked.
//
// NEVER PAID TWICE. Three layers, none of which rests on anything resettable:
//   1. Before sending, Stripe is asked whether a transfer already exists in the
//      order's own transfer_group. If one does, the run only writes it down.
//      This does not depend on our bookkeeping having survived, which is the
//      failure the cottage run learned about the hard way (a transfer sent and
//      the run killed before recording it).
//   2. The transfer's idempotency key is the order's id, which never changes.
//   3. paid_out_at / payout_transfer_id are final in the database once written
//      (trigger), and a transfer id can pay only one order (unique index).

// Leave time to report before the platform kills the run (maxDuration 60s).
const STOP_STARTING_AFTER_MS = 42000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: Request) {
    const startedAt = Date.now();
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();

    // Anything that happened yesterday or earlier is due. A London calendar
    // day off the day key, never `toISOString()` (which names the wrong day
    // between midnight and 01:00 BST).
    const cutoffDate = shiftDayKey(londonDayKey(), -1);

    // Money we still hold for a provider: a confirmed order, or one the guest
    // walked away from inside the window (cancelled, but with the walk-away
    // record — the provider keeps that money). A cancel before capture, a
    // decline, an expiry or a refund is not here: there is nothing to pay.
    const { data: due, error: dueError } = await admin
        .from('service_orders')
        .select('id, provider_id, parent_order_id, status, cancel_ack, service_date, price, commission_rate, platform_fee, stripe_payment_intent_id, item_name, provider_business_name, funds_flow, paid_out_at')
        .eq('funds_flow', 'held')
        .is('paid_out_at', null)
        .in('status', ['confirmed', 'cancelled'])
        .or('status.eq.confirmed,cancel_ack.not.is.null')
        .lte('service_date', cutoffDate)
        .order('service_date', { ascending: true });

    if (dueError) {
        await logMoneyFailure('experience-payouts: could not load the orders due for payout — no provider was paid today', dueError, {
            path: '/api/cron/experience-payouts',
        });
        await recordCronRun('experience-payouts', false, String(dueError.message || 'load failed'));
        return NextResponse.json({ ok: false, error: 'Could not load the orders due for payout' }, { status: 500 });
    }

    const rows = (due || []).filter(function (o: any) {
        // Belt and braces on the query: only ever a held order, never paid,
        // never a cancel that was not a walk-away.
        if (o.funds_flow !== 'held' || o.paid_out_at) return false;
        if (o.status === 'confirmed') return true;
        return o.status === 'cancelled' && !!o.cancel_ack;
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let reconciled = 0;
    let nothingToPay = 0;
    let notReached = 0;
    const waiting = new Map<string, { orders: number; total: number }>();
    const problems: Array<{ order: string; what: string }> = [];
    const providers = new Map<string, any>();

    for (let index = 0; index < rows.length; index++) {
        const order = rows[index];

        if (Date.now() - startedAt > STOP_STARTING_AFTER_MS) {
            notReached = rows.length - index;
            for (let j = index; j < rows.length; j++) problems.push({ order: rows[j].id, what: 'not reached — the run stopped before its time limit' });
            break;
        }

        try {
            if (!order.stripe_payment_intent_id) {
                problems.push({ order: order.id, what: 'not paid — the order has no payment on it' });
                skipped++;
                continue;
            }

            // A CHARGEBACK HOLDS THE MONEY. While a dispute is open (or was
            // lost) the provider is not paid from it; a person decides.
            const { data: disputes, error: disputeError } = await admin
                .from('disputes')
                .select('id, status')
                .eq('stripe_payment_intent_id', order.stripe_payment_intent_id);
            if (disputeError) {
                problems.push({ order: order.id, what: 'not paid — could not check for a dispute' });
                skipped++;
                continue;
            }
            const openDispute = (disputes || []).find(function (d: any) { return d.status !== 'won'; });
            if (openDispute) {
                problems.push({ order: order.id, what: 'held — the charge is disputed (' + (openDispute.status || 'open') + ')' });
                skipped++;
                continue;
            }

            // 1. HAS STRIPE ALREADY PAID THIS ORDER? Asked of Stripe, in the
            //    order's own transfer group, so a run that sent money and died
            //    before writing it down is repaired rather than repeated. An
            //    unanswered question is "do not send".
            const group = 'service_order_' + order.id;
            let existing: any = null;
            try {
                const list = await stripeRequest('GET', '/transfers', { transfer_group: group, limit: 10 });
                existing = ((list && list.data) || [])[0] || null;
            } catch (err: any) {
                problems.push({ order: order.id, what: 'not paid — could not ask Stripe whether it had already been paid' });
                skipped++;
                continue;
            }
            if (existing && existing.id) {
                const { error: stampErr } = await admin
                    .from('service_orders')
                    .update({ paid_out_at: new Date().toISOString(), payout_amount: r2(Number(existing.amount || 0) / 100), payout_transfer_id: existing.id })
                    .eq('id', order.id)
                    .is('paid_out_at', null);
                await logError(
                    'experience-payouts: this order had already been transferred (' + existing.id + ') but was not marked paid — an earlier run stopped part-way. Reconciled; no second transfer was sent.',
                    { order_id: order.id, transfer_id: existing.id, stamp_error: stampErr ? stampErr.message : null },
                    { path: '/api/cron/experience-payouts' }
                );
                reconciled++;
                continue;
            }

            // The provider, once per run.
            let provider = providers.get(order.provider_id);
            if (provider === undefined) {
                const { data: p } = await admin
                    .from('service_providers')
                    .select('id, business_name, contact_email, stripe_account_id, stripe_payouts_enabled')
                    .eq('id', order.provider_id)
                    .maybeSingle();
                provider = p || null;
                providers.set(order.provider_id, provider);
            }

            // Nothing can go until the provider can be paid. HELD, not failed —
            // the order stays due and the next run takes it — and said out loud
            // once per provider at the end, so it is never silent.
            if (!provider || !provider.stripe_account_id || provider.stripe_payouts_enabled !== true) {
                const seen = waiting.get(order.provider_id) || { orders: 0, total: 0 };
                waiting.set(order.provider_id, { orders: seen.orders + 1, total: r2(seen.total + Number(order.price || 0)) });
                skipped++;
                continue;
            }

            // What was actually taken and kept, read from Stripe rather than our
            // own row — a refund made in the Stripe dashboard counts, too.
            const pi = await stripeRequest('GET', '/payment_intents/' + order.stripe_payment_intent_id);
            const chargeId = pi && (typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge && pi.latest_charge.id));
            const charge = chargeId ? await stripeRequest('GET', '/charges/' + String(chargeId)) : null;

            // A destination charge already paid its provider at capture. If one
            // were ever marked 'held' by mistake, paying it here would pay twice.
            // on_behalf_of alone is NOT that: a held charge carries it on purpose
            // (the provider is the seller); what moves money at capture is
            // transfer_data / an application fee, and those are what we refuse.
            if ((pi && (pi.transfer_data || pi.application_fee_amount)) || (charge && (charge.transfer || charge.application_fee))) {
                problems.push({ order: order.id, what: 'NOT paid — its charge is a destination charge (already paid to the provider by Stripe) but the order is marked held' });
                await logMoneyFailure(
                    'experience-payouts: an order marked held has a destination charge — refused to pay it a second time; check the order',
                    { order_id: order.id, payment_intent: order.stripe_payment_intent_id },
                    { path: '/api/cron/experience-payouts' }
                );
                failed++;
                continue;
            }

            // The seller on the charge must be the account we are about to pay.
            // If the provider has since connected a different Stripe account,
            // stop and say so rather than send one seller's takings to another.
            if (pi && pi.on_behalf_of && pi.on_behalf_of !== provider.stripe_account_id) {
                problems.push({ order: order.id, what: 'NOT paid — the charge was made on behalf of ' + pi.on_behalf_of + ' but the provider is now connected as ' + provider.stripe_account_id });
                await logMoneyFailure(
                    'experience-payouts: the seller on the charge is not the provider\'s current Stripe account — refused; check the order',
                    { order_id: order.id, on_behalf_of: pi.on_behalf_of, provider_account: provider.stripe_account_id },
                    { path: '/api/cron/experience-payouts' }
                );
                failed++;
                continue;
            }

            if (!charge || charge.status !== 'succeeded' || charge.captured !== true) {
                problems.push({ order: order.id, what: 'not paid — the charge has not been captured' });
                skipped++;
                continue;
            }

            const amountPence = Number(charge.amount || 0);
            const refundedPence = Number(charge.amount_refunded || 0);
            const platformFeePence = order.platform_fee === null || order.platform_fee === undefined
                ? null
                : Math.round(Number(order.platform_fee) * 100);
            const sharePence = providerSharePence({
                amountPence,
                refundedPence,
                platformFeePence,
                commissionRate: order.commission_rate,
            });

            if (sharePence <= 0) {
                // Refunded in full (in the app or the Stripe dashboard): nothing
                // is owed to the provider. Recorded as a £0 payout so the order
                // is settled and not re-read every day.
                await admin
                    .from('service_orders')
                    .update({ paid_out_at: new Date().toISOString(), payout_amount: 0 })
                    .eq('id', order.id)
                    .is('paid_out_at', null);
                nothingToPay++;
                continue;
            }

            // 2. THE TRANSFER. Drawn on the order's own charge
            //    (source_transaction), so it does not wait for the platform
            //    balance to settle — see lib/payoutSource.ts. The share is always
            //    less than the charge, so the charge always covers it. Keyed on
            //    the order's own id, which is never reset.
            const transfer = await stripeRequest(
                'POST',
                '/transfers',
                {
                    amount: sharePence,
                    currency: 'gbp',
                    destination: provider.stripe_account_id,
                    transfer_group: group,
                    source_transaction: charge.id,
                    description: 'Galloway experience payout — ' + (order.item_name || order.provider_business_name || 'experience') + ' · ' + String(order.service_date),
                    metadata: {
                        service_order_id: order.id,
                        provider_id: order.provider_id,
                        service_date: String(order.service_date),
                        guest_paid_pence: String(amountPence - refundedPence),
                        fee_pence: String(amountPence - refundedPence - sharePence),
                    },
                },
                'experience-payout-' + order.id
            );

            // 3. WRITE IT DOWN. If this fails the money has still gone, and the
            //    transfer-group check at the top stops the next run sending it
            //    again — but it must not read as a clean payout.
            const share = r2(sharePence / 100);
            const { error: stampError } = await admin
                .from('service_orders')
                .update({ paid_out_at: new Date().toISOString(), payout_amount: share, payout_transfer_id: transfer && transfer.id })
                .eq('id', order.id)
                .is('paid_out_at', null);
            if (stampError) {
                failed++;
                problems.push({ order: order.id, what: 'transfer SENT (' + (transfer && transfer.id) + ') but not recorded' });
                await logMoneyFailure(
                    'experience-payouts: transfer sent but the order could not be marked paid — the next run will find the transfer and reconcile it; do not re-pay by hand',
                    { order_id: order.id, transfer_id: transfer && transfer.id, amount: share, stamp_error: stampError.message },
                    { path: '/api/cron/experience-payouts' }
                );
                continue;
            }

            sent++;

            // Tell the provider, like a host. Best-effort: the money has gone.
            const to = String(provider.contact_email || '');
            if (to && !isAutomatedTestAddress(to)) {
                try {
                    const schedule = await readSchedule(provider.stripe_account_id);
                    const kept = r2((amountPence - refundedPence) / 100);
                    const fee = r2(kept - share);
                    await sendEmail(
                        to,
                        'You’ve been paid £' + share.toFixed(2),
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">Your payout for <strong>'
                                + escapeHtml(order.item_name || order.provider_business_name || 'your booking')
                                + '</strong> on ' + escapeHtml(formatDate(String(order.service_date)))
                                + ' is on its way to your bank account.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">Guest paid £' + kept.toFixed(2)
                                + (fee > 0 ? ', less £' + fee.toFixed(2) + ' Galloway Getaways fee' : '')
                                + '. <strong>£' + share.toFixed(2) + '</strong> is yours.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">' + arrivalSentence(schedule ? schedule.delayDays : null) + '</p>'
                                + button(SITE_URL + '/services/dashboard/earnings', 'View your earnings'),
                            'You’re receiving this because you offer experiences on Galloway Getaways.',
                            undefined, NEUTRAL_SUBTITLE
                        )
                    );
                } catch (mailErr) {
                    console.error('[cron/experience-payouts] payout email failed', order.id, mailErr);
                }
            }
        } catch (err: any) {
            failed++;
            problems.push({ order: order.id, what: 'transfer failed: ' + ((err && err.message) || 'unknown error') });
            await logError('experience-payouts: transfer failed', err, { path: '/api/cron/experience-payouts' });
        }
    }

    // Providers who cannot be paid yet, once each, every day until they can.
    for (const [providerId, held] of Array.from(waiting.entries())) {
        await logError(
            'experience-payouts: ' + held.orders + ' order' + (held.orders === 1 ? '' : 's')
                + ' worth £' + held.total.toFixed(2)
                + ' cannot be paid — the provider has not finished setting up payouts',
            'no Stripe account, or payouts not yet enabled on it',
            { path: '/api/cron/experience-payouts', userId: providerId }
        );
    }

    if (problems.length) {
        await alertDirectorsNow({
            headline: 'Experience payouts: ' + problems.length + ' order' + (problems.length === 1 ? '' : 's')
                + ' due today did not complete',
            lines: [
                'The run finished with ' + sent + ' sent, ' + failed + ' failed'
                    + (notReached ? ' and ' + notReached + ' not reached before the time limit' : '') + '.',
                'Orders not paid are still due and the next run will try them again. A transfer marked SENT must NOT be sent again by hand.',
            ],
            facts: problems.slice(0, 25).reduce(function (acc: Record<string, string>, p) {
                acc[p.order] = p.what;
                return acc;
            }, {}),
        });
    }

    await recordCronRun('experience-payouts', failed === 0, 'due ' + rows.length + ', sent ' + sent + ', failed ' + failed + ', waiting ' + waiting.size);

    return NextResponse.json({
        ok: true,
        sent,
        skipped,
        failed,
        reconciled,
        nothingToPay,
        providersWaitingToOnboard: waiting.size,
        notReached,
        problems: problems.length,
    });
}
