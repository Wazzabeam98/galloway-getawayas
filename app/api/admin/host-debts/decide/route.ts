import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/adminAudit';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { formatGBP } from '@/lib/formatMoney';
import { outstandingOf, round2 } from '@/lib/hostDebt';
import { decisionProblem, DEBT_SELECT, debtTitle, type HostDebt } from '@/lib/hostDebtView';

export const dynamic = 'force-dynamic';

// An admin deciding a host's disputed debt: uphold it (owed again, in full),
// reduce it (owed again, less), or waive it (written off). The decision and the
// running total move together inside decide_host_debt_dispute. Nothing is sent
// to or taken from Stripe here — an upheld or reduced debt goes back to being
// recovered from payouts or paid by the host, the same as any other.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!(await isAdmin(user.id))) return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const payoutId: string = body && body.payoutId;
        if (!payoutId) return NextResponse.json({ ok: false, error: 'Missing debt' }, { status: 400 });

        const admin = adminClient();
        const { data: row } = await admin.from('payouts').select(DEBT_SELECT).eq('id', payoutId).maybeSingle();
        if (!row || row.status !== 'disputed') {
            return NextResponse.json({ ok: false, error: 'That dispute is already decided.' }, { status: 409 });
        }
        const outstanding = outstandingOf(row as HostDebt);
        const problem = decisionProblem(body.outcome, body.keep, outstanding, body.note);
        if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

        const note = String(body.note).trim().slice(0, 1000);
        const { data: kept, error } = await admin.rpc('decide_host_debt_dispute', {
            p_payout: payoutId,
            p_admin: user.id,
            p_outcome: body.outcome,
            p_keep: body.outcome === 'reduced' ? round2(Number(body.keep)) : null,
            p_note: note,
        });
        if (error) {
            await logError('[admin/host-debts/decide] could not record the decision', error, { path: 'api/admin/host-debts/decide', userId: user.id });
            return NextResponse.json({ ok: false, error: 'Could not save that. Try again.' }, { status: 500 });
        }
        if (kept === null || kept === undefined) {
            return NextResponse.json({ ok: false, error: 'That dispute is already decided.' }, { status: 409 });
        }

        const keep = round2(Number(kept));
        try {
            const { data: hostUser } = await admin.auth.admin.getUserById(row.host_id);
            const email = (hostUser && hostUser.user && hostUser.user.email) || '';
            if (email) {
                const headline = keep > 0
                    ? (body.outcome === 'upheld'
                        ? 'We’ve looked at your dispute — the ' + formatGBP(keep) + ' stands'
                        : 'We’ve reduced what you owe to ' + formatGBP(keep))
                    : 'We’ve written off the ' + formatGBP(outstanding) + ' you disputed';
                await sendEmail(email, headline, emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(headline) + '.</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;color:#475569;">'
                    + escapeHtml(debtTitle(row as HostDebt)) + '.</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;">“' + escapeHtml(note) + '”</p>'
                    + (keep > 0
                        ? '<p style="margin:0 0 16px;font-size:15px;">It comes off your next payout, or you can pay it now.</p>'
                        : '')
                    + button(SITE_URL + '/dashboard/earnings#owed', 'See what you owe'),
                    'You’re receiving this because you host with Galloway Getaways.'));
            }
        } catch (mailErr) {
            await logError('[admin/host-debts/decide] host email', mailErr, { path: 'api/admin/host-debts/decide' });
        }

        return NextResponse.json({ ok: true, owed: keep });
    } catch (err: any) {
        await logError('[admin/host-debts/decide] failed', err, { path: 'api/admin/host-debts/decide' });
        return NextResponse.json({ ok: false, error: 'Could not save that. Try again.' }, { status: 500 });
    }
}
