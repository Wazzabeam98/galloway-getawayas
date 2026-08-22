import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { outstandingOf, spread } from '@/lib/hostDebt';
import { readSchedule, arrivalSentence } from '@/lib/payoutTiming';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();

    // A stay pays out the day after check-in, so anything checking in
    // yesterday or earlier is due.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    // A refund before check-in leaves the stay confirmed but moves the
    // payment to 'partially_refunded', so matching on 'paid' alone meant the
    // host was never paid the remainder. Cancellations set status to
    // 'cancelled' and are still excluded; a stay refunded down to nothing is
    // caught by the `collected <= 0` check below.
    const { data: due, error: dueError } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, check_in, total_price, amount_paid, amount_refunded, commission_rate, status, payment_status, paid_out_at')
        .eq('status', 'confirmed')
        .in('payment_status', ['paid', 'partially_refunded'])
        .is('paid_out_at', null)
        .lte('check_in', cutoffDate);

    // Without this the query could fail, `due` would come back empty, and the
    // run would report a cheerful ok:true with nothing sent — identical to a
    // day with no payouts due. Hosts would simply not be paid, quietly.
    if (dueError) {
        await logError('host-payouts: could not load the bookings due for payout', dueError, {
            path: '/api/cron/host-payouts',
        });
        return NextResponse.json(
            { ok: false, error: 'Could not load the bookings due for payout' },
            { status: 500 }
        );
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const booking of due || []) {
        try {
            const { data: host } = await admin
                .from('profiles')
                .select('id, stripe_account_id, stripe_payouts_enabled, payout_balance_owed')
                .eq('id', booking.host_id)
                .maybeSingle();

            // Nothing can be sent until the host has finished onboarding, so
            // the booking simply waits. It will be picked up next time.
            if (!host || !host.stripe_account_id || host.stripe_payouts_enabled !== true) {
                skipped++;
                continue;
            }

            const { data: listing } = await admin
                .from('listings')
                .select('title, commission_rate')
                .eq('id', booking.listing_id)
                .maybeSingle();

            const rate =
                booking.commission_rate === null || booking.commission_rate === undefined
                    ? (listing && listing.commission_rate !== null && listing.commission_rate !== undefined
                        ? Number(listing.commission_rate)
                        : DEFAULT_COMMISSION_PERCENT)
                    : Number(booking.commission_rate);

            // Only what was actually collected and kept is shared out, never
            // the headline price.
            const collected = round2(
                Number(booking.amount_paid || 0) - Number(booking.amount_refunded || 0)
            );

            if (collected <= 0) {
                skipped++;
                continue;
            }

            const hostShare = netOfFee(collected, rate);
            const commission = feeAmount(collected, rate);

            // Anything the host already owes comes off this payout first.
            const owed = round2(Number(host.payout_balance_owed || 0));
            const deduction = Math.min(owed, hostShare);
            const toSend = round2(hostShare - deduction);

            if (toSend > 0) {
                const transfer = await stripeRequest(
                    'POST',
                    '/transfers',
                    {
                        amount: Math.round(toSend * 100),
                        currency: 'gbp',
                        destination: host.stripe_account_id,
                        transfer_group: 'booking_' + booking.id,
                        metadata: {
                            booking_id: booking.id,
                            host_id: booking.host_id,
                            commission_percent: String(rate),
                        },
                    },
                    // Built from the booking alone, so this stay can never pay
                    // out twice however the data is later edited.
                    'payout-' + booking.id
                );

                await admin.from('payouts').insert({
                    booking_id: booking.id,
                    host_id: booking.host_id,
                    amount: toSend,
                    kind: 'transfer',
                    status: 'succeeded',
                    stripe_transfer_id: transfer && transfer.id,
                    note: deduction > 0 ? 'After £' + deduction.toFixed(2) + ' owed was deducted' : null,
                });

                await admin
                    .from('bookings')
                    .update({
                        paid_out_at: new Date().toISOString(),
                        payout_amount: toSend,
                        payout_transfer_id: transfer && transfer.id,
                    })
                    .eq('id', booking.id);
            } else {
                // The whole payout went towards what was owed.
                await admin.from('payouts').insert({
                    booking_id: booking.id,
                    host_id: booking.host_id,
                    amount: 0,
                    kind: 'transfer',
                    status: 'withheld',
                    note: 'Held back against £' + deduction.toFixed(2) + ' owed',
                });

                await admin
                    .from('bookings')
                    .update({
                        paid_out_at: new Date().toISOString(),
                        payout_amount: 0,
                    })
                    .eq('id', booking.id);
            }

            if (deduction > 0) {
                await admin
                    .from('profiles')
                    .update({ payout_balance_owed: round2(owed - deduction) })
                    .eq('id', booking.host_id);

                // Close off the individual debts this has just paid down.
                //
                // Until now only the running total moved and the rows behind
                // it were left saying 'owed' for ever, so anything itemising
                // what a host still owed kept listing debts already recovered.
                // The total and the rows have to agree — they are the same
                // money counted two ways, and the rows are the ones a host
                // would be shown if they queried a deduction.
                //
                // Oldest first, and partial recovery is recorded as partial:
                // a £45 debt against a £30 payout is £30 off this row, not a
                // row marked settled. The original amount is never rewritten;
                // it is the evidence of what was charged and why.
                //
                // Deliberately after the money has moved and after the balance
                // has come down. If this fails, the debt is recovered and the
                // bookkeeping is behind, which owner tools can see and put
                // right — the other order would show a settled debt that was
                // never actually taken.
                try {
                    const { data: debts } = await admin
                        .from('payouts')
                        .select('id, amount, settled_amount, status')
                        .eq('host_id', booking.host_id)
                        .eq('status', 'owed')
                        .order('created_at', { ascending: true });

                    const rows = debts || [];
                    const shares = spread(
                        deduction,
                        rows.map(function (r: any) { return outstandingOf(r); })
                    );

                    for (let i = 0; i < rows.length; i++) {
                        const share = shares[i];
                        if (share <= 0) continue;

                        const row = rows[i];
                        const recovered = round2(Number(row.settled_amount || 0) + share);
                        const fully = recovered >= round2(Math.abs(Number(row.amount || 0)));

                        await admin
                            .from('payouts')
                            .update({
                                settled_amount: recovered,
                                status: fully ? 'settled' : 'owed',
                                settled_at: fully ? new Date().toISOString() : null,
                            })
                            .eq('id', row.id);
                    }
                } catch (err) {
                    await logError(
                        'host-payouts: recovered £' + deduction.toFixed(2)
                            + ' on booking ' + booking.id
                            + ' but could not mark the debts settled',
                        err,
                        { path: '/api/cron/host-payouts' }
                    );
                }
            }

            const { data: hostUser } = await admin.auth.admin.getUserById(booking.host_id);
            const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';

            // One read per host we are actually emailing. Returns null on any
            // failure, which falls back to the vaguer wording rather than
            // holding up a payout that has already gone.
            const hostSchedule = (hostEmail && toSend > 0)
                ? await readSchedule(host.stripe_account_id)
                : null;
            const payoutDelayDays = hostSchedule ? hostSchedule.delayDays : null;

            if (hostEmail && toSend > 0) {
                await sendEmail(
                    hostEmail,
                    'You\u2019ve been paid \u00A3' + toSend.toFixed(2),
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Your payout for <strong>'
                            + escapeHtml((listing && listing.title) || 'your property')
                            + '</strong>, checked in '
                            + formatDate(booking.check_in)
                            + ', is on its way to your bank account.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">Guest paid \u00A3'
                            + collected.toFixed(2)
                            + (rate > 0 ? ', less \u00A3' + commission.toFixed(2) + ' service fee (' + rate + '%)' : ', with no service fee')
                            + (deduction > 0 ? ', less \u00A3' + deduction.toFixed(2) + ' previously owed' : '')
                            + '. <strong>\u00A3' + toSend.toFixed(2) + '</strong> is yours.</p>'
                            // Read off this host's own account rather than
                            // printed. It said "a couple of working days",
                            // which was the day-after release described as the
                            // bank arrival; the accounts checked all said
                            // seven. This is the email a host reads while
                            // waiting, so it is the sentence that has to be
                            // true.
                            + '<p style="margin:0 0 16px;font-size:16px;">'
                            + arrivalSentence(payoutDelayDays)
                            + '</p>'
                            + button(SITE_URL + '/dashboard/earnings', 'View your earnings'),
                        'You\u2019re receiving this because you host on Galloway Getaways.'
                    )
                );
            }

            sent++;
        } catch (err: any) {
            console.error('[cron/host-payouts]', booking.id, err && err.message);

            // Money failing to reach a host is exactly what /admin/errors is
            // for. The console alone is nobody's alarm.
            await logError('host-payouts: transfer failed', err, {
                path: '/api/cron/host-payouts',
                userId: booking.host_id,
            });

            await admin.from('payouts').insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                amount: 0,
                kind: 'transfer',
                status: 'failed',
                note: (err && err.message) || 'Transfer failed',
            });

            failed++;
        }
    }

    return NextResponse.json({ ok: true, sent: sent, skipped: skipped, failed: failed });
}
