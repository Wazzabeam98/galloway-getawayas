import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, escapeHtml } from '@/lib/email';
import { firstName } from '@/lib/utils';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A guest's pre-booking question to an experience provider — the "Message the
// provider" path for a range or price-on-enquiry offering, which has no settled
// price to book. It writes one experience_enquiries row and emails the provider
// straight away with the guest's first name and message, so nothing sits
// unanswered. No money: this is a question, not an order.
//
// Signed-in only (an enquiry has to belong to a real account so the provider can
// reply through it); the client prompts sign-in on a 401. The provider must be an
// approved guest experience, and the item must be one of theirs.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): the signature is checked, so guest_id is
        // the real account and not whatever a cookie claimed.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Please sign in to message the provider.' }, { status: 401 });
        }
        const guestId = auth.user.id;

        const body = await req.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const itemId = body.itemId ? String(body.itemId) : null;
        const message = String(body.message || '').trim();

        if (!providerId) return NextResponse.json({ ok: false, error: 'Missing provider.' }, { status: 400 });
        if (message.length < 1) return NextResponse.json({ ok: false, error: 'Write a short message first.' }, { status: 400 });
        if (message.length > 2000) return NextResponse.json({ ok: false, error: 'That message is too long.' }, { status: 400 });

        const admin = adminClient();

        // The provider must be a live guest experience. Read with the service key
        // (an approved provider's row is public, but the contact email is not).
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, contact_email, audience, status')
            .eq('id', providerId)
            .maybeSingle();
        if (!provider || provider.audience !== 'guest' || provider.status !== 'approved') {
            return NextResponse.json({ ok: false, error: 'That experience isn’t available.' }, { status: 400 });
        }

        // The offering, snapshotted by name so the enquiry still reads right if it
        // is later edited or removed. Must belong to this provider.
        let itemName: string | null = null;
        let safeItemId: string | null = null;
        if (itemId) {
            const { data: item } = await admin
                .from('service_provider_items')
                .select('id, name, provider_id')
                .eq('id', itemId)
                .maybeSingle();
            if (item && item.provider_id === providerId) {
                itemName = item.name;
                safeItemId = item.id;
            }
        }

        const { error: insErr } = await admin
            .from('experience_enquiries')
            .insert({
                provider_id: providerId,
                guest_id: guestId,
                item_id: safeItemId,
                item_name: itemName,
                message,
            });
        if (insErr) {
            await logError('experience-enquiry-insert', insErr);
            return NextResponse.json({ ok: false, error: 'That couldn’t be sent — try again.' }, { status: 500 });
        }

        // Tell the provider straight away. The guest's first name only (the site's
        // rule), so they know who is asking. sendEmail refuses reserved test TLDs
        // centrally, so a seed provider's @….test address simply isn't emailed —
        // the row is still written and visible.
        try {
            const { data: guestProfile } = await admin
                .from('profiles')
                .select('full_name, preferred_name')
                .eq('id', guestId)
                .maybeSingle();
            const guestFirst = firstName(guestProfile, 'A guest');
            const to = (provider.contact_email || '').trim();
            if (to) {
                const aboutLine = itemName
                    ? `about <strong>${escapeHtml(itemName)}</strong>`
                    : 'about your experience';
                await sendEmail(
                    to,
                    `New enquiry from ${guestFirst}`,
                    `<p>${escapeHtml(guestFirst)} has sent you a question ${aboutLine} on Galloway Getaways.</p>`
                    + `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #047857;color:#334155;">${escapeHtml(message).replace(/\n/g, '<br/>')}</blockquote>`
                    + `<p>Reply to agree a price. You can see your enquiries in your provider dashboard.</p>`,
                );
            }
        } catch (mailErr) {
            // A written enquiry that the email failed to leave on is still a real
            // enquiry — the provider sees it in their dashboard, and admin sees it.
            await logError('experience-enquiry-email', mailErr);
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        await logError('experience-enquiry', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
