import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Escalate money requests the guest never answered. A request (or a counter
// awaiting the host) that passes its 72h deadline goes to an admin, mirroring
// Airbnb's "no response → involve us" ladder. Guarded on the open statuses so a
// re-run only touches rows still waiting.
export async function GET(request: Request) {
    const auth = request.headers.get('authorization') || '';
    if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const admin = adminClient();
        const nowIso = new Date().toISOString();
        const { data: due } = await admin
            .from('booking_resolutions')
            .select('id, booking_id, amount, reason, status')
            .in('status', ['pending', 'countered'])
            .lt('expires_at', nowIso);

        let escalated = 0;
        for (const r of (due || [])) {
            const { data: moved } = await admin
                .from('booking_resolutions')
                .update({ status: 'escalated', escalated_at: nowIso, updated_at: nowIso })
                .eq('id', r.id)
                .in('status', ['pending', 'countered'])
                .select('id');
            if (moved && moved.length) {
                escalated++;
                try {
                    const to = process.env.DISPUTES_ALERT_EMAIL || '';
                    if (to) await sendEmail(to, 'A money request escalated (no response in 72h)', emailLayout(
                        '<p>A money request went unanswered for 72 hours and has been escalated.</p>'
                        + '<p>Booking ' + escapeHtml(String(r.booking_id)) + ', £' + Number(r.amount).toFixed(2)
                        + ' (' + escapeHtml(String(r.reason).replace('_', ' ')) + ').</p>'
                        + button(SITE_URL + '/admin/resolutions', 'Open the resolutions queue'),
                        'Galloway Getaways admin alert.'));
                } catch { /* alerting must never block the sweep */ }
            }
        }
        return NextResponse.json({ ok: true, escalated });
    } catch (err: any) {
        await logError('[cron/resolutions] ' + ((err && err.message) || 'failed'), err, { path: 'cron/resolutions' });
        return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 });
    }
}
