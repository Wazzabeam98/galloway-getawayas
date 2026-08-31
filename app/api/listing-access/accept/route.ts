import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const token: string = body && body.token;

        if (!token) {
            return NextResponse.json({ ok: false, error: 'Missing invitation' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: invite } = await admin
            .from('listing_access')
            .select('id, listing_id, email, role, status, invited_by')
            .eq('invite_token', token)
            .maybeSingle();

        if (!invite || invite.status === 'revoked') {
            return NextResponse.json(
                { ok: false, error: 'That invitation is no longer valid.' },
                { status: 404 }
            );
        }

        // The invitation is to a person, not to whoever happens to open the
        // link. Otherwise a forwarded email would hand over access.
        const signedInEmail = (user.email || '').toLowerCase();

        if (signedInEmail !== (invite.email || '').toLowerCase()) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'This invitation was sent to ' + invite.email + '. Sign in with that address to accept it.',
                },
                { status: 403 }
            );
        }

        if (invite.status === 'active') {
            return NextResponse.json({ ok: true, already: true });
        }

        await admin
            .from('listing_access')
            .update({
                user_id: user.id,
                status: 'active',
                accepted_at: new Date().toISOString(),
            })
            .eq('id', invite.id);

        // Tell the owner, so nobody quietly gains access unnoticed.
        if (invite.invited_by) {
            const { data: owner } = await admin.auth.admin.getUserById(invite.invited_by);
            const ownerEmail = (owner && owner.user && owner.user.email) || '';

            const { data: listing } = await admin
                .from('listings')
                .select('title')
                .eq('id', invite.listing_id)
                .maybeSingle();

            if (ownerEmail) {
                await sendEmail(
                    ownerEmail,
                    invite.email + ' has accepted your invitation',
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;"><strong>'
                            + escapeHtml(invite.email)
                            + '</strong> now has access to <strong>'
                            + escapeHtml((listing && listing.title) || 'your property')
                            + '</strong> as '
                            + (invite.role === 'staff' ? 'staff' : 'a co-host')
                            + '.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">You can change what they can do, or remove them, at any time.</p>'
                            + button(SITE_URL + '/dashboard/people', 'Manage co-hosts'),
                        'You\u2019re receiving this because you host on Galloway Getaways.'
                    )
                );
            }
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[listing-access/accept]', err && err.message);

        // The console is nobody's alarm. The invitation looks live to both of them and grants nothing.
        await logError('listing-access/accept: a co-host invitation could not be accepted', err, {
            path: 'api/listing-access/accept',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not accept the invitation' },
            { status: 500 }
        );
    }
}
