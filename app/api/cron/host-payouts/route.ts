import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

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

    const { data: due } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, check_in, total_price, amount_paid, amount_refunded, commission_rate, status, payment_status, paid_out_at')
        .eq('status', 'confirmed')
        .eq('payment_status', 'paid')
        .is('paid_out_at', null)
        .lte('check_in', cutoffDate);

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
            }

            const { data: hostUser } = await admin.auth.admin.getUserById(booking.host_id);
            const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';

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
                            + '<p style="margin:0 0 16px;font-size:16px;">It usually reaches your bank within a couple of working days.</p>'
                            + button(SITE_URL + '/dashboard/earnings', 'View your earnings'),
                        'You\u2019re receiving this because you host on Galloway Getaways.'
                    )
                );
            }

            sent++;
        } catch (err: any) {
            console.error('[cron/host-payouts]', booking.id, err && err.message);

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
