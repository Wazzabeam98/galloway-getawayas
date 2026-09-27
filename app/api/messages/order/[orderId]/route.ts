import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { orderThreadContext } from '@/lib/orderThreads';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE, formatDate } from '@/lib/email';
import { isAutomatedTestAddress } from '@/lib/testAddresses';
import { orderNet, orderReference } from '@/lib/serviceOrders';
import { orderLocation } from '@/lib/orderLocation';
import { whenLabel } from '@/components/marketplace/present';
import { formatGBP } from '@/lib/formatMoney';

export const dynamic = 'force-dynamic';

// The message thread on a guest experience order — the baker and the guest with
// an allergy, the chef and the cottage. Both routes gate on participation
// through orderThreadContext, the same guest / provider-owner pair the RLS on
// messages allows, checked here so the service role can read the other side's
// name and stamp read_at.

async function participant(orderId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    const admin = adminClient();
    const ctx = await orderThreadContext(admin, orderId, user.id);
    if (!ctx) return { error: NextResponse.json({ ok: false, error: 'Not your thread.' }, { status: 403 }) };
    return { admin, ctx, uid: user.id };
}

export async function GET(_req: Request, { params }: { params: { orderId: string } }) {
    try {
        const p = await participant(params.orderId);
        if (p.error) return p.error;
        const { admin, ctx, uid } = p;

        const { data: messages } = await admin
            .from('messages')
            .select('id, sender_id, body, created_at, read_at')
            .eq('order_id', params.orderId)
            .order('created_at', { ascending: true });

        // Opening the thread reads it — stamp this viewer's inbound messages.
        await admin
            .from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('order_id', params.orderId)
            .eq('recipient_id', uid)
            .is('read_at', null);

        // The reservation this thread is about, in the reservation-card's own
        // language — so the messages right pane can show the same detail the
        // dashboard card does. Money is viewer-aware: a provider sees their take
        // (with our fee shown as working); a guest sees what they paid.
        const { data: full } = await admin
            .from('service_orders')
            .select('id, shape, service_time, fulfilment, service_address, price, commission_rate, amount_refunded, item_unit, unit_price, quantity, attendees, adults, children, note, allergy, guest_phone')
            .eq('id', params.orderId)
            .maybeSingle();

        let reservation: any = null;
        if (full) {
            const net = orderNet(full);
            const loc = orderLocation({ shape: full.shape, fulfilment: full.fulfilment });
            const a = Number(full.adults) || 0, c = Number(full.children) || 0;
            const party = (a > 0 || c > 0)
                ? [a > 0 ? a + (a === 1 ? ' adult' : ' adults') : '', c > 0 ? c + (c === 1 ? ' child' : ' children') : ''].filter(Boolean).join(', ')
                : (full.item_unit === 'person'
                    ? (Number(full.quantity) || 1) + ((Number(full.quantity) || 1) === 1 ? ' place' : ' places')
                    : null);
            const where = full.shape === 'comes_to_you'
                ? (full.service_address ? (ctx.isGuest ? 'They come to ' + full.service_address : 'You go to ' + full.service_address) : (ctx.isGuest ? 'They come to you' : 'You go to the guest'))
                : full.shape === 'made_to_order'
                    ? (loc.comesToCottage ? (full.service_address ? 'Delivery to ' + full.service_address : 'For delivery') : 'For collection')
                    : (loc.slotTravels ? 'They travel to you' : 'At the provider’s place');
            reservation = {
                reference: orderReference(full.id),
                whenLabel: whenLabel(full.shape, ctx.order.service_date, full.service_time),
                whenHeading: full.shape === 'made_to_order' ? 'Ready for' : 'When',
                party,
                where,
                note: full.note || null,
                allergy: full.allergy || null,
                money: ctx.isGuest
                    ? { show: true, rows: [{ label: 'You paid', value: formatGBP(net.gross - net.refunded) }], working: null }
                    : {
                        show: true,
                        rows: [
                            { label: 'Guest paid', value: formatGBP(net.gross - net.refunded) },
                            { label: 'Our fee (' + Math.round(net.rate * 100) + '%)', value: '-' + formatGBP(net.fee), muted: true },
                            { label: 'You get', value: formatGBP(net.youGet) },
                        ],
                        working: 'Guest paid ' + formatGBP(net.gross - net.refunded) + ' − our ' + Math.round(net.rate * 100) + '% fee ' + formatGBP(net.fee) + ' = ' + formatGBP(net.youGet) + '.',
                    },
                phone: ctx.isGuest ? null : (full.guest_phone || null),
            };
        }

        return NextResponse.json({
            ok: true,
            viewerId: uid,
            other: { id: ctx.otherId, name: ctx.otherName },
            context: {
                business: ctx.business,
                item: ctx.order.item_name,
                serviceDate: ctx.order.service_date,
                status: ctx.order.status,
                reservation,
            },
            messages: messages || [],
        });
    } catch (err: any) {
        await logError('order-thread-get', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

export async function POST(req: Request, { params }: { params: { orderId: string } }) {
    try {
        const p = await participant(params.orderId);
        if (p.error) return p.error;
        const { admin, ctx, uid } = p;

        const body = String(((await req.json()) || {}).body || '').trim().slice(0, 4000);
        if (!body) return NextResponse.json({ ok: false, error: 'Nothing to send.' }, { status: 400 });

        const { data: saved, error } = await admin
            .from('messages')
            .insert({ order_id: params.orderId, sender_id: uid, recipient_id: ctx.otherId, body })
            .select('id, sender_id, body, created_at, read_at')
            .single();
        if (error || !saved) {
            return NextResponse.json({ ok: false, error: 'Could not send that.' }, { status: 500 });
        }

        // Tell the other side, unless they've turned new-message email off.
        try {
            const { data: pref } = await admin
                .from('notification_preferences')
                .select('new_message')
                .eq('user_id', ctx.otherId)
                .maybeSingle();
            const wants = !pref || pref.new_message !== false;
            if (wants) {
                const recipient = await admin.auth.admin.getUserById(ctx.otherId);
                const to = (recipient && recipient.data && recipient.data.user && recipient.data.user.email) || '';
                // The sender, named to the recipient: the business to the guest,
                // the guest to the business. ctx.isGuest describes the SENDER
                // (the current user), and this email goes to the OTHER party — so
                // a guest sender is named by their own name to the provider, and a
                // provider sender is named by the business to the guest. (This was
                // inverted: it showed the provider their own business name and the
                // guest their own name.)
                const senderName = ctx.isGuest ? ctx.guestName : ctx.business;
                const about = (ctx.order.item_name ? String(ctx.order.item_name) + ' — ' : '')
                    + formatDate(String(ctx.order.service_date));
                if (to && !isAutomatedTestAddress(to)) {
                    await sendEmail(
                        to,
                        'New message about your booking',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(senderName)
                                + '</strong> sent you a message about ' + escapeHtml(about) + ':</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;padding:12px 16px;background:#f8fafc;border-radius:10px;"><em>'
                                + escapeHtml(body.slice(0, 300)) + (body.length > 300 ? '…' : '') + '</em></p>'
                                // Deep-link the RECIPIENT to their own copy of this
                                // thread. ctx.isGuest describes the SENDER, so the
                                // recipient is the opposite party: a guest sender
                                // (isGuest) means the provider receives this and
                                // replies in the provider area; a provider sender
                                // means the guest receives it and replies in theirs.
                                + button(SITE_URL + (ctx.isGuest
                                    ? '/services/messages/order/' + params.orderId
                                    : '/experiences/order/' + params.orderId), 'Reply'),
                            'You are receiving this because you have a booking thread on Galloway Getaways.',
                            undefined, NEUTRAL_SUBTITLE
                        )
                    );
                }
            }
        } catch (err) {
            await logError('order-thread-notify', err);
        }

        return NextResponse.json({ ok: true, message: saved });
    } catch (err: any) {
        await logError('order-thread-post', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
