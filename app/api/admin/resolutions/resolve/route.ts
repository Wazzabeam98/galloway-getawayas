import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/adminAudit';
import { logError } from '@/lib/logError';
import { validateAdminResolve, outcomeLabel } from '@/lib/adminResolutions';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { round2 } from '@/lib/resolutions';

export const dynamic = 'force-dynamic';

// An admin closing an escalated money request. It records the decision and the
// reason and stamps the row closed — it moves NO money. An escalation is a
// request the guest never paid, so there is nothing on the platform to send
// back; a genuine refund of something already paid goes through the send/refund
// path, not here. getUser() + isAdmin on the server every time: the page hiding
// its own link is tidiness, this is what keeps people out.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): the id must be verified by the auth
        // server, not decoded from a cookie the caller could have written.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!(await isAdmin(user.id))) return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const resolutionId: string = body && body.resolutionId;
        const outcome = body && body.outcome;
        const note = body && body.note;
        if (!resolutionId) return NextResponse.json({ ok: false, error: 'Missing request' }, { status: 400 });

        const admin = adminClient();
        const { data: res } = await admin
            .from('booking_resolutions')
            .select('id, booking_id, host_id, guest_id, amount, reason, status, resolved_at')
            .eq('id', resolutionId)
            .maybeSingle();

        const check = validateAdminResolve(res as any, outcome, note);
        if (!check.ok) {
            // A missing row is a 404; a closed/invalid one is a 409; a bad
            // outcome/note is a 400. The guard already sorted which.
            const status = !res ? 404 : (res.status !== 'escalated' || res.resolved_at) ? 409 : 400;
            return NextResponse.json({ ok: false, error: check.error }, { status });
        }

        const nowIso = new Date().toISOString();
        // CAS on the open-escalation shape: a second admin acting at the same
        // moment can't double-close, and a row that moved underneath is left
        // alone rather than silently overwritten.
        const { data: updated, error } = await admin
            .from('booking_resolutions')
            .update({
                admin_outcome: outcome,
                admin_note: String(note).trim(),
                resolved_by: user.id,
                resolved_at: nowIso,
                updated_at: nowIso,
            })
            .eq('id', res!.id)
            .eq('status', 'escalated')
            .is('resolved_at', null)
            .select('id')
            .maybeSingle();

        if (error) throw error;
        if (!updated) return NextResponse.json({ ok: false, error: 'That escalation was just closed.' }, { status: 409 });

        // Tell both parties it has been decided. Non-blocking: the decision is
        // recorded whether or not the mail goes out.
        const line = 'An admin has reviewed the £' + round2(Number(res!.amount || 0)).toFixed(2)
            + (res!.reason === 'damage' ? ' damage' : ' extra-services') + ' request. Outcome: '
            + outcomeLabel(String(outcome)) + '.';
        await notify(admin, res!.host_id, 'A money request was resolved', line, SITE_URL + '/dashboard', 'Open your dashboard');
        await notify(admin, res!.guest_id, 'A money request was resolved', line, SITE_URL + '/trips', 'View your trips');

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[admin/resolutions/resolve] ' + ((err && err.message) || 'failed'), err, { path: 'admin/resolutions/resolve' });
        return NextResponse.json({ ok: false, error: 'Could not resolve that.' }, { status: 500 });
    }
}

async function notify(admin: any, userId: string, subject: string, line: string, href: string, cta: string) {
    try {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        const to = (u && u.user && u.user.email) || '';
        if (to) await sendEmail(to, subject, emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(line) + '</p>' + button(href, cta),
            'You’re receiving this because of a booking with Galloway Getaways.'));
    } catch { /* a failed notification must not undo the recorded decision */ }
}
