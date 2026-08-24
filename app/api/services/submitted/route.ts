import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, detailRows, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { tradeLabel, audienceLabel, REVIEW_WITHIN_HOURS } from '@/lib/serviceProviders';

export const dynamic = 'force-dynamic';

// Telling us a business is waiting.
//
// The sign-up writes itself straight from the browser, so there is no server
// step in a submission to hang this off — hence a route the page calls once
// the row and its areas are saved. Same shape as /api/notify.
//
// Where it goes is an environment variable, not a constant: the address can
// change without a deploy, and a missing one is loud rather than silent.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be anyone by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const body = await req.json();
        const id = String(body.id || '');
        if (!id) {
            return NextResponse.json({ ok: false, error: 'Nothing to announce.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, trade, audience, contact_email, contact_phone, status, declined_at')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such business.' }, { status: 404 });
        }

        // Their own row only. Without this, a signed-in stranger could make us
        // email ourselves about somebody else's application.
        if (provider.owner_id !== auth.user.id) {
            return NextResponse.json({ ok: false, error: 'Not yours.' }, { status: 403 });
        }

        // Only something actually waiting is worth announcing. A save that did
        // not submit leaves the row as a draft and must not ring the bell.
        if (provider.status !== 'pending_review') {
            return NextResponse.json({ ok: true, emailed: false, skipped: 'not waiting' });
        }

        const { data: areas } = await admin
            .from('service_areas')
            .select('label, radius_miles')
            .eq('provider_id', id);

        const covers = (areas || []).length
            ? (areas || []).map((a: any) => escapeHtml(a.label) + ' + ' + Number(a.radius_miles) + ' miles').join('<br>')
            : '<span style="color:#b91c1c;">nowhere</span>';

        // A re-submission after a decline is a new submission: it is exactly
        // the moment somebody has fixed what we asked for and is waiting on us
        // again. `declined_at` is not cleared when they send it back, so a
        // pending row that carries one has been round before.
        const again = !!provider.declined_at;

        const name = escapeHtml(provider.business_name || 'A business');

        const to = process.env.SERVICES_ALERT_EMAIL || '';

        // A missing address is the failure this whole route exists to avoid,
        // so it is recorded before anything else can swallow it.
        if (!to) {
            await logError('service-provider-submitted-email', {
                provider: id,
                problem: 'SERVICES_ALERT_EMAIL is not set — nobody was told.',
            });
            return NextResponse.json({ ok: true, emailed: false });
        }

        const emailed = await sendEmail(
            to,
            (again ? 'Sent back for review: ' : 'New business waiting: ') + (provider.business_name || 'a business'),
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;"><strong>' + name + '</strong> '
                    + (again
                        ? 'has changed what you asked about and sent it back.'
                        : 'has applied to be listed.')
                    + ' You said you would decide within ' + REVIEW_WITHIN_HOURS + ' hours.</p>'
                    + detailRows([
                        { label: 'Category', value: escapeHtml(tradeLabel(String(provider.trade || ''))) },
                        { label: 'Sells to', value: escapeHtml(audienceLabel(String(provider.audience || ''))) },
                        { label: 'Covers', value: covers },
                        { label: 'Contact', value: escapeHtml(provider.contact_email || '—') },
                    ])
                    + button(SITE_URL + '/admin/providers', 'Open the queue'),
                'You are receiving this because you review businesses on Galloway Getaways.'
            )
        );

        if (!emailed) {
            await logError('service-provider-submitted-email', {
                provider: id,
                to: to,
                resubmission: again,
            });
        }

        return NextResponse.json({ ok: true, emailed: emailed });
    } catch (err: any) {
        await logError('service-provider-submitted', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
