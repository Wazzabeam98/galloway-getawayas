import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { orderThreadContext } from '@/lib/orderThreads';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { isAutomatedTestAddress } from '@/lib/testAddresses';

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

        return NextResponse.json({
            ok: true,
            viewerId: uid,
            other: { id: ctx.otherId, name: ctx.otherName },
            context: {
                business: ctx.business,
                item: ctx.order.item_name,
                serviceDate: ctx.order.service_date,
                status: ctx.order.status,
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
                // the guest to the business.
                const senderName = ctx.isGuest ? ctx.business : ctx.otherName;
                const about = (ctx.order.item_name ? String(ctx.order.item_name) + ' — ' : '')
                    + String(ctx.order.service_date);
                if (to && !isAutomatedTestAddress(to)) {
                    await sendEmail(
                        to,
                        'New message about your booking',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(senderName)
                                + '</strong> sent you a message about ' + escapeHtml(about) + ':</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;padding:12px 16px;background:#f8fafc;border-radius:10px;"><em>'
                                + escapeHtml(body.slice(0, 300)) + (body.length > 300 ? '…' : '') + '</em></p>'
                                + button(SITE_URL + (ctx.isGuest ? '/services/dashboard' : '/trips'), 'Reply'),
                            'You are receiving this because you have a booking thread on Galloway Getaways.'
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
