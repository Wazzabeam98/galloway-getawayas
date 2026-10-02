import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen, exclusivePerDate } from '@/lib/serviceOrders';
import { loadOrderForChange, buildChangeFeed, validateProposedChange } from '@/lib/orderChangeFeed';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE, formatDate } from '@/lib/email';
import { formatTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// THE GUEST'S SIDE of a date/time change on a request-shape order (made_to_order,
// comes_to_you). Two things happen here:
//   - the guest ASKS the provider to move it (POST, the PR #173 case) — the new
//     date is parked on the confirmed order (pending_change_by='guest') and the
//     provider answers via /api/services/orders/respond;
//   - the guest ANSWERS a change the PROVIDER proposed (POST action=accept/decline)
//     — the mirror of that, now that a provider can propose one too.
// A slot uses /api/services/slots/move; this route refuses it. A date change moves
// no money, so nothing here touches a payment. The per-category rules (offerable
// window, opening hours, exclusive-per-date) live in lib/orderChangeFeed.

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const loaded = await loadOrderForChange(admin, orderId);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });
        if (loaded.order.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const feed = await buildChangeFeed(admin, loaded, new Date());
        return NextResponse.json({ ok: true, ...feed });
    } catch (err: any) {
        await logError('services-order-change-date-GET', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not load that.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const orderId: string = body && body.orderId;
        const action: string = String((body && body.action) || 'request');

        const admin = adminClient();
        const loaded = await loadOrderForChange(admin, orderId);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });
        if (loaded.order.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        const order = loaded.order;

        // ANSWER A PROVIDER'S PROPOSAL. The provider parked a new date/time
        // (pending_change_by='provider'); the guest accepts (apply) or declines
        // (clear). No money moves. The provider is told either way.
        if (action === 'accept' || action === 'decline') {
            if (!order.pending_service_date || order.pending_change_by !== 'provider') {
                return NextResponse.json({ ok: false, error: 'There’s no change to answer.' }, { status: 409 });
            }
            if (order.pending_change_expires_at && new Date(order.pending_change_expires_at) < new Date()) {
                await admin.from('service_orders').update({ pending_service_date: null, pending_service_time: null, pending_change_expires_at: null, pending_change_by: null }).eq('id', order.id);
                return NextResponse.json({ ok: false, error: 'That change request has expired.' }, { status: 409 });
            }
            if (action === 'decline') {
                await admin.from('service_orders').update({ pending_service_date: null, pending_service_time: null, pending_change_expires_at: null, pending_change_by: null }).eq('id', order.id).eq('status', 'confirmed');
                await notifyProvider(loaded, 'declined', order.pending_service_date, order.pending_service_time);
                return NextResponse.json({ ok: true, status: 'declined' });
            }
            const newDate = String(order.pending_service_date).slice(0, 10);
            const newTime = order.pending_service_time ? String(order.pending_service_time).slice(0, 8) : order.service_time;
            if (exclusivePerDate(loaded.provider)) {
                const { data: clash } = await admin.from('service_orders').select('id')
                    .eq('provider_id', order.provider_id).eq('service_date', newDate)
                    .in('status', ['authorised', 'confirmed']).neq('id', order.id).limit(1);
                if (clash && clash.length) return NextResponse.json({ ok: false, error: 'That date is no longer free.' }, { status: 409 });
            }
            const { error: mvErr } = await admin.from('service_orders')
                .update({ service_date: newDate, service_time: newTime, pending_service_date: null, pending_service_time: null, pending_change_expires_at: null, pending_change_by: null })
                .eq('id', order.id).eq('status', 'confirmed');
            if (mvErr) return NextResponse.json({ ok: false, error: 'Could not move the booking.' }, { status: 500 });
            await notifyProvider(loaded, 'accepted', newDate, newTime);
            return NextResponse.json({ ok: true, status: 'accepted', date: newDate });
        }

        // ASK THE PROVIDER TO MOVE IT. Park the requested date/time on the still-
        // confirmed order (pending_change_by='guest') and email the provider to
        // answer. Only one pending change at a time.
        const v = await validateProposedChange(admin, loaded, body && body.date, body && body.time, new Date());
        if ('error' in v) return NextResponse.json({ ok: false, error: v.error.message }, { status: v.error.status });

        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        const { data: saved, error: saveErr } = await admin
            .from('service_orders')
            .update({ pending_service_date: v.newDate, pending_service_time: v.newTime, pending_change_expires_at: expiresAt, pending_change_by: 'guest' })
            .eq('id', order.id).eq('status', 'confirmed')
            .select('id');
        if (saveErr) return NextResponse.json({ ok: false, error: 'Could not request the change. Try again.' }, { status: 500 });
        if (!saved || !saved.length) return NextResponse.json({ ok: false, error: 'That booking changed — reload and try again.' }, { status: 409 });

        try {
            const prov = loaded.provider;
            if (prov && prov.contact_email) {
                await sendEmail(prov.contact_email, 'A guest wants to change a booking', emailLayout(
                    '<p>A guest has asked to move their ' + escapeHtml(order.item_name || 'booking') + ' to <strong>' + escapeHtml(formatDate(v.newDate))
                    + (v.newTime ? ' at ' + escapeHtml(formatTime(v.newTime)) : '')
                    + '</strong>. Nothing is charged either way — accept within 48 hours, or decline to keep the original.</p>'
                    + button(SITE_URL + '/services/dashboard', 'Answer the request'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.', undefined, NEUTRAL_SUBTITLE));
            }
        } catch (e) { console.error('[change-date] notify', e); }

        return NextResponse.json({ ok: true, requested: true, date: v.newDate, time: v.newTime });
    } catch (err: any) {
        await logError('services-order-change-date-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not change the date.' }, { status: 500 });
    }
}

// Tell the provider how the guest answered the change THEY proposed.
async function notifyProvider(loaded: any, outcome: 'accepted' | 'declined', date: any, time: any): Promise<void> {
    try {
        const prov = loaded.provider;
        const to = String((prov && prov.contact_email) || '').trim();
        if (!to) return;
        const when = escapeHtml(formatDate(String(date).slice(0, 10)) + (time ? ' at ' + formatTime(String(time).slice(0, 5)) : ''));
        const item = escapeHtml(loaded.order.item_name || 'the booking');
        const html = outcome === 'accepted'
            ? emailLayout('<p>Good news — the guest has accepted your new date for ' + item + '. It’s now booked for <strong>' + when + '</strong>. Nothing changed on their card.</p>',
                'You’re receiving this because you offer experiences on Galloway Getaways.', undefined, NEUTRAL_SUBTITLE)
            : emailLayout('<p>The guest has declined the change you proposed for ' + item + '. It stays on its original date, and nothing has changed.</p>',
                'You’re receiving this because you offer experiences on Galloway Getaways.', undefined, NEUTRAL_SUBTITLE);
        await sendEmail(to, outcome === 'accepted' ? 'Your date change was accepted' : 'About the date change you proposed', html);
    } catch (e) { console.error('[change-date] notifyProvider', e); }
}
