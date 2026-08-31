import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { enquiryThreadContext } from '@/lib/enquiryThreads';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { isAutomatedTestAddress } from '@/lib/testAddresses';

export const dynamic = 'force-dynamic';

// The message thread on an accepted (or cancelled) job. Both routes gate on
// participation through enquiryThreadContext — the same host/provider-owner
// pair the RLS on messages allows, checked here so the service role can read
// the other side's name and stamp read_at.

async function participant(enquiryId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    const admin = adminClient();
    const ctx = await enquiryThreadContext(admin, enquiryId, user.id);
    if (!ctx) return { error: NextResponse.json({ ok: false, error: 'Not your thread.' }, { status: 403 }) };
    return { admin, ctx, uid: user.id };
}

export async function GET(_req: Request, { params }: { params: { enquiryId: string } }) {
    try {
        const p = await participant(params.enquiryId);
        if (p.error) return p.error;
        const { admin, ctx, uid } = p;

        const { data: messages } = await admin
            .from('messages')
            .select('id, sender_id, body, created_at, read_at')
            .eq('enquiry_id', params.enquiryId)
            .order('created_at', { ascending: true });

        // Opening the thread reads it — stamp this viewer's inbound messages.
        await admin
            .from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('enquiry_id', params.enquiryId)
            .eq('recipient_id', uid)
            .is('read_at', null);

        let cottage: string | null = null;
        if (ctx.enquiry.listing_id) {
            const { data: l } = await admin.from('listings').select('title').eq('id', ctx.enquiry.listing_id).maybeSingle();
            cottage = (l && l.title) || null;
        }

        return NextResponse.json({
            ok: true,
            viewerId: uid,
            other: { id: ctx.otherId, name: ctx.otherName },
            context: {
                reference: ctx.enquiry.reference,
                status: ctx.enquiry.status,
                trade: tradeLabel(ctx.enquiry.trade),
                summary: ctx.enquiry.summary,
                askedFor: requestedWhen(ctx.enquiry),
                cottage,
                cancelled: ctx.enquiry.status === 'cancelled'
                    ? { by: ctx.enquiry.cancelled_by, reason: ctx.enquiry.cancel_reason }
                    : null,
            },
            messages: messages || [],
        });
    } catch (err: any) {
        await logError('enquiry-thread-get', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

export async function POST(req: Request, { params }: { params: { enquiryId: string } }) {
    try {
        const p = await participant(params.enquiryId);
        if (p.error) return p.error;
        const { admin, ctx, uid } = p;

        const body = String(((await req.json()) || {}).body || '').trim().slice(0, 4000);
        if (!body) return NextResponse.json({ ok: false, error: 'Nothing to send.' }, { status: 400 });

        const { data: saved, error } = await admin
            .from('messages')
            .insert({ enquiry_id: params.enquiryId, sender_id: uid, recipient_id: ctx.otherId, body })
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
                // The sender, named to the recipient: a business to the host, a
                // person to the tradesman.
                const senderName = ctx.isHost
                    ? String(ctx.enquiry.host_name || 'the host')
                    : String((ctx.provider && ctx.provider.business_name) || 'the tradesman');
                const jobLine = tradeLabel(ctx.enquiry.trade) + ' — ' + String(ctx.enquiry.summary || 'your job');
                if (to && !isAutomatedTestAddress(to)) {
                    await sendEmail(
                        to,
                        'New message about ' + String(ctx.enquiry.reference),
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(senderName)
                                + '</strong> sent you a message about ' + escapeHtml(jobLine) + ':</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;padding:12px 16px;background:#f8fafc;border-radius:10px;"><em>'
                                + escapeHtml(body.slice(0, 300)) + (body.length > 300 ? '…' : '') + '</em></p>'
                                + button(SITE_URL + '/messages/enquiry/' + params.enquiryId, 'Reply'),
                            'You are receiving this because you have a job thread on Galloway Getaways. Reference ' + escapeHtml(String(ctx.enquiry.reference)) + '.'
                        )
                    );
                }
            }
        } catch (err) {
            await logError('enquiry-thread-notify', err);
        }

        return NextResponse.json({ ok: true, message: saved });
    } catch (err: any) {
        await logError('enquiry-thread-post', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
