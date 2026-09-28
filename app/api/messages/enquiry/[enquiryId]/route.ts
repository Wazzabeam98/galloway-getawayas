import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { enquiryThreadContext } from '@/lib/enquiryThreads';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';
import { displayName, getImageUrl } from '@/lib/utils';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from '@/lib/email';
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
        let cottageImage: string | null = null;
        if (ctx.enquiry.listing_id) {
            const { data: l } = await admin.from('listings').select('title, images').eq('id', ctx.enquiry.listing_id).maybeSingle();
            cottage = (l && l.title) || null;
            cottageImage = (l && Array.isArray(l.images) && l.images[0]) ? getImageUrl(String(l.images[0])) : null;
        }

        // Host name/avatar (provider view) and host phone (released on accept), for
        // the reservation card beside the thread — the holiday-let host page's own
        // layout, so a job reads like a stay. A trade job is "asked for", at a
        // cottage, and paid off-platform (a note, not a fee card).
        const status = ctx.enquiry.status;
        const accepted = status === 'accepted';
        const needsReply = status === 'sent' || status === 'viewed';
        const [{ data: hostProf }, { data: eRow }] = await Promise.all([
            ctx.enquiry.host_id
                ? admin.from('profiles').select('full_name, preferred_name, show_full_name, avatar_url').eq('id', ctx.enquiry.host_id).maybeSingle()
                : Promise.resolve({ data: null }),
            admin.from('service_enquiries').select('host_phone').eq('id', params.enquiryId).maybeSingle(),
        ]);
        const hostName = hostProf ? displayName(hostProf, ctx.enquiry.host_name || 'The owner') : (ctx.enquiry.host_name || 'The owner');
        const hostFirst = String(hostName).trim().split(' ')[0] || 'the owner';
        const hostAvatar = (hostProf && hostProf.avatar_url) ? getImageUrl(String(hostProf.avatar_url)) : null;
        const business = String((ctx.provider && ctx.provider.business_name) || ctx.enquiry.business_name || 'The tradesman');

        const statusPill = accepted ? { label: 'Accepted', tone: 'ok' }
            : needsReply ? (ctx.isHost ? { label: 'Sent', tone: 'wait' } : { label: 'New request', tone: 'wait' })
                : status === 'cancelled' ? { label: 'Cancelled', tone: 'over' }
                    : status === 'declined' ? { label: 'Declined', tone: 'over' }
                        : { label: String(status), tone: 'over' };

        const moneyNote = ctx.isHost
            ? 'Agreed and paid directly — this job isn’t billed through Galloway Getaways.'
            : needsReply
                ? 'A request to answer — reply to the owner, then agree the price and take payment directly.'
                : 'Agree the price and take payment directly — this job isn’t billed through Galloway Getaways.';

        const reservation = {
            reference: ctx.enquiry.reference,
            avatarUrl: ctx.isHost ? null : hostAvatar,
            initial: (ctx.isHost ? business : hostFirst).slice(0, 1).toUpperCase(),
            photoUrl: cottageImage,
            heading: ctx.isHost ? business : hostName,
            whenLabel: requestedWhen(ctx.enquiry) || 'A date still to agree',
            itemName: ctx.enquiry.summary || 'Job',
            status: statusPill,
            whenHeading: 'Asked for',
            where: cottage || 'the property',
            note: null,
            allergy: null,
            money: null,
            moneyNote,
            phone: (!ctx.isHost && accepted && eRow && eRow.host_phone) ? eRow.host_phone : null,
            personFirst: ctx.isHost ? business.split(' ')[0] : hostFirst,
        };

        return NextResponse.json({
            ok: true,
            viewerId: uid,
            other: { id: ctx.otherId, name: ctx.otherName },
            context: {
                reference: ctx.enquiry.reference,
                status: ctx.enquiry.status,
                trade: tradeLabel(ctx.enquiry.trade),
                summary: ctx.enquiry.summary,
                item: ctx.enquiry.summary,
                askedFor: requestedWhen(ctx.enquiry),
                cottage,
                cancelled: ctx.enquiry.status === 'cancelled'
                    ? { by: ctx.enquiry.cancelled_by, reason: ctx.enquiry.cancel_reason }
                    : null,
                reservation,
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
                            'You are receiving this because you have a job thread on Galloway Getaways. Reference ' + escapeHtml(String(ctx.enquiry.reference)) + '.',
                            undefined, NEUTRAL_SUBTITLE
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
