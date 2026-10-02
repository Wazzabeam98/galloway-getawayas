import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { londonDayKey } from '@/lib/dayKey';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { planReminders, reminderCopy, ReminderBooking } from '@/lib/payoutReminders';

export const dynamic = 'force-dynamic';

// Hourly: remind a host with no payouts set up, on their first booking and
// again before that guest checks in. The choosing is lib/payoutReminders; this
// reads, claims and sends.
//
// CLAIM BEFORE SEND. The host_payout_reminders row is inserted first and its
// primary key (booking, kind) makes a second insert fail — so two overlapping
// runs can't both email. A send that fails after its claim is logged and not
// retried: one missed reminder beats a host getting the same email hourly.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    let sent = 0;
    let failed = 0;

    try {
        const today = londonDayKey();

        // Hosts with a stay still to come — the only ones a reminder is for.
        const { data: upcoming, error: upcomingError } = await admin
            .from('bookings')
            .select('host_id')
            .eq('status', 'confirmed')
            .gte('check_in', today);
        if (upcomingError) throw upcomingError;
        const candidateIds = Array.from(new Set((upcoming || []).map((b: any) => b.host_id).filter(Boolean)));
        if (candidateIds.length === 0) return NextResponse.json({ ok: true, sent, failed });

        // Of those, the ones without payouts.
        const { data: hosts, error: hostError } = await admin
            .from('profiles')
            .select('id, email, full_name, preferred_name')
            .in('id', candidateIds)
            .eq('stripe_payouts_enabled', false);
        if (hostError) throw hostError;
        if (!hosts || hosts.length === 0) return NextResponse.json({ ok: true, sent, failed });

        // Every confirmed booking of theirs, past too — "first booking" means
        // first ever.
        const { data: bookings, error: bookingError } = await admin
            .from('bookings')
            .select('id, host_id, listing_id, check_in, created_at')
            .in('host_id', hosts.map((h: any) => h.id))
            .eq('status', 'confirmed');
        if (bookingError) throw bookingError;
        if (!bookings || bookings.length === 0) return NextResponse.json({ ok: true, sent, failed });

        const { data: claimed, error: claimReadError } = await admin
            .from('host_payout_reminders')
            .select('booking_id, kind')
            .in('booking_id', bookings.map((b: any) => b.id));
        if (claimReadError) throw claimReadError;
        const already = new Set<string>((claimed || []).map((r: any) => r.booking_id + ':' + r.kind));

        const plan = planReminders(bookings as ReminderBooking[], already, today);
        if (plan.length === 0) return NextResponse.json({ ok: true, sent, failed });

        const listingIds = Array.from(new Set(plan.map((p) => (p.booking as any).listing_id)));
        const { data: listings } = await admin.from('listings').select('id, title').in('id', listingIds);
        const titleOf: Record<string, string> = {};
        (listings || []).forEach((l: any) => { titleOf[l.id] = l.title || 'your place'; });
        const hostOf: Record<string, any> = {};
        hosts.forEach((h: any) => { hostOf[h.id] = h; });

        for (const p of plan) {
            const host = hostOf[p.booking.host_id];
            if (!host || !host.email) continue;

            const rows = [{ booking_id: p.booking.id, kind: p.kind }];
            if (p.alsoClaim) rows.push({ booking_id: p.booking.id, kind: p.alsoClaim });
            const { error: claimError } = await admin.from('host_payout_reminders').insert(rows);
            if (claimError) continue; // another run got there first

            const title = escapeHtml(titleOf[(p.booking as any).listing_id] || 'your place');
            const copy = reminderCopy(p.kind, title, 'on ' + escapeHtml(formatDate(p.booking.check_in)));
            const name = escapeHtml(String(host.preferred_name || host.full_name || '').split(' ')[0] || 'there');
            const ok = await sendEmail(
                host.email,
                copy.subject,
                emailLayout(
                    `<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>`
                    + copy.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;">${t}</p>`).join('')
                    + button(SITE_URL + '/payouts/setup', 'Add a payout method'),
                    'You are receiving this because you list a property on Galloway Getaways and haven’t added a payout method yet.'
                )
            );
            if (ok) sent += 1;
            else {
                failed += 1;
                await logError('payout-reminders: reminder email did not send',
                    { booking: p.booking.id, kind: p.kind },
                    { path: '/api/cron/payout-reminders' });
            }
        }

        return NextResponse.json({ ok: true, sent, failed });
    } catch (err: any) {
        await logError('payout-reminders: run failed', err, { path: '/api/cron/payout-reminders' });
        return NextResponse.json({ ok: false, error: 'Run failed', sent, failed }, { status: 500 });
    }
}
