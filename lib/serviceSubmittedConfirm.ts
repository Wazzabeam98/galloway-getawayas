// Telling the PROVIDER we have their submission.
//
// lib/serviceSubmittedAlert tells us a business is waiting; until this, the
// person who pressed Submit heard nothing until the decision — Airbnb emails a
// confirmation with the next steps the moment an experience is submitted. Sent
// from /api/services/submitted, which the listing editor (and the trade wizard)
// call straight after submit_service_provider() has moved the row to
// pending_review.
//
// Only for a FRESH submission: the route is also called on a live provider's
// edits and on a pending trade's re-save, and neither is a new "we've got it".
// submitted_at is stamped by the submit RPC alone, so a recent one means this
// call follows a submit.
//
// A reserved .test address is suppressed centrally in lib/email (sendEmailOnly).

import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from './email';
import { REVIEW_WITHIN_HOURS } from './serviceProviders';

export const SUBMITTED_CONFIRM_SUBJECT_EXPERIENCE = 'We’ve got your experience — it’s in review';
export const SUBMITTED_CONFIRM_SUBJECT_TRADE = 'We’ve got your application — it’s in review';

// How recent a submit_service_provider() stamp must be for this call to be the
// one that follows it. Generous: the editor calls the route immediately.
export const FRESH_SUBMIT_MS = 15 * 60 * 1000;

export function isFreshSubmission(provider: { status?: string | null; submitted_at?: string | null }, now: Date = new Date()): boolean {
    if (!provider || provider.status !== 'pending_review' || !provider.submitted_at) return false;
    const at = new Date(provider.submitted_at).getTime();
    if (!Number.isFinite(at)) return false;
    const age = now.getTime() - at;
    return age >= -60 * 1000 && age <= FRESH_SUBMIT_MS;
}

// Where "See your listing" goes: an experience's listing editor (which shows
// "In review" at the top), a trade's own application.
export function listingLinkFor(provider: { audience?: string | null; trade?: string | null }): string {
    return provider.audience === 'guest'
        ? SITE_URL + '/services/dashboard/listing'
        : SITE_URL + '/services/join?trade=' + encodeURIComponent(provider.trade || '');
}

export function submittedConfirmEmail(provider: { business_name?: string | null; audience?: string | null; trade?: string | null; declined_at?: string | null }): { subject: string; html: string } {
    const isGuest = provider.audience === 'guest';
    const name = escapeHtml(provider.business_name || (isGuest ? 'your experience' : 'your business'));
    // Sent back after a decline: say so, so it doesn't read as a first go.
    const again = !!provider.declined_at;
    const subject = isGuest ? SUBMITTED_CONFIRM_SUBJECT_EXPERIENCE : SUBMITTED_CONFIRM_SUBJECT_TRADE;
    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">Thanks for sending us <strong>' + name + '</strong>'
            + (again ? ' again with your changes' : '') + '. It’s in review.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">'
            + (isGuest
                ? 'We check every experience before guests can book it'
                : 'We check every business before it goes on the site')
            + ', and usually reply within ' + REVIEW_WITHIN_HOURS + ' hours. We’ll email you either way.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">You can keep editing your listing while you wait — anything you change is part of what we review.</p>'
            + button(listingLinkFor(provider), 'See your listing'),
        'You are receiving this because you sent a listing to Galloway Getaways for review.',
        undefined,
        NEUTRAL_SUBTITLE
    );
    return { subject, html };
}

export async function confirmSubmissionToProvider(provider: any, now: Date = new Date()): Promise<boolean> {
    if (!provider || !provider.contact_email || !isFreshSubmission(provider, now)) return false;
    const { subject, html } = submittedConfirmEmail(provider);
    return sendEmail(String(provider.contact_email), subject, html);
}
