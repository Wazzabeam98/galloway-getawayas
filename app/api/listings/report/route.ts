import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { signedInCaller } from '@/lib/signedInCaller';
import { displayName } from '@/lib/utils';
import { validateReport, reasonLabel } from '@/lib/listingReports';
import { sendEmailToAll, recipients, emailLayout, button, escapeHtml, detailRows, SITE_URL, NEUTRAL_SUBTITLE } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A guest — or a signed-out visitor, who can see listings and so can report one
// — tells us something is wrong with a listing. Mirrors Airbnb's report flow:
// a reason from a fixed list, then a line of detail.
//
// MINIMAL by design, like /api/bookings/dispute: it records the report and
// emails the directors so a person looks. It opens no case, charges nothing and
// touches no booking. The report is NOT shared with the host — the guest is
// told so in the modal, and the only readers are the service-role admin queue
// and this route.
//
// Not gated on sign-in: the report is allowed anonymously. The insert and the
// alert both go through the service role because listing_reports has no browser
// grant (RLS wall) — the browser could not write it even signed in.

export async function POST(request: Request) {
    let listingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        listingId = String((body && body.listingId) || '');

        // One shared check, the same one the modal runs (lib/listingReports).
        const valid = validateReport({ reason: body && body.reason, details: body && body.details });
        if (!valid.ok) return NextResponse.json({ ok: false, error: valid.error }, { status: 400 });
        if (!listingId) return NextResponse.json({ ok: false, error: 'Which listing?' }, { status: 400 });

        // Null when not signed in — a signed-out visitor may report.
        const caller = await signedInCaller();

        const admin = adminClient();

        // The listing must exist. Fetch its title server-side for the email and
        // the record check — never trust a title the client sent.
        const { data: listing } = await admin
            .from('listings')
            .select('id, title')
            .eq('id', listingId)
            .maybeSingle();
        if (!listing) return NextResponse.json({ ok: false, error: 'No such listing.' }, { status: 404 });

        const { error: insertError } = await admin.from('listing_reports').insert({
            listing_id: listing.id,
            reporter_id: caller ? caller.id : null,
            reason: valid.reason,
            details: valid.details,
        });
        if (insertError) {
            await logError('[listings/report] could not record a listing report', {
                listingId: listing.id, reason: valid.reason, message: insertError.message,
            }, { path: 'listings/report' });
            return NextResponse.json({ ok: false, error: 'We couldn’t record your report just now. Please email hello@gallowaygetaways.co.uk.' }, { status: 500 });
        }

        // Who reported it, for the email. Signed-in: their name. Signed-out: say so.
        let reporterName = 'A signed-out visitor';
        if (caller) {
            const { data: profile } = await admin
                .from('profile_private')
                .select('full_name, preferred_name, show_full_name, email')
                .eq('id', caller.id)
                .maybeSingle();
            reporterName = displayName(profile, 'A signed-in guest');
        }

        // Email the directors the same way a chargeback does. Reports can be
        // split off to their own inbox later by setting REPORTS_ALERT_EMAIL;
        // until then they land in the directors' alert alias, DISPUTES_ALERT_EMAIL.
        const to = recipients(process.env.REPORTS_ALERT_EMAIL || process.env.DISPUTES_ALERT_EMAIL);
        if (!to.length) {
            // The report is already saved; it is not lost, it just wasn't
            // emailed. Record that and still tell the reporter it went through.
            await logError('[listings/report] no REPORTS_ALERT_EMAIL/DISPUTES_ALERT_EMAIL set — a listing report was saved but nobody was emailed', {
                listingId: listing.id, reason: valid.reason,
            }, { path: 'listings/report' });
            return NextResponse.json({ ok: true });
        }

        const where = listing.title || listing.id;
        const heading = 'Listing reported — ' + where;
        const { sent, failed } = await sendEmailToAll(
            to,
            heading,
            emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + escapeHtml(heading) + '</h1>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(reporterName)
                    + ' reported a listing.</p>'
                    + detailRows([
                        { label: 'Property', value: escapeHtml(String(where)) },
                        { label: 'Reason', value: escapeHtml(reasonLabel(valid.reason)) },
                        { label: 'Reported by', value: escapeHtml(reporterName) },
                    ])
                    + '<p style="margin:16px 0 8px;font-size:16px;"><strong>What they said:</strong></p>'
                    + '<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">' + escapeHtml(valid.details) + '</p>'
                    + button(SITE_URL + '/admin/listing-reports', 'Open the reports queue'),
                'You are receiving this because you are a director of Galloway Getaways.',
                undefined,
                NEUTRAL_SUBTITLE
            )
        );

        if (failed.length) {
            await logError('[listings/report] a report alert did not send', {
                listingId: listing.id, failed: failed.join(', '), reached: sent.join(', '),
            }, { path: 'listings/report' });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[listings/report] ' + ((err && err.message) || 'failed'), { listingId, message: String(err && err.message) }, { path: 'listings/report' });
        return NextResponse.json({ ok: false, error: 'Could not send your report.' }, { status: 500 });
    }
}
