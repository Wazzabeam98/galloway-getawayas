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
    formatDate,
    SITE_URL,
} from '@/lib/email';
import { logError } from '@/lib/logError';
import { sendSms, emergencySms, toE164 } from '@/lib/sms';
import { tradeLabel } from '@/lib/serviceProviders';
import {
    faultLabels,
    snapshotLine,
    urgencyLabel,
    isEmergency,
    hostStatusSummary,
    requestedWhen,
    clockTime,
} from '@/lib/serviceEnquiries';

export interface AlertResult {
    ok: boolean;
    provider: boolean;
    host: boolean;
    admins: string[];
    // Emergencies only, and only when he has a mobile and has not opted out.
    // Null means it was never attempted, which is different from false.
    texted?: boolean | null;
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
        // Louder, and honest about the cost of ignoring it. Nothing is handed
        // over if he says nothing — the enquiry simply dies and the owner is
        // told to ring somebody else, which is a fact about HIS work rather
        // than a promise to them.
        const opening = emergency
            ? '<p style="margin:0 0 16px;font-size:16px;">A property owner has an <strong>emergency</strong> '
                + 'and has asked for you. Nobody else has been sent this. '
                + '<strong>If we do not hear from you shortly we will tell them to try somebody '
                + 'else</strong> — a quick no is worth as much to them as a yes.</p>'
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

    // ---- and a text, for an emergency only --------------------------------
    //
    // ONE WAY. He accepts through the link in it or through the email above,
    // and nothing can be accepted by replying — the sender is alphanumeric and
    // cannot receive a reply at all. See lib/sms.ts.
    //
    // Emergencies only, because that is where minutes decide it and because
    // texting every enquiry is how a channel stops being read. Skipped for a
    // provider who has opted out, and for a number that is not a UK mobile —
    // toE164 refuses rather than guessing.
    if (emergency) {
        const mobile = provider && provider.sms_opt_out ? null : toE164(provider && provider.contact_phone);

        if (mobile) {
            const body = emergencySms(
                SITE_URL + '/e/' + replyToken,
                trade,
                String((listing && listing.location) || enquiry.area_key || '')
                    .split(',')[0].trim() || 'Dumfries & Galloway'
            );

            const text = await sendSms(mobile, body);
            result.texted = text.ok;

            // With no automatic release behind this, an unseen emergency is
            // simply a job that does not happen. A text that failed to send is
            // worth hearing about rather than inferring from silence.
            if (!text.ok) {
                await logError('service-enquiry-sms', {
                    enquiry: String(enquiry.id),
                    problem: text.error || text.skipped || 'unknown',
                });
            }
        } else {
            result.texted = null;
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
                + '</strong>. If he has not answered by '
                + escapeHtml(clockTime(enquiry.expires_at))
                + ' it expires and they are told to try somebody else — nothing is handed over.</p>'
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

        // WHICHEVER OF THE TWO HE ACTUALLY WROTE.
        //
        // The respond route stores his message in `provider_reply` on a yes and
        // in `decline_reason` on a no, and this read only the first — so a
        // tradesman who typed "booked up until March" had it shown to the
        // admins and never to the host, who got a bare "cannot take it on".
        //
        // That is the difference between "try somebody else" and "try somebody
        // else, and do not bother asking me again until spring". He took the
        // trouble to say it; passing it on is the least the introduction owes
        // him. Found by a test rather than by a host, narrowly.
        const message = String(enquiry.provider_reply || enquiry.decline_reason || '').trim();

        const reply = message
            ? '<p style="margin:16px 0 0;font-size:15px;"><em>' + escapeHtml(message) + '</em></p>'
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
// One ending, whatever the urgency: the host is told to try somebody else and
// the platform hands over nothing. An emergency is no different — it simply
// got here faster.
//
// The tradesman is not emailed. Nothing further happens to him, and a message
// saying "that thing you ignored has stopped mattering" is somebody else's
// evening. What he loses is the job, which is the only lever worth having.

export async function announceExpiry(
    enquiry: any,
    listing: any
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const name = String(enquiry.business_name || 'them');
    const seen = String(enquiry.status || '') === 'viewed' || !!enquiry.viewed_at;

    if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
        result.host = await sendEmail(
            String(enquiry.host_email),
            'No answer from ' + name + ' (' + String(enquiry.reference) + ')',
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(name)
                    + (seen
                        ? ' opened your enquiry but has not answered.'
                        : ' has not answered your enquiry.')
                    + ' We would try somebody else rather than wait any longer.</p>'
                    + button(SITE_URL + '/services/' + String(enquiry.trade || ''), 'See who else covers you'),
                'You are receiving this because you asked a tradesman for help through Galloway Getaways.'
            )
        );
    }

    result.admins = await tellTheAdmins(
        enquiry,
        listing,
        'No answer: ' + name + ' (' + String(enquiry.reference) + ')',
        '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(name)
            + '</strong> never answered ' + escapeHtml(String(enquiry.host_name || 'a host'))
            + "'s "
            + (isEmergency(String(enquiry.urgency || '')) ? '<strong>emergency</strong>' : 'enquiry')
            + '.</p>'
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

// Somebody wanted a trade we could not offer.
//
// Straight to the admins and nowhere else. There is no tradesman to tell — the
// whole point is that there was not one — and the host has already been
// thanked on the page. What this email is for is the recruiting decision, so
// it says the trade and the place and gets out of the way.
export async function announceWanted(row: any, tradeName: string): Promise<string[]> {
    const to = recipients(process.env.SERVICES_ALERT_EMAIL);
    if (!to.length) return [];

    const where = String(row.area_key || '').trim() || 'somewhere in Dumfries & Galloway';

    const { sent, failed } = await sendEmailToAll(
        to,
        'Wanted: ' + tradeName + ' in ' + where,
        emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">Somebody looked for a <strong>'
                + escapeHtml(tradeName.toLowerCase()) + '</strong> covering <strong>'
                + escapeHtml(where) + '</strong> and we had nobody to show them.</p>'
                + (row.note
                    ? '<div style="margin:20px 0;padding:16px 18px;background-color:#f9fafb;'
                        + 'border-left:3px solid #047857;border-radius:6px;font-size:15px;line-height:1.6;">'
                        + escapeHtml(String(row.note)) + '</div>'
                    : '')
                + detailRows([
                    { label: 'Trade', value: escapeHtml(tradeName) },
                    { label: 'Where', value: escapeHtml(where) },
                    { label: 'Who', value: escapeHtml(String(row.contact || 'not signed in, left no address')) },
                ])
                + '<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">'
                + 'The full list is one query: select trade, area_key, count(*) from service_wanted '
                + 'group by 1, 2 order by count(*) desc.</p>',
            'You are receiving this because you look after services on Galloway Getaways.'
        )
    );

    if (failed.length) {
        await logError('service-wanted-email', { id: String(row.id), failed: failed.join(', ') });
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

// The tradesman would like to move an accepted job to a different day. This
// asks the host — it does not change anything. The old day stands until they
// accept, in their enquiries, the same way they accepted the job in the first
// place.
export async function announceProposedChange(
    enquiry: any,
    provider: any,
    listing: any
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const ref = escapeHtml(String(enquiry.reference || ''));
    const name = String(enquiry.business_name || 'the tradesman');
    const trade = (tradeLabel(String(enquiry.trade || '')) || 'tradesman').toLowerCase();
    const place = String((listing && (listing.location || listing.title)) || enquiry.area_key || 'the cottage');
    const newText = enquiry.proposed_date ? formatDate(enquiry.proposed_date) : 'a different day';
    const oldText = enquiry.preferred_date ? formatDate(enquiry.preferred_date) : '';

    if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
        result.host = await sendEmail(
            String(enquiry.host_email),
            name + ' asks to move the day (' + String(enquiry.reference) + ')',
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(name) + '</strong> would like to move the '
                    + escapeHtml(trade) + ' work at <strong>' + escapeHtml(place) + '</strong> to <strong>'
                    + escapeHtml(newText) + '</strong>' + (oldText ? ' (you asked for ' + escapeHtml(oldText) + ')' : '') + '.</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;color:#64748b;">Nothing changes until you say so — you know if a guest is in that day. Accept it or keep the original in your enquiries.</p>'
                    + button(SITE_URL + '/dashboard/enquiries', 'Accept or decline'),
                'You are receiving this because a tradesman asked to change the date of work you arranged through Galloway Getaways. Reference ' + ref + '.'
            )
        );
    }
    return result;
}

// The host has answered a proposed date change. The tradesman is told which
// way it went — the new day if they agreed, the day that still stands if not.
export async function announceChangeDecision(
    enquiry: any,
    provider: any,
    listing: any,
    accepted: boolean
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const ref = escapeHtml(String(enquiry.reference || ''));
    const trade = (tradeLabel(String(enquiry.trade || '')) || 'tradesman').toLowerCase();
    const place = String((listing && (listing.location || listing.title)) || enquiry.area_key || 'the cottage');
    const dayText = enquiry.preferred_date ? formatDate(enquiry.preferred_date) : 'the day agreed';

    if (provider && provider.contact_email && !isAutomatedTestAddress(provider.contact_email)) {
        result.provider = await sendEmail(
            String(provider.contact_email),
            (accepted ? 'New day agreed' : 'Original day kept') + ' (' + String(enquiry.reference) + ')',
            emailLayout(
                accepted
                    ? '<p style="margin:0 0 16px;font-size:16px;">The host agreed — the ' + escapeHtml(trade)
                        + ' work at <strong>' + escapeHtml(place) + '</strong> is now for <strong>' + escapeHtml(dayText) + '</strong>.</p>'
                    : '<p style="margin:0 0 16px;font-size:16px;">The host kept the original day. The ' + escapeHtml(trade)
                        + ' work at <strong>' + escapeHtml(place) + '</strong> still stands for <strong>' + escapeHtml(dayText)
                        + '</strong> — give them a call if that no longer works for you.</p>',
                'You are receiving this because a host answered your request to change a date on Galloway Getaways. Reference ' + ref + '.'
            )
        );
    }
    return result;
}

// A job that was accepted has been called off. Told to the side that did NOT
// do it: a tradesman cancelling leaves the host uncovered — urgent when the day
// is close — while a host cancelling only frees the tradesman's day. The reason
// travels either way.
export async function announceCancellation(
    enquiry: any,
    provider: any,
    listing: any
): Promise<AlertResult> {
    const result: AlertResult = { ok: true, provider: false, host: false, admins: [] };
    const byProvider = String(enquiry.cancelled_by || '') === 'provider';
    const ref = escapeHtml(String(enquiry.reference || ''));
    const name = String(enquiry.business_name || 'the tradesman');
    const trade = (tradeLabel(String(enquiry.trade || '')) || 'tradesman').toLowerCase();
    const reason = String(enquiry.cancel_reason || '').trim();
    const place = String((listing && (listing.location || listing.title)) || enquiry.area_key || 'the cottage');
    const dateText = enquiry.preferred_date ? formatDate(enquiry.preferred_date) : 'the day you agreed';

    let daysAway: number | null = null;
    if (enquiry.preferred_date) {
        const d = new Date(String(enquiry.preferred_date) + 'T12:00:00Z');
        if (!isNaN(d.getTime())) daysAway = Math.floor((d.getTime() - Date.now()) / 86400000);
    }
    const soon = daysAway !== null && daysAway >= 0 && daysAway < 7;

    const reasonRow = reason
        ? '<p style="margin:16px 0 0;font-size:15px;"><strong>Reason given:</strong> <em>' + escapeHtml(reason) + '</em></p>'
        : '';

    if (byProvider) {
        // -> the host, now uncovered
        if (enquiry.host_email && !isAutomatedTestAddress(enquiry.host_email)) {
            const weekday = enquiry.preferred_date
                ? new Date(String(enquiry.preferred_date) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
                : '';
            const subject = soon
                ? 'Urgent: your ' + trade + ' has cancelled ' + (weekday ? weekday + '’s visit' : 'the visit') + ' (' + String(enquiry.reference) + ')'
                : name + ' has cancelled (' + String(enquiry.reference) + ')';
            const soonLine = soon
                ? '<p style="margin:16px 0 0;font-size:15px;color:#b45309;"><strong>This is soon</strong> — the day is '
                    + (daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : 'in ' + daysAway + ' days') + '.</p>'
                : '';

            result.host = await sendEmail(
                String(enquiry.host_email),
                subject,
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(name) + '</strong> has cancelled the '
                        + escapeHtml(trade) + ' work at <strong>' + escapeHtml(place) + '</strong> on '
                        + escapeHtml(dateText) + '. You’ll need to arrange someone else.</p>'
                        + reasonRow + soonLine
                        + button(SITE_URL + '/services/' + String(enquiry.trade || ''), 'Find someone else who covers you'),
                    'You are receiving this because a tradesman you asked through Galloway Getaways has cancelled. Reference ' + ref + '.'
                )
            );
        }
    } else {
        // host cancelled -> the tradesman, whose day is freed
        if (provider && provider.contact_email && !isAutomatedTestAddress(provider.contact_email)) {
            result.provider = await sendEmail(
                String(provider.contact_email),
                'A job has been called off (' + String(enquiry.reference) + ')',
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">The ' + escapeHtml(trade) + ' work at <strong>'
                        + escapeHtml(place) + '</strong> on ' + escapeHtml(dateText)
                        + ' is no longer needed — the host has called it off, so there is nothing to turn out for.</p>'
                        + reasonRow,
                    'You are receiving this because a host cancelled a job you had accepted on Galloway Getaways. Reference ' + ref + '.'
                )
            );
        }
    }

    return result;
}

// THE AGREED DAY MOVED ONTO A DAY A GUEST IS IN THE COTTAGE.
//
// The platform warns about this collision in two places already: the enquiry
// form warns a host raising a job on a booked day, and the Stripe webhook
// warns when a booking lands on planned work. Both fire when a date is SET.
// Neither fires when it MOVES — and accepting a proposed change is the only
// path that moves an agreed date, so it was the one path that never looked.
//
// Same stance as the webhook, deliberately: nothing is blocked. A short job
// and a guest can share a day. What the host cannot see from the enquiry is
// the guest, so they are told, and it is their conversation to have.
export async function announceWorkNowClashes(
    enquiry: any,
    listing: any,
    booking: any
): Promise<boolean> {
    const admin = adminClient();

    const { data: hostUser } = await admin.auth.admin.getUserById(String(enquiry.host_id));
    const to = (hostUser && hostUser.user && hostUser.user.email) || '';
    if (!to || isAutomatedTestAddress(to)) return false;

    const where = escapeHtml(String((listing && listing.title) || 'your property'));
    const trade = escapeHtml(tradeLabel(String(enquiry.trade || '')) || 'Work');

    const sent = await sendEmail(
        to,
        'The new day for your ' + (tradeLabel(String(enquiry.trade || '')) || 'job').toLowerCase()
            + ' has a guest in the cottage',
        emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">You have agreed to move the '
                + trade.toLowerCase() + ' at <strong>' + where + '</strong> to <strong>'
                + escapeHtml(formatDay(enquiry.preferred_date))
                + '</strong>.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">There is a guest booked in that day — '
                + escapeHtml(formatDay(booking.check_in)) + ' to '
                + escapeHtml(formatDay(booking.check_out)) + '.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Nothing is blocked and nothing has changed — a short job and a guest can share a day. But it is a different conversation with the tradesman, and you have just agreed to the date, so we wanted you to know now rather than on the morning.</p>'
            + button(SITE_URL + '/dashboard/calendar', 'Open your calendar'),
            'You are receiving this because work you agreed on your cottage overlaps a guest stay.'
        )
    );

    if (!sent) {
        await logError('service-enquiry-clash-email', {
            enquiry: String(enquiry.id),
            error: 'the host was not told their new work day has a guest on it',
        });
    }

    return sent;
}

function formatDay(value: any): string {
    if (!value) return '';
    return new Date(String(value)).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    });
}
