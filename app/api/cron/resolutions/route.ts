import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Escalate money requests that never resolved. A request that passes its 72h
// deadline goes to an admin, mirroring Airbnb's "no response → involve us"
// ladder. Three open states count as "still waiting" and all escalate the same
// way: 'pending' (guest never answered), 'countered' (a counter the host never
// decided), and 'awaiting_guest_payment' (the guest accepted but never paid —
// the Checkout session was opened and abandoned, and the original 72h deadline
// still stands). Guarded on those statuses so a re-run only touches rows still
// waiting.
const OPEN_STATUSES = ['pending', 'countered', 'awaiting_guest_payment'];
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
            .in('status', OPEN_STATUSES)
            .lt('expires_at', nowIso);

        let escalated = 0;
        for (const r of (due || [])) {
            const { data: moved } = await admin
                .from('booking_resolutions')
                .update({ status: 'escalated', escalated_at: nowIso, updated_at: nowIso })
                .eq('id', r.id)
                .in('status', OPEN_STATUSES)
                .select('id');
            if (moved && moved.length) {
                escalated++;
                // Say which shape it is: a guest who accepted but never paid did
                // respond, so "no response" would be untrue for that one.
                const unpaidAccept = r.status === 'awaiting_guest_payment';
                try {
                    const to = process.env.DISPUTES_ALERT_EMAIL || '';
                    if (to) await sendEmail(to, 'A money request escalated (unresolved after 72h)', emailLayout(
                        '<p>A money request went unresolved for 72 hours and has been escalated'
                        + (unpaidAccept ? ' — the guest accepted it but never completed payment.' : ' — the guest did not respond.') + '</p>'
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
