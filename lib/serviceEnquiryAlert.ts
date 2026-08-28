// Telling everybody an enquiry happened.
//
// Four different emails, one file, because they share a vocabulary and drift
// the moment they do not: what the tradesman is told he is being asked, what
// the host is told he was told, and what we are told went out.
//
//   toProvider   the job, and two buttons that answer without signing in
//   toAdmins     a copy, to both of us
//   toHost       a receipt naming who it went to and by when
//   response     what happened, and the contact details if it was a yes
//
// The auth belongs to the callers. Nothing in here decides whether the person
// asking was allowed to ask; it is never reached from the browser directly.
//
// WHY THE TRADESMAN'S EMAIL CARRIES A TOKEN
//
// He has nowhere to sign in. `service_providers` is written by the sign-up and
// read by the admin queue, and there is no provider-facing page on the site at
// all — so an emailed link that works on its own is not a convenience here, it
// is the entire mechanism. He is also, quite often, up a ladder.
//
// THE FORWARDED-EMAIL PROBLEM, AND WHY ACCEPTING IS STILL SAFE
//
// A token in an inbox is a token anybody that inbox is forwarded to can press.
// So pressing it does not show the host's details in the browser. It flips the
// status and sends the details to the provider's REGISTERED contact address —
// the one we approved him on. Whoever clicked sees only "thanks, we have sent
// it on". A forwarded link can therefore make a nuisance of itself by
// answering on his behalf; it cannot harvest a host's phone number.

import { adminClient } from '@/lib/supabaseAdmin';
import { isAutomatedTestAddress } from '@/lib/testAddresses';
import {
    sendEmail,
    sendEmailToAll,
    recipients,
    emailLayout,
    escapeHtml,
    detailRows,
    button,
    SITE_URL,
} from '@/lib/email';
import { logError } from '@/lib/logError';
import { tradeLabel } from '@/lib/serviceProviders';
import {
    faultLabels,
    snapshotLine,
    urgencyLabel,
    isEmergency,
    hostStatusSummary,
    requestedWhen,
    clockTime,
    EMERGENCY_MINUTES,
} from '@/lib/serviceEnquiries';

export interface AlertResult {
    ok: boolean;
    provider: boolean;
    host: boolean;
    admins: string[];
    skipped?: string;
}

function hoursUntil(expiresAt: string | null | undefined): string {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - Date.now();
    const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
    return hours >= 48 ? Math.round(hours / 24) + ' days' : hours + ' hours';
}

// The job, said the same way in all four emails.
function jobRows(enquiry: any, listing: any): Array<{ label: string; value: string }> {
    const faults = faultLabels(enquiry.fault_keys);
    const price = snapshotLine(enquiry.price_snapshot);

    const rows: Array<{ label: string; value: string }> = [
        { label: 'Trade', value: escapeHtml(tradeLabel(String(enquiry.trade || ''))) },
        { label: 'Where', value: escapeHtml(String((listing && listing.location) || enquiry.area_key || '—')) },
        { label: 'How urgent', value: escapeHtml(urgencyLabel(String(enquiry.urgency || ''))) },
    ];

    if (faults.length) {
        rows.push({ label: "What's wrong", value: escapeHtml(faults.join(', ')) });
    }
    // "Asked for", never "Booked for". Nothing here knows whether he is free
    // that day and nothing holds the window — see requestedWhen.
    const asked = requestedWhen(enquiry);
    if (asked) rows.push({ label: 'When', value: escapeHtml(asked) });

    if (enquiry.when_note) {
        rows.push({ label: 'When suits', value: escapeHtml(String(enquiry.when_note)) });
    }
    if (price) {
        // His own published figures, quoted back at him. Not a quote and not a
        // total — nothing on this flow computes one.
        rows.push({ label: 'Your published prices', value: escapeHtml(price) });
    }

    return rows;
}

function summaryBlock(enquiry: any): string {
    return (
        '<div style="margin:20px 0;padding:16px 18px;background-color:#f9fafb;'
        + 'border-left:3px solid #047857;border-radius:6px;font-size:15px;line-height:1.6;">'
        + escapeHtml(String(enquiry.summary || ''))
        + '</div>'
    );
}

// ---------------------------------------------------------------------------
// AN ENQUIRY GOING OUT
// ---------------------------------------------------------------------------

export async function announceEnquiry(
    enquiry: any,
    provider: any,
    listing: any,
    replyToken: string
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };

    // A test run must not ring the real bell, and must not email a tradesman
    // who does not exist. Decided on the address, the same as everywhere else.
    if (isAutomatedTestAddress(provider && provider.contact_email)) {
        return { ...result, skipped: 'automated test address' };
    }

    const ref = escapeHtml(String(enquiry.reference || ''));
    const where = String((listing && listing.location) || enquiry.area_key || 'Dumfries & Galloway');
    const trade = tradeLabel(String(enquiry.trade || ''));
    const emergency = isEmergency(String(enquiry.urgency || ''));

    const subject = emergency
        ? 'URGENT — a property owner in ' + where + ' needs you now (' + String(enquiry.reference) + ')'
        : 'New enquiry — ' + trade.toLowerCase() + ', ' + where + ' (' + String(enquiry.reference) + ')';

    // ---- the tradesman ----------------------------------------------------
    if (provider && provider.contact_email) {
        // NO COUNTDOWN AND NO MECHANISM, for him either. Telling a tradesman
        // "answer within twenty minutes or we hand over your number anyway"
        // is telling him that doing nothing has the same outcome as saying
        // yes, which is the opposite of the pressure that is wanted. What is
        // true and useful is that it is urgent and it came only to him.
        const opening = emergency
            ? '<p style="margin:0 0 16px;font-size:16px;">A property owner has an <strong>emergency</strong> '
                + 'and has asked for you. Please answer as quickly as you can — nobody else has been sent '
                + 'this.</p>'
            : '<p style="margin:0 0 16px;font-size:16px;">A property owner has asked for you by name. '
                + 'Nobody else has been sent this — it came to you only.</p>';

        // The same two buttons for an emergency. That is the change: the
        // accept is what says the platform found him the work, and handing the
        // number over without one erases the only evidence of it.
        const afterwards = emergency
            ? 'We will pass your name, number and email to them when you say yes, and not before.'
            : 'We will pass your name, number and email to them when you say yes, and not before. If we hear '
                + 'nothing in ' + escapeHtml(hoursUntil(enquiry.expires_at))
                + ' we will tell them to try somebody else.';

        const actions =
            button(SITE_URL + '/services/enquiry/' + replyToken + '?reply=yes', "Yes, I'll take a look")
            + '<p style="margin:0 0 20px;font-size:14px;">'
            + '<a href="' + SITE_URL + '/services/enquiry/' + replyToken + '?reply=no" '
            + 'style="color:#6b7280;">No, not this one</a></p>'
            + '<p style="margin:0;font-size:14px;color:#6b7280;">' + afterwards + '</p>';

        result.provider = await sendEmail(
            String(provider.contact_email),
            subject,
            emailLayout(
                opening + summaryBlock(enquiry) + detailRows(jobRows(enquiry, listing)) + actions,
                'You are receiving this because you are listed on Galloway Getaways as a '
                + escapeHtml(trade.toLowerCase()) + '. Reference ' + ref + '.'
            )
        );

        if (!result.provider) {
            await logError('service-enquiry-provider-email', {
                enquiry: String(enquiry.id),
                to: String(provider.contact_email),
            });
        }
    }

    // ---- the host ---------------------------------------------------------
    if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
        const name = escapeHtml(String(enquiry.business_name || 'They'));

        const body = emergency
            ? '<p style="margin:0 0 16px;font-size:16px;">Your emergency has gone to <strong>' + name
                + '</strong>, marked urgent, and to nobody else. We will email you the moment they '
                + 'answer.</p>'
            : '<p style="margin:0 0 16px;font-size:16px;">Your enquiry has gone to <strong>' + name
                + '</strong>. We will email you the moment they answer, and if we hear nothing in '
                + escapeHtml(hoursUntil(enquiry.expires_at)) + ' we will tell you so you can try somebody else.</p>'
                + '<p style="margin:0 0 16px;font-size:15px;color:#6b7280;">They have your name and number and '
                + 'nothing else until they say yes.</p>';

        result.host = await sendEmail(
            String(enquiry.host_email),
            'Sent to ' + String(enquiry.business_name || 'a tradesman') + ' (' + String(enquiry.reference) + ')',
            emailLayout(
                body + summaryBlock(enquiry) + detailRows(jobRows(enquiry, listing))
                    + button(SITE_URL + '/dashboard/enquiries', 'See your enquiries'),
                'You are receiving this because you asked a tradesman for help through Galloway Getaways. '
                + 'Reference ' + ref + '.'
            )
        );
    }

    // ---- both of us -------------------------------------------------------
    result.admins = await tellTheAdmins(
        enquiry,
        listing,
        (emergency ? 'EMERGENCY: ' : 'Enquiry: ') + String(enquiry.business_name || 'a business')
            + ' — ' + where + ' (' + String(enquiry.reference) + ')',
        emergency
            ? '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(String(enquiry.host_name || 'A host'))
                + '</strong> has an emergency and has asked <strong>'
                + escapeHtml(String(enquiry.business_name || ''))
                + '</strong>. Their number is released automatically at '
                + escapeHtml(clockTime(enquiry.expires_at)) + ' if he has not answered.</p>'
            : '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(String(enquiry.host_name || 'A host'))
                + '</strong> has asked <strong>' + escapeHtml(String(enquiry.business_name || ''))
                + '</strong> to look at something.</p>'
    );

    return result;
}

// ---------------------------------------------------------------------------
// AN ANSWER COMING BACK
// ---------------------------------------------------------------------------
//
// Accepting is the introduction, and the introduction is the product. Both
// sides get the other's details in the same pair of emails, so neither is left
// waiting on the other to make contact.

export async function announceResponse(
    enquiry: any,
    provider: any,
    listing: any
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const accepted = String(enquiry.status || '') === 'accepted';
    const ref = escapeHtml(String(enquiry.reference || ''));
    const name = escapeHtml(String(enquiry.business_name || 'They'));

    // ---- the host ---------------------------------------------------------
    if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
        const summary = hostStatusSummary(String(enquiry.status || ''), enquiry.business_name);

        const contact = accepted
            ? detailRows([
                { label: 'Business', value: escapeHtml(String(enquiry.business_name || '')) },
                { label: 'Phone', value: escapeHtml(String((provider && provider.contact_phone) || '—')) },
                { label: 'Email', value: escapeHtml(String((provider && provider.contact_email) || '—')) },
            ])
            : '';

        const reply = enquiry.provider_reply
            ? '<p style="margin:16px 0 0;font-size:15px;"><em>' + escapeHtml(String(enquiry.provider_reply))
                + '</em></p>'
            : '';

        const next = accepted
            ? ''
            : button(SITE_URL + '/services/' + String(enquiry.trade || ''), 'See who else covers you');

        result.host = await sendEmail(
            String(enquiry.host_email),
            (accepted ? name.replace(/&#39;/g, "'") + ' can help' : 'No luck with ' + String(enquiry.business_name || 'them'))
                + ' (' + String(enquiry.reference) + ')',
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(summary.detail) + '</p>'
                    + reply + contact + next,
                'You are receiving this because you asked a tradesman for help through Galloway Getaways. '
                + 'Reference ' + ref + '.'
            )
        );
    }

    // ---- the tradesman ----------------------------------------------------
    //
    // Sent to his REGISTERED address, never to whoever pressed the button. The
    // whole forwarded-token defence rests on this line.
    if (accepted && provider && provider.contact_email
        && !isAutomatedTestAddress(provider.contact_email)) {
        result.provider = await sendEmail(
            String(provider.contact_email),
            'Here are their details (' + String(enquiry.reference) + ')',
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">You said yes. Here is how to reach them — '
                    + 'the job and the price are between the two of you, and we take nothing from it.</p>'
                    + detailRows([
                        { label: 'Name', value: escapeHtml(String(enquiry.host_name || '')) },
                        { label: 'Phone', value: escapeHtml(String(enquiry.host_phone || '—')) },
                        { label: 'Email', value: escapeHtml(String(enquiry.host_email || '—')) },
                        {
                            label: 'Property',
                            value: escapeHtml(String((listing && listing.location) || enquiry.area_key || '—')),
                        },
                    ].concat(
                        enquiry.access_note
                            ? [{ label: 'Access', value: escapeHtml(String(enquiry.access_note)) }]
                            : []
                    ))
                    + summaryBlock(enquiry),
                'You are receiving this because you accepted an enquiry on Galloway Getaways. '
                + 'Reference ' + ref + '.'
            )
        );
    }

    result.admins = await tellTheAdmins(
        enquiry,
        listing,
        (accepted ? 'Accepted: ' : 'Declined: ') + String(enquiry.business_name || 'a business')
            + ' (' + String(enquiry.reference) + ')',
        '<p style="margin:0 0 16px;font-size:16px;"><strong>' + name + '</strong> '
            + (accepted ? 'accepted' : 'declined') + ' '
            + escapeHtml(String(enquiry.host_name || 'a host')) + "'s enquiry."
            + (enquiry.decline_reason
                ? ' Reason: ' + escapeHtml(String(enquiry.decline_reason)) + '.'
                : '')
            + '</p>'
    );

    return result;
}

// ---------------------------------------------------------------------------
// NOBODY ANSWERED
// ---------------------------------------------------------------------------
//
// The same silence with two opposite endings. Ordinary work: try somebody
// else. An emergency: here is his number, ring him.
//
// The provider is emailed on a release and NOT on an expiry, which looks
// inconsistent and is not. A release means a stranger is about to ring him
// about a job he never answered — he needs to know why, and what it is. An
// expiry means nothing further happens to him, and a message saying "that
// thing you ignored has stopped mattering" is somebody else's evening.

export async function announceSilence(
    enquiry: any,
    provider: any,
    listing: any,
    outcome: 'released' | 'expired'
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const released = outcome === 'released';
    const name = String(enquiry.business_name || 'them');
    const seen = String(enquiry.status || '') === 'viewed' || !!enquiry.viewed_at;

    // ---- the host ---------------------------------------------------------
    if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
        const body = released
            ? '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(name)
                + ' has not come back to us, and an emergency does not wait. '
                + '<strong>Here is their number — ring them.</strong> We have emailed them so they know what '
                + 'it is about.</p>'
                + detailRows([
                    { label: 'Phone', value: escapeHtml(String((provider && provider.contact_phone) || '—')) },
                    { label: 'Email', value: escapeHtml(String((provider && provider.contact_email) || '—')) },
                ])
                + '<p style="margin:16px 0 0;font-size:15px;color:#6b7280;">If you cannot get hold of them, '
                + 'there are others who cover you.</p>'
                + button(SITE_URL + '/services/' + String(enquiry.trade || ''), 'See who else covers you')
            : '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(name)
                + (seen
                    ? ' opened your enquiry but has not answered.'
                    : ' has not answered your enquiry.')
                + ' We would try somebody else rather than wait any longer.</p>'
                + button(SITE_URL + '/services/' + String(enquiry.trade || ''), 'See who else covers you');

        result.host = await sendEmail(
            String(enquiry.host_email),
            (released
                ? "Here is " + name + "'s number"
                : 'No answer from ' + name)
                + ' (' + String(enquiry.reference) + ')',
            emailLayout(
                body,
                'You are receiving this because you asked a tradesman for help through Galloway Getaways.'
            )
        );
    }

    // ---- the tradesman, on a release only ---------------------------------
    if (released && provider && provider.contact_email
        && !isAutomatedTestAddress(provider.contact_email)) {
        result.provider = await sendEmail(
            String(provider.contact_email),
            'They have your number now (' + String(enquiry.reference) + ')',
            emailLayout(
                // The ONE place the mechanism is named to a tradesman, and it
                // is after it has already happened. Before the event it would
                // read as permission to ignore the email.
                '<p style="margin:0 0 16px;font-size:16px;">We did not hear back on this one quickly enough '
                    + 'and it was an emergency, so we have given '
                    + escapeHtml(String(enquiry.host_name || 'the owner'))
                    + ' your number rather than leave them with nothing. They may ring shortly.</p>'
                    + summaryBlock(enquiry)
                    + detailRows(jobRows(enquiry, listing))
                    + '<p style="margin:16px 0 0;font-size:15px;color:#6b7280;">Answering inside the window is '
                    + 'better for both of you — it is how we know the work came from us, and it is what we '
                    + 'point at when the subscription comes up.</p>',
                'You are receiving this because you are listed on Galloway Getaways and turn out to '
                + 'emergencies.'
            )
        );
    }

    result.admins = await tellTheAdmins(
        enquiry,
        listing,
        (released ? 'Released: ' : 'No answer: ') + name + ' (' + String(enquiry.reference) + ')',
        released
            ? '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(name)
                + '</strong> did not answer an emergency inside '
                + EMERGENCY_MINUTES + ' minutes, so their number went across automatically. '
                + 'No accept on this one — it does not count as work we can show them.</p>'
            : '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(name)
                + '</strong> never answered '
                + escapeHtml(String(enquiry.host_name || 'a host')) + "'s enquiry.</p>"
    );

    return result;
}

// ---------------------------------------------------------------------------
// BOTH OF US
// ---------------------------------------------------------------------------
//
// SERVICES_ALERT_EMAIL holds one address or several, separated by commas, and
// each is sent its own copy — see `recipients` in lib/email.ts for why it is
// not one message with two addresses on it.

async function tellTheAdmins(
    enquiry: any,
    listing: any,
    subject: string,
    opening: string
): Promise<string[]> {
    const to = recipients(process.env.SERVICES_ALERT_EMAIL);

    if (!to.length) {
        await logError('service-enquiry-admin-email', {
            enquiry: String(enquiry.id),
            problem: 'SERVICES_ALERT_EMAIL is not set — nobody was told.',
        });
        return [];
    }

    const { sent, failed } = await sendEmailToAll(
        to,
        subject,
        emailLayout(
            opening + summaryBlock(enquiry) + detailRows(jobRows(enquiry, listing)),
            'You are receiving this because you look after services on Galloway Getaways.'
        )
    );

    // Per address, not per message. One admin's copy bouncing must not look
    // like the alert working.
    if (failed.length) {
        await logError('service-enquiry-admin-email', {
            enquiry: String(enquiry.id),
            failed: failed.join(', '),
        });
    }

    return sent;
}

// Marking an enquiry as opened, from the reply page.
//
// Its own function because it is the one write that happens without anybody
// deciding anything, and it must never overwrite an answer: a tradesman who
// accepts and then re-opens the email is not back to 'viewed'.
export async function markViewed(id: string): Promise<void> {
    const admin = adminClient();

    await admin
        .from('service_enquiries')
        .update({ status: 'viewed', viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'sent');
}
