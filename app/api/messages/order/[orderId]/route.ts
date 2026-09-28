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
import { whereForOrder } from '@/lib/providerReservations';
import { whenLabel } from '@/components/marketplace/present';
import { formatGBP } from '@/lib/formatMoney';
import { groupLabel } from '@/lib/bookingDisplay';
import { displayName, getImageUrl } from '@/lib/utils';
import { cancellationFor } from '@/lib/providerReservations';

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
            .select('id, shape, service_time, fulfilment, service_address, price, commission_rate, amount_refunded, item_name, item_unit, unit_price, quantity, attendees, adults, children, note, allergy, guest_id, guest_name, guest_phone, pending_service_date, pending_service_time, pending_change_expires_at, pending_change_by')
            .eq('id', params.orderId)
            .maybeSingle();

        // The reservation card is the holiday-let host page's own layout, fed the
        // same shape here as on the provider dashboard so the two stay in step.
        // Viewer-aware: a provider sees the guest large with their take (our fee as
        // working); a guest sees the business large and only what they paid.
        let reservation: any = null;
        if (full) {
            const net = orderNet(full);
            const loc = orderLocation({ shape: full.shape, fulfilment: full.fulfilment });
            const status = ctx.order.status;
            const awaiting = status === 'authorised';

            // Guest name/avatar (provider view) and provider photo (guest view).
            const [{ data: gProf }, { data: prov }] = await Promise.all([
                full.guest_id
                    ? admin.from('profiles').select('full_name, preferred_name, show_full_name, avatar_url').eq('id', full.guest_id).maybeSingle()
                    : Promise.resolve({ data: null }),
                admin.from('service_providers').select('business_name, fulfilment, collection_street, collection_town, collection_postcode, photos, headshot, cancellation_window_hours, guest_details').eq('id', ctx.order.provider_id).maybeSingle(),
            ]);
            const guestName = gProf ? displayName(gProf, full.guest_name || 'Guest') : (full.guest_name || 'Guest');
            const guestFirst = String(guestName).trim().split(' ')[0] || 'Guest';
            const guestAvatar = (gProf && gProf.avatar_url) ? getImageUrl(String(gProf.avatar_url)) : null;
            const provPhoto = (prov && Array.isArray(prov.photos) && prov.photos[0]) ? getImageUrl(String(prov.photos[0]))
                : (prov && prov.headshot) ? getImageUrl(String(prov.headshot)) : null;

            const a = Number(full.adults) || 0, c = Number(full.children) || 0;
            const party = (a > 0 || c > 0) ? (a + c) : (Number(full.attendees || full.quantity) || 1);
            const itemName = ctx.order.item_name || full.item_name || ctx.business || 'Experience';

            // The guest reads it from their side; the provider reads it from
            // theirs, reusing the dashboard's whereForOrder so the two cards can
            // never word the same booking differently — in particular a booking
            // at the provider's own place shows the provider their venue name and
            // address, not "At the provider's place".
            const where = ctx.isGuest
                ? (full.shape === 'comes_to_you'
                    ? (full.service_address ? 'They come to ' + full.service_address : 'They come to you')
                    : full.shape === 'made_to_order'
                        ? (loc.comesToCottage ? (full.service_address ? 'Delivery to ' + full.service_address : 'For delivery') : 'For collection')
                        : (loc.slotTravels ? 'They travel to you' : 'At the provider’s place'))
                : whereForOrder(full, prov || {});

            const statusPill = status === 'confirmed' ? { label: 'Confirmed', tone: 'ok' }
                : awaiting ? (ctx.isGuest ? { label: 'Requested', tone: 'wait' } : { label: 'Awaiting your confirmation', tone: 'wait' })
                    : status === 'refunded' ? { label: 'Refunded', tone: 'over' }
                        : status === 'cancelled' ? { label: 'Cancelled', tone: 'over' }
                            : { label: String(status), tone: 'over' };

            const refundRow = net.refunded > 0 ? [{ label: 'Refunded', value: '-' + formatGBP(net.refunded), muted: true }] : [];
            let money: any = null;
            let moneyNote: string | null = null;
            if (ctx.isGuest) {
                if (awaiting) moneyNote = 'Your card is held, not charged yet — the provider confirms to take payment.';
                else money = {
                    showMoney: true,
                    caption: 'Money',
                    total: formatGBP(net.gross - net.refunded),
                    nightsLabel: 'What you paid',
                    description: 'What you paid for this booking.',
                    rows: [{ label: 'You paid', value: formatGBP(net.gross - net.refunded) }, ...refundRow],
                };
            } else {
                if (awaiting) moneyNote = 'Their card is held, not charged — confirm the request to take the payment (' + formatGBP(net.gross) + ').';
                else money = {
                    showMoney: true,
                    caption: 'Money',
                    total: formatGBP(net.youGet),
                    nightsLabel: 'Your take',
                    description: 'What the guest paid, our fee, and what reaches you.',
                    rows: [
                        { label: 'Guest paid', value: formatGBP(net.gross - net.refunded) },
                        ...refundRow,
                        { label: 'Our fee (' + Math.round(net.rate * 100) + '%)', value: '-' + formatGBP(net.fee), muted: true },
                        { label: 'You get', value: formatGBP(net.youGet) },
                    ],
                    working: 'Guest paid ' + formatGBP(net.gross - net.refunded) + ' − our ' + Math.round(net.rate * 100) + '% fee ' + formatGBP(net.fee) + ' = ' + formatGBP(net.youGet) + '.',
                };
            }

            // Provider-only extras: the Guests card, the provider's cancellation
            // terms, and the Manage sheet. A guest viewing their own thread sees
            // none of these.
            const partyLabel = (a > 0 || c > 0)
                ? [a > 0 ? a + (a === 1 ? ' adult' : ' adults') : '', c > 0 ? c + (c === 1 ? ' child' : ' children') : ''].filter(Boolean).join(', ')
                : (full.item_unit === 'person'
                    ? (Number(full.quantity) || 1) + ((Number(full.quantity) || 1) === 1 ? ' place' : ' places')
                    : 'Party of ' + party);
            const pendingLive = full.pending_service_date
                && (!full.pending_change_expires_at || new Date(full.pending_change_expires_at).getTime() > Date.now());
            const pendingChange = pendingLive ? whenLabel(full.shape, full.pending_service_date, full.pending_service_time) : null;
            const pendingChangeBy = pendingLive ? (full.pending_change_by === 'provider' ? 'provider' : 'guest') : null;
            const guests = ctx.isGuest ? null : { name: guestName, party: partyLabel };
            const cancellation = ctx.isGuest ? null : cancellationFor(
                full.shape,
                Number((prov && prov.cancellation_window_hours) ?? 48),
                !!(prov && prov.guest_details && prov.guest_details.no_refund),
            );
            const manage = ctx.isGuest ? null : {
                orderId: full.id,
                status,
                shape: full.shape,
                phone: full.guest_phone || null,
                guestFirst,
                messageHref: '/messages?o=' + full.id,
                pendingChange,
                pendingChangeBy,
            };

            reservation = {
                reference: orderReference(full.id),
                avatarUrl: ctx.isGuest ? null : guestAvatar,
                initial: ctx.isGuest ? (ctx.business || 'G').slice(0, 1).toUpperCase() : guestFirst.slice(0, 1).toUpperCase(),
                photoUrl: ctx.isGuest ? null : provPhoto,
                heading: ctx.isGuest ? ctx.business : groupLabel(guestFirst, party),
                whenLabel: whenLabel(full.shape, ctx.order.service_date, full.service_time),
                itemName,
                status: statusPill,
                whenHeading: full.shape === 'made_to_order' ? 'Ready for' : 'When',
                where,
                note: ctx.isGuest ? null : (full.note || null),
                allergy: ctx.isGuest ? null : (full.allergy || null),
                money,
                moneyNote,
                phone: ctx.isGuest ? null : (full.guest_phone || null),
                personFirst: ctx.isGuest ? (ctx.otherName || '').split(' ')[0] : guestFirst,
                guests,
                cancellation,
                manage,
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
