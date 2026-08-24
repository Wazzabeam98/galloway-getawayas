import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { reviewDigest } from '@/lib/serviceProviders';

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
        const hide = body.hide === true;

        // Four decisions, not two. An application is approved or declined;
        // a live provider's edits are accepted or turned down. They are named
        // separately rather than inferred from the row, so a click made
        // against a stale screen is refused instead of doing the other thing.
        const DECISIONS = ['approve', 'decline', 'approve_changes', 'decline_changes'];

        if (!id || DECISIONS.indexOf(decision) === -1) {
            return NextResponse.json({ ok: false, error: 'Nothing to decide.' }, { status: 400 });
        }

        const declining = decision === 'decline' || decision === 'decline_changes';

        if (declining && !note) {
            return NextResponse.json(
                { ok: false, error: 'A decline needs a reason — it is sent to them.' },
                { status: 400 }
            );
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, contact_email, status, approved_digest, changes_pending_at, trade, description, audience, photos')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'That business no longer exists.' }, { status: 404 });
        }

        const decidingChanges = decision === 'approve_changes' || decision === 'decline_changes';

        // A decision has to match the state it was made against. Without this,
        // a second click on a slow connection would decide twice and send two
        // emails — and approving an application from a screen that has since
        // gone live would clear the wrong thing.
        const expected = decidingChanges ? 'approved' : 'pending_review';

        if (provider.status !== expected) {
            return NextResponse.json(
                { ok: false, error: 'That has already been decided.' },
                { status: 409 }
            );
        }

        if (decidingChanges && !provider.changes_pending_at) {
            return NextResponse.json(
                { ok: false, error: 'There are no changes waiting on that one.' },
                { status: 409 }
            );
        }

        const now = new Date().toISOString();

        // The digest is stamped from the row as it stands, which is what has
        // just been looked at. It is written here and nowhere else — that is
        // what stops a provider deciding for themselves that their own edits
        // need no review.
        const digest = reviewDigest(provider);

        let patch: any;

        if (decision === 'approve') {
            patch = {
                status: 'approved', approved_at: now, declined_at: null, review_note: null,
                approved_digest: digest, changes_pending_at: null, updated_at: now,
            };
        } else if (decision === 'decline') {
            patch = { status: 'declined', declined_at: now, review_note: note, updated_at: now };
        } else if (decision === 'approve_changes') {
            // Still live, still approved — the edits were already on the site.
            // All that changes is that they have now been seen.
            patch = { approved_digest: digest, changes_pending_at: null, review_note: null, updated_at: now };
        } else {
            // Turned down. Hiding is a separate choice: some edits are worth a
            // word and some cannot stay up. The digest still moves, because
            // this version has been looked at and should not come back round.
            patch = {
                review_note: note, changes_pending_at: null, approved_digest: digest, updated_at: now,
            };
            if (hide) patch.status = 'hidden';
        }

        const { error: writeError } = await admin
            .from('service_providers')
            .update(patch)
            .eq('id', id)
            // Decided from the state it was read in, checked again at the
            // write. Two admins clicking at once otherwise both succeed.
            .eq('status', expected);

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

                const FOOT = 'You are receiving this because you listed a business on Galloway Getaways.';

                let subject: string;
                let html: string;

                if (decision === 'approve') {
                    subject = 'You are listed on Galloway Getaways';
                    html = emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Good news — <strong>' + name
                            + '</strong> has been approved and is now on the site.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">People looking for your trade in the areas you cover can now find you. We will email you whenever somebody asks for work.</p>'
                            + button(SITE_URL + '/services/join', 'See your listing'),
                        FOOT
                    );
                } else if (decision === 'decline') {
                    subject = 'About your Galloway Getaways listing';
                    html = emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Thanks for sending in <strong>' + name
                            + '</strong>. We are not able to list it as it stands.</p>'
                            + quoted(note)
                            + '<p style="margin:0 0 16px;font-size:16px;">You can change it and send it back to us whenever you like.</p>'
                            + button(SITE_URL + '/services/join', 'Update your details'),
                        FOOT
                    );
                } else if (decision === 'approve_changes') {
                    // They were told we would look and come back to them, so
                    // we do — even though nothing visible changes, because a
                    // promise that quietly expires is worse than no promise.
                    subject = 'Your changes have been checked';
                    html = emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">We have looked at the changes you made to <strong>'
                            + name + '</strong>. Nothing needs doing — you stayed on the site throughout.</p>'
                            + button(SITE_URL + '/services/join', 'See your listing'),
                        FOOT
                    );
                } else {
                    subject = 'About the changes to your listing';
                    html = emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">We have looked at the changes you made to <strong>'
                            + name + '</strong>, and we are not able to leave them as they are.</p>'
                            + quoted(note)
                            + '<p style="margin:0 0 16px;font-size:16px;">'
                            + (hide
                                ? 'Your listing is hidden for now. Change it and send it back to us, and we will put it straight back up.'
                                : 'Your listing is still up. Change it whenever you can and we will take another look.')
                            + '</p>'
                            + button(SITE_URL + '/services/join', 'Update your details'),
                        FOOT
                    );
                }

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
