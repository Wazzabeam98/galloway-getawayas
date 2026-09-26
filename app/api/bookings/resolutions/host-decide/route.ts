import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { sendEmail, sendEmailToAll, recipients, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { hostMayDecideCounter, hostMayCancel, escalationDeadline, round2 } from '@/lib/resolutions';

export const dynamic = 'force-dynamic';

// The HOST acting on a request: accept the guest's counter-offer (back to the
// guest to pay), decline it (escalate to an admin), or cancel the request.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const resolutionId: string = body && body.resolutionId;
        const action: string = body && body.action;
        if (!resolutionId || !['accept-counter', 'decline-counter', 'cancel'].includes(action)) {
            return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: res } = await admin
            .from('booking_resolutions')
            .select('id, booking_id, host_id, guest_id, amount, counter_amount, status')
            .eq('id', resolutionId)
            .maybeSingle();
        if (!res) return NextResponse.json({ ok: false, error: 'No such request' }, { status: 404 });

        const { data: booking } = await admin.from('bookings').select('listing_id').eq('id', res.booking_id).maybeSingle();
        const access = booking ? await checkListing(user.id, booking.listing_id, 'can_bookings') : null;
        if (!access) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const nowIso = new Date().toISOString();

        if (action === 'accept-counter') {
            if (!hostMayDecideCounter(res.status as any) || !res.counter_amount) {
                return NextResponse.json({ ok: false, error: 'There’s no counter-offer to accept.' }, { status: 409 });
            }
            await admin.from('booking_resolutions')
                .update({ amount: res.counter_amount, status: 'pending', expires_at: escalationDeadline(nowIso), updated_at: nowIso })
                .eq('id', res.id).eq('status', 'countered');
            await notifyGuest(admin, res.guest_id,
                'Your suggested amount was accepted',
                'Your host accepted £' + round2(Number(res.counter_amount)).toFixed(2) + '. You can pay it now.',
                SITE_URL + '/resolutions/' + res.id, 'Pay now');
            return NextResponse.json({ ok: true, status: 'pending' });
        }

        if (action === 'decline-counter') {
            if (!hostMayDecideCounter(res.status as any)) {
                return NextResponse.json({ ok: false, error: 'There’s no counter-offer to decline.' }, { status: 409 });
            }
            await admin.from('booking_resolutions')
                .update({ status: 'escalated', escalated_at: nowIso, updated_at: nowIso })
                .eq('id', res.id).eq('status', 'countered');
            try {
                // Comma-split so two directors both hear about it, via the same
                // helper the webhook and dispute routes use — a bare string here
                // gave Resend one malformed recipient and neither was told.
                const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
                if (to.length) await sendEmailToAll(to, 'Escalated: host declined a counter-offer', emailLayout(
                    '<p>The host declined the guest’s counter-offer on booking ' + escapeHtml(String(res.booking_id)) + '.</p>'
                    + button(SITE_URL + '/admin/resolutions', 'Open the resolutions queue'),
                    'Galloway Getaways admin alert.'));
            } catch { /* alert must not block */ }
            return NextResponse.json({ ok: true, status: 'escalated' });
        }

        // cancel
        if (!hostMayCancel(res.status as any)) {
            return NextResponse.json({ ok: false, error: 'That can’t be cancelled now.' }, { status: 409 });
        }
        await admin.from('booking_resolutions')
            .update({ status: 'cancelled', updated_at: nowIso })
            .eq('id', res.id).in('status', ['pending', 'countered']);
        await notifyGuest(admin, res.guest_id, 'A money request was withdrawn',
            'Your host has withdrawn their request for £' + round2(Number(res.amount)).toFixed(2) + '. There’s nothing for you to do.',
            SITE_URL + '/trips', 'View your trips');
        return NextResponse.json({ ok: true, status: 'cancelled' });
    } catch (err: any) {
        await logError('[resolutions/host-decide] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/resolutions/host-decide' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}

async function notifyGuest(admin: any, guestId: string, subject: string, line: string, href: string, cta: string) {
    try {
        const { data: g } = await admin.auth.admin.getUserById(guestId);
        const to = (g && g.user && g.user.email) || '';
        if (to) await sendEmail(to, subject, emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(line) + '</p>' + button(href, cta),
            'You’re receiving this because you have a booking with Galloway Getaways.'));
    } catch { /* notify must not block the state change */ }
}
