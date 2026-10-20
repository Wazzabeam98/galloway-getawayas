// Turning down a co-host invitation, from the banner or the menu. Only the
// person it was sent to (their sign-in address, as for accepting); the owner is
// told by email, and the email carries its push.

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { inviteByToken } from '@/lib/cohostTargets';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    let body: any = null;
    try { body = await request.json(); } catch { /* checked below */ }
    const token = body && typeof body.token === 'string' ? body.token : '';
    if (!token) return NextResponse.json({ ok: false, error: 'Missing invitation' }, { status: 400 });

    const admin: any = adminClient();
    // A holiday let's invitation or a business's (lib/cohostTargets).
    const found = await inviteByToken(admin, token, 'id, email, status, invited_by');
    const target = found && found.target;
    const invite = found && found.invite;
    if (!invite || invite.status !== 'invited') {
        return NextResponse.json({ ok: false, error: 'That invitation is no longer open.' }, { status: 404 });
    }
    if ((user.email || '').toLowerCase() !== String(invite.email || '').toLowerCase()) {
        return NextResponse.json({ ok: false, error: 'That invitation was sent to a different address.' }, { status: 403 });
    }

    const { error } = await admin.from(target!.table).update({ status: 'revoked' }).eq('id', invite.id).eq('status', 'invited');
    if (error) {
        await logError('listing-access/decline: could not decline an invitation', error, { path: 'api/listing-access/decline', userId: user.id });
        return NextResponse.json({ ok: false, error: 'Could not decline that. Please try again.' }, { status: 500 });
    }

    try {
        if (invite.invited_by) {
            const [{ data: owner }, { data: listing }, { data: me }] = await Promise.all([
                admin.auth.admin.getUserById(invite.invited_by),
                admin.from(target!.parent).select(target!.titleCol).eq('id', invite.parent_id).maybeSingle(),
                admin.from('profiles').select('first_name, preferred_name').eq('id', user.id).maybeSingle(),
            ]);
            const to = (owner && owner.user && owner.user.email) || '';
            const who = ((me && (me.preferred_name || me.first_name)) || 'They').trim();
            if (to) {
                await sendEmail(to, who + ' declined your co-host invitation', emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(who) + '</strong> has declined your invitation to help with <strong>'
                        + escapeHtml((listing && (listing as any)[target!.titleCol]) || 'your ' + target!.noun) + '</strong>.</p>'
                        + button(SITE_URL + target!.peopleUrl, 'Manage co-hosts'),
                    target!.footer));
            }
        }
    } catch (err) {
        await logError('listing-access/decline: the owner could not be told', err, { path: 'api/listing-access/decline', userId: user.id });
    }
    return NextResponse.json({ ok: true });
}
