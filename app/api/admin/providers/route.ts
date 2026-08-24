import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The reason, set apart from our own words.
//
// It used to be a plain paragraph in the same size and colour as the two
// sentences either side of it, so a short reason — "no" is a real one somebody
// typed — read as part of our sentence rather than as a quote of ours. Indented
// behind a rule, it is obviously the thing we said.
//
// Newlines survive as <br>: HTML collapses them, so a reason typed over three
// lines otherwise arrives as one. Escaped first, so the <br> we add is the only
// markup that gets through.
function quoted(note: string): string {
    const body = escapeHtml(note).split('\n').join('<br>');

    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">'
        + '<tr><td style="border-left:4px solid #e5e7eb;padding:2px 0 2px 16px;">'
        + '<p style="margin:0;font-size:16px;color:#374151;">' + body + '</p>'
        + '</td></tr></table>';
}


// Approving or declining a business application.
//
// A route rather than a write from the browser, for two reasons: the decision
// has to be checked against `is_admin` on the server, and approving sends an
// email. Neither belongs in a client component.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be an admin by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const admin = adminClient();

        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', auth.user.id)
            .maybeSingle();

        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
        }

        const body = await req.json();
        const id = String(body.id || '');
        const decision = String(body.decision || '');
        const note = String(body.note || '').trim();

        if (!id || (decision !== 'approve' && decision !== 'decline')) {
            return NextResponse.json({ ok: false, error: 'Nothing to decide.' }, { status: 400 });
        }

        if (decision === 'decline' && !note) {
            return NextResponse.json(
                { ok: false, error: 'A decline needs a reason — it is sent to them.' },
                { status: 400 }
            );
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, contact_email, status')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'That business no longer exists.' }, { status: 404 });
        }

        // Only something actually waiting can be decided. Without this, a
        // second click on a slow connection would re-approve and send a second
        // email.
        if (provider.status !== 'pending_review') {
            return NextResponse.json(
                { ok: false, error: 'That has already been decided.' },
                { status: 409 }
            );
        }

        const now = new Date().toISOString();

        const patch = decision === 'approve'
            ? { status: 'approved', approved_at: now, declined_at: null, review_note: null, updated_at: now }
            : { status: 'declined', declined_at: now, review_note: note, updated_at: now };

        const { error: writeError } = await admin
            .from('service_providers')
            .update(patch)
            .eq('id', id)
            // Decided from the waiting state only, checked again at the write.
            // Two admins clicking at once otherwise both succeed.
            .eq('status', 'pending_review');

        if (writeError) {
            return NextResponse.json({ ok: false, error: writeError.message }, { status: 500 });
        }

        // The decision is saved by this point. An email that fails must not
        // undo it — but it must not be passed off as having gone, either. The
        // whole point of the decision is that the business hears about it.
        //
        // sendEmail returns false rather than throwing, so the try/catch below
        // catches nothing on the ordinary failure path: no API key, a refusal
        // from Resend, a dead network. Those come back as `false` and have to
        // be read.
        let emailed = false;

        try {
            if (provider.contact_email) {
                const name = escapeHtml(provider.business_name || 'your business');

                const subject = decision === 'approve'
                    ? 'You are listed on Galloway Getaways'
                    : 'About your Galloway Getaways listing';

                const html = decision === 'approve'
                    ? emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Good news — <strong>' + name
                            + '</strong> has been approved and is now on the site.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">People looking for your trade in the areas you cover can now find you. We will email you whenever somebody asks for work.</p>'
                            + button(SITE_URL + '/services/join', 'See your listing'),
                        'You are receiving this because you listed a business on Galloway Getaways.'
                    )
                    : emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Thanks for sending in <strong>' + name
                            + '</strong>. We are not able to list it as it stands.</p>'
                            + quoted(note)
                            + '<p style="margin:0 0 16px;font-size:16px;">You can change it and send it back to us whenever you like.</p>'
                            + button(SITE_URL + '/services/join', 'Update your details'),
                        'You are receiving this because you listed a business on Galloway Getaways.'
                    );

                emailed = await sendEmail(provider.contact_email, subject, html);
            }
        } catch (mailErr: any) {
            emailed = false;
        }

        if (!emailed) {
            await logError('service-provider-decision-email', {
                provider: id,
                decision: decision,
                to: provider.contact_email || null,
            });
        }

        // The decision stands either way, so this is not an error status. The
        // screen decides what to say about `emailed`.
        return NextResponse.json({ ok: true, emailed: emailed });
    } catch (err: any) {
        await logError('service-provider-decision', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
