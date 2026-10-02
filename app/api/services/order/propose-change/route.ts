import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadOrderForChange, buildChangeFeed, validateProposedChange, type LoadedChange } from '@/lib/orderChangeFeed';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE, formatDate } from '@/lib/email';
import { formatTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// THE PROVIDER'S SIDE: proposing a new date/time to the guest — the mirror of the
// guest's change-date request. Same request-shapes (made_to_order, comes_to_you),
// same per-category rules (lib/orderChangeFeed), same "nothing moves until you
// agree": the proposed date/time is parked on the confirmed order
// (pending_change_by='provider') and the GUEST accepts (via change-date, action
// accept) or declines. A date change moves no money, so nothing here touches a
// payment. A slot is refused (moved from the session picker instead).

type Owned = { error: { status: number; message: string }; loaded?: undefined } | { error?: undefined; loaded: LoadedChange };

async function ownedOrder(admin: any, orderId: string, uid: string): Promise<Owned> {
    const loaded = await loadOrderForChange(admin, orderId);
    if ('error' in loaded) return { error: loaded.error };
    // The provider on the order has to be one the caller owns — verified, since a
    // proposal changes a real booking.
    if (!loaded.provider || loaded.provider.owner_id !== uid) return { error: { status: 403, message: 'Not your booking' } };
    return { loaded };
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const r = await ownedOrder(admin, orderId, user.id);
        if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: r.error.status });

        const feed = await buildChangeFeed(admin, r.loaded, new Date());
        return NextResponse.json({ ok: true, ...feed });
    } catch (err: any) {
        await logError('services-order-propose-change-GET', { message: String(err && err.message) });
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
        const admin = adminClient();
        const r = await ownedOrder(admin, body && body.orderId, user.id);
        if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: r.error.status });

        const v = await validateProposedChange(admin, r.loaded, body && body.date, body && body.time, new Date());
        if ('error' in v) return NextResponse.json({ ok: false, error: v.error.message }, { status: v.error.status });

        // Park the proposed date/time for the guest to answer. Only one pending
        // change at a time (the guest's own request would also sit here).
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        const { data: saved, error: saveErr } = await admin
            .from('service_orders')
            .update({ pending_service_date: v.newDate, pending_service_time: v.newTime, pending_change_expires_at: expiresAt, pending_change_by: 'provider' })
            .eq('id', r.loaded.order.id).eq('status', 'confirmed')
            .select('id');
        if (saveErr) return NextResponse.json({ ok: false, error: 'Could not send the request. Try again.' }, { status: 500 });
        if (!saved || !saved.length) return NextResponse.json({ ok: false, error: 'That booking changed — reload and try again.' }, { status: 409 });

        // Tell the guest their provider has proposed a new date/time to accept.
        try {
            const to = String(r.loaded.order.guest_email || '').trim();
            if (to) {
                const biz = escapeHtml(r.loaded.provider.business_name || 'Your experience');
                await sendEmail(to, biz + ' proposed a new date for your booking', emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;"><strong>' + biz + '</strong> has proposed moving your '
                    + escapeHtml(r.loaded.order.item_name || 'booking') + ' to <strong>' + escapeHtml(formatDate(v.newDate))
                    + (v.newTime ? ' at ' + escapeHtml(formatTime(v.newTime)) : '')
                    + '</strong>.</p><p style="margin:0 0 16px;font-size:16px;">Nothing changes on your card either way — accept within 48 hours to move it, or decline to keep your original booking.</p>'
                    + button(SITE_URL + '/experiences/order/' + r.loaded.order.id, 'Review the change'),
                    'You’re receiving this because you booked an experience through Galloway Getaways.', undefined, NEUTRAL_SUBTITLE));
            }
        } catch (e) { console.error('[propose-change] notify', e); }

        return NextResponse.json({ ok: true, requested: true, date: v.newDate, time: v.newTime });
    } catch (err: any) {
        await logError('services-order-propose-change-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not send the request.' }, { status: 500 });
    }
}
