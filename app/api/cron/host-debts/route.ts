import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { formatGBP } from '@/lib/formatMoney';
import { outstandingOf, round2 } from '@/lib/hostDebt';
import { DEBT_SELECT, attachBookings, debtTitle, hostHasComingPayouts, type HostDebt } from '@/lib/hostDebtView';
import { settleHostDebtSession } from '@/lib/hostDebtSettle';
import { ukDate } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// Daily, after the payout run.
//
// 1. RECONCILE. A host who paid a debt from "Pay now" is settled by the
//    webhook. If that webhook never arrives the host has paid and still shows
//    as owing, so completed sessions from the last three days are put through
//    the same function the webhook uses — a no-op for any already applied.
//
// 2. RAISE IT. A debt normally comes off the host's next payouts. A host with
//    no stay waiting to be paid out has nothing for it to come off, so they are
//    told it is due, what it is for, which booking it came from and how much
//    has been recovered — with a link to pay it or dispute it. Once, then again
//    every 30 days while it stays unpaid. Disputed debts are never chased.
const RECONCILE_DAYS = 3;
const REMIND_EVERY_DAYS = 30;

export async function GET(request: Request) {
    const auth = request.headers.get('authorization') || '';
    if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const admin = adminClient();
    let reconciled = 0;
    let noticed = 0;

    // 1. Reconcile lost "Pay now" webhooks.
    try {
        const since = Math.floor(Date.now() / 1000) - RECONCILE_DAYS * 86400;
        let startingAfter: string | undefined;
        for (let page = 0; page < 10; page++) {
            const list = await stripeRequest(
                'GET',
                '/checkout/sessions?limit=100&status=complete&created[gte]=' + since
                    + (startingAfter ? '&starting_after=' + startingAfter : ''),
            );
            const sessions = (list && list.data) || [];
            for (const cs of sessions) {
                if (!cs.metadata || cs.metadata.kind !== 'host_debt_settle') continue;
                const out = await settleHostDebtSession(admin, cs);
                if (!out.duplicate && !out.skipped) reconciled++;
            }
            if (!list || !list.has_more || !sessions.length) break;
            startingAfter = sessions[sessions.length - 1].id;
        }
    } catch (err) {
        await logError('[cron/host-debts] reconcile failed', err, { path: 'api/cron/host-debts' });
    }

    // 2. Tell hosts with nothing coming that what they owe is due.
    try {
        const cutoff = new Date(Date.now() - REMIND_EVERY_DAYS * 86400000).toISOString();
        const { data } = await admin
            .from('payouts')
            .select(DEBT_SELECT)
            .eq('status', 'owed')
            .in('kind', ['penalty', 'reversal', 'dispute'])
            .or('due_notice_sent_at.is.null,due_notice_sent_at.lt.' + cutoff)
            .order('created_at', { ascending: true });

        const rows = ((data || []) as HostDebt[]).filter((r) => outstandingOf(r) > 0);
        const byHost: Record<string, HostDebt[]> = {};
        rows.forEach((r) => { (byHost[r.host_id] = byHost[r.host_id] || []).push(r); });

        for (const hostId of Object.keys(byHost)) {
            if (await hostHasComingPayouts(admin, hostId)) continue;

            const debts = await attachBookings(admin, byHost[hostId]);
            const total = debts.reduce((s, d) => round2(s + outstandingOf(d)), 0);

            const { data: hostUser } = await admin.auth.admin.getUserById(hostId);
            const email = (hostUser && hostUser.user && hostUser.user.email) || '';
            if (!email) continue;

            const lines = debts.map((d) => {
                const b = d.booking;
                const recovered = round2(Number(d.settled_amount || 0));
                return '<li style="margin:0 0 8px;">'
                    + '<strong>' + formatGBP(outstandingOf(d)) + '</strong> — ' + escapeHtml(debtTitle(d).toLowerCase())
                    + (b ? ', ' + escapeHtml(b.listing_title || 'your listing') + ' (' + ukDate(b.check_in) + '–' + ukDate(b.check_out) + ')' : '')
                    + (recovered > 0 ? '. ' + formatGBP(recovered) + ' already recovered' : '')
                    + '</li>';
            }).join('');

            await sendEmail(email, formatGBP(total) + ' owed to Galloway Getaways', emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">You owe <strong>' + formatGBP(total) + '</strong>. '
                + 'We’d normally take it off your next payout, but you don’t have one coming, so it’s due now.</p>'
                + '<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;">' + lines + '</ul>'
                + '<p style="margin:0 0 16px;font-size:15px;">You can pay it from your earnings page. '
                + 'If you think it’s wrong, dispute it there and one of us will look at it — nothing is taken while we do.</p>'
                + button(SITE_URL + '/dashboard/earnings#owed', 'Pay or dispute'),
                'You’re receiving this because you host with Galloway Getaways.'));

            await admin.from('payouts')
                .update({ due_notice_sent_at: new Date().toISOString() })
                .in('id', debts.map((d) => d.id))
                .eq('status', 'owed');
            noticed++;
        }
    } catch (err) {
        await logError('[cron/host-debts] due notices failed', err, { path: 'api/cron/host-debts' });
    }

    return NextResponse.json({ ok: true, reconciled, noticed });
}
