import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmailToAll, recipients, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { formatGBP } from '@/lib/formatMoney';
import { disputeReasonProblem, DEBT_SELECT, debtTitle, attachBookings, type HostDebt } from '@/lib/hostDebtView';

export const dynamic = 'force-dynamic';

// A host saying a debt is wrong.
//
// The debt moves to 'disputed' and comes off the running total while a person
// looks at it (dispute_host_debt, one locked statement), so the payout run does
// not take money nobody has yet decided is owed. It then sits in the same admin
// queue as escalated money requests (/admin/resolutions) and the directors on
// DISPUTES_ALERT_EMAIL are told, exactly as an escalation is.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const payoutId: string = body && body.payoutId;
        const reasonProblem = disputeReasonProblem(body && body.reason);
        if (!payoutId) return NextResponse.json({ ok: false, error: 'Missing debt' }, { status: 400 });
        if (reasonProblem) return NextResponse.json({ ok: false, error: reasonProblem }, { status: 400 });
        const reason = String(body.reason).trim();

        const admin = adminClient();
        const { data: moved, error } = await admin.rpc('dispute_host_debt', {
            p_payout: payoutId,
            p_host: user.id,
            p_reason: reason,
        });
        if (error) {
            await logError('[host-debts/dispute] could not open the dispute', error, { path: 'api/host-debts/dispute', userId: user.id });
            return NextResponse.json({ ok: false, error: 'Could not send that. Try again.' }, { status: 500 });
        }
        if (moved === null || moved === undefined) {
            return NextResponse.json({ ok: false, error: 'This can’t be disputed — it may already be paid or under review.' }, { status: 409 });
        }

        try {
            const { data: row } = await admin.from('payouts').select(DEBT_SELECT).eq('id', payoutId).maybeSingle();
            const [debt] = row ? await attachBookings(admin, [row as HostDebt]) : [null as any];
            const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
            if (to.length) {
                await sendEmailToAll(to, 'Disputed: a host says ' + formatGBP(Number(moved)) + ' owed is wrong', emailLayout(
                    '<p>A host has disputed money they owe the platform. It is no longer being taken from their payouts until you decide.</p>'
                    + '<p><strong>' + formatGBP(Number(moved)) + '</strong> — '
                    + escapeHtml(debt ? debtTitle(debt).toLowerCase() : 'owed')
                    + (debt && debt.booking && debt.booking.listing_title ? ', ' + escapeHtml(debt.booking.listing_title) : '')
                    + '.</p>'
                    + '<p style="color:#475569;">“' + escapeHtml(reason) + '”</p>'
                    + button(SITE_URL + '/admin/resolutions#host-debts', 'Open money disputes'),
                    'Galloway Getaways admin alert.'));
            }
        } catch { /* alerting must never undo the state change */ }

        return NextResponse.json({ ok: true, paused: Number(moved) });
    } catch (err: any) {
        await logError('[host-debts/dispute] failed', err, { path: 'api/host-debts/dispute' });
        return NextResponse.json({ ok: false, error: 'Could not send that. Try again.' }, { status: 500 });
    }
}
