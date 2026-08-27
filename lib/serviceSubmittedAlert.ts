// Telling us a business is waiting.
//
// Lifted out of app/api/services/submitted/route.ts so that two callers can
// share one implementation:
//
//   /api/services/submitted   a signed-in provider who has edited or re-sent
//                             an existing listing, and calls it themselves
//   /api/services/apply       a first application, which arrives before there
//                             is any session to authenticate — the applicant
//                             has only just been created
//
// The auth belongs to the callers, not here: this function assumes whoever
// called it has already decided they are allowed to. It is never reached from
// the browser directly.

import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, detailRows, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import {
    tradeLabel,
    audienceLabel,
    hasUnreviewedChanges,
    changedFields,
    fieldLabel,
    REVIEW_WITHIN_HOURS,
    schemeLabel,
    registrationVerified,
} from '@/lib/serviceProviders';

export interface AnnounceResult {
    ok: boolean;
    emailed: boolean;
    skipped?: string;
}

export async function announceSubmission(provider: any): Promise<AnnounceResult> {
    const admin = adminClient();
    const id = String(provider.id);

    // Two things are worth announcing, and they are different jobs.
    //
    //   waiting   an application, new or sent back after a decline
    //   changed   somebody already live has edited their shop window
    //
    // A save that did not submit leaves a draft, and a live provider who
    // only fixed their phone number has changed nothing anybody needs to
    // look at. Neither rings the bell.
    const waiting = provider.status === 'pending_review';
    const changed = hasUnreviewedChanges(provider);

    if (!waiting && !changed) {
        return { ok: true, emailed: false, skipped: 'nothing to look at' };
    }

    // Stamped server-side, so the queue has a time to sort by. It is only
    // a convenience: the queue works out what has changed from the digest,
    // which a provider cannot write, so declining to call this route wins
    // nobody anything.
    if (changed && !provider.changes_pending_at) {
        await admin
            .from('service_providers')
            .update({ changes_pending_at: new Date().toISOString() })
            .eq('id', id)
            .eq('status', 'approved');
    }

    const { data: areas } = await admin
        .from('service_areas')
        .select('label, radius_miles')
        .eq('provider_id', id);

    // Named in the alert so the job is obvious from the phone: an
    // application with a Gas Safe number to look up is a different piece
    // of work from one without, and knowing which before opening the site
    // is most of the value of the email.
    const { data: regRows } = await admin
        .from('service_provider_registrations')
        .select('provider_id, scheme, number, verified_at, verified_number, expires_at')
        .eq('provider_id', id);

    const toCheck = (regRows || [])
        .filter((r: any) => !registrationVerified(r))
        .map((r: any) => schemeLabel(String(r.scheme || '')) + ' ' + String(r.number || ''));

    const covers = (areas || []).length
        ? (areas || []).map((a: any) => escapeHtml(a.label) + ' + ' + Number(a.radius_miles) + ' miles').join('<br>')
        : '<span style="color:#b91c1c;">nowhere</span>';

    // A re-submission after a decline is a new submission: it is exactly
    // the moment somebody has fixed what we asked for and is waiting on us
    // again. `declined_at` is not cleared when they send it back, so a
    // pending row that carries one has been round before.
    const again = waiting && !!provider.declined_at;

    const name = escapeHtml(provider.business_name || 'A business');

    const to = process.env.SERVICES_ALERT_EMAIL || '';

    // A missing address is the failure this whole route exists to avoid,
    // so it is recorded before anything else can swallow it.
    if (!to) {
        await logError('service-provider-submitted-email', {
            provider: id,
            problem: 'SERVICES_ALERT_EMAIL is not set — nobody was told.',
        });
        return { ok: true, emailed: false };
    }

    // Naming the fields, because "they changed something" sends you to the
    // site to find out and "they changed the description" does not.
    const edits = changed
        ? changedFields(provider).map(fieldLabel).join(', ')
        : '';

    const subject = changed
        ? 'Changes to look at: ' + (provider.business_name || 'a business')
        : (again ? 'Sent back for review: ' : 'New business waiting: ')
            + (provider.business_name || 'a business');

    const opening = changed
        ? '<p style="margin:0 0 16px;font-size:16px;"><strong>' + name + '</strong> is live and has changed '
            + escapeHtml(edits || 'something') + '. They have stayed on the site — this is only for you to look at.</p>'
        : '<p style="margin:0 0 16px;font-size:16px;"><strong>' + name + '</strong> '
            + (again
                ? 'has changed what you asked about and sent it back.'
                : 'has applied to be listed.')
            + ' You said you would decide within ' + REVIEW_WITHIN_HOURS + ' hours.</p>';

    const emailed = await sendEmail(
        to,
        subject,
        emailLayout(
            opening
                + detailRows([
                    { label: 'Category', value: escapeHtml(tradeLabel(String(provider.trade || ''))) },
                    { label: 'Sells to', value: escapeHtml(audienceLabel(String(provider.audience || ''))) },
                    { label: 'Covers', value: covers },
                    { label: 'Contact', value: escapeHtml(provider.contact_email || '—') },
                ].concat(
                    toCheck.length
                        ? [{
                            label: 'To check first',
                            value: '<strong>' + escapeHtml(toCheck.join(', ')) + '</strong>',
                        }]
                        : []
                ))
                + button(SITE_URL + '/admin/providers', changed ? 'Review the changes' : 'Review application'),
            'You are receiving this because you review businesses on Galloway Getaways.'
        )
    );

    if (!emailed) {
        await logError('service-provider-submitted-email', {
            provider: id,
            to: to,
            kind: changed ? 'changes' : (again ? 'resubmission' : 'new'),
        });
    }

    return { ok: true, emailed: emailed };
}
