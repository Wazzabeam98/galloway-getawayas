// Telling a HOLIDAY-LET HOST we have their listing.
//
// The host twin of lib/serviceSubmittedConfirm (an experience provider's "We've
// got your experience — it's in review"). Until this, a host who submitted a
// listing heard nothing until the decision, while a provider was told at once —
// Airbnb emails a confirmation with the next steps the moment a listing is sent.
//
// Sent from /api/listings/publish, inside the submit itself, only when the
// listing moves INTO review: a first submit, or one sent back and now sent
// again. A listing that was live before goes straight back up (no review), and
// a second press while it is already waiting sends nothing.
//
// A reserved .test address is suppressed centrally in lib/email (sendEmailOnly).

import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, COTTAGE_SUBTITLE } from './email';
import { greetingName } from './utils';

export const LISTING_SUBMITTED_SUBJECT = 'We’ve got your listing — it’s in review';

// Whether this publish is the one that sends it: into pending_review from
// anything other than pending_review. Never for a listing that has been live.
export function sendsListingConfirmation(previousStatus: string | null | undefined, nextStatus: string): boolean {
    return nextStatus === 'pending_review' && previousStatus !== 'pending_review'
        && previousStatus !== 'published' && previousStatus !== 'hidden';
}

// The link: the listing's own editor — where a co-host's copy of the push can
// find the listing too (lib/pushDispatch reads the listing id from the URL).
export function listingEditorLink(listingId: string): string {
    return SITE_URL + '/edit-listing/' + encodeURIComponent(listingId);
}

export function listingSubmittedEmail(
    listing: { id: string; title?: string | null; declined_at?: string | null },
    host: { first_name?: string | null; full_name?: string | null; preferred_name?: string | null } | null,
): { subject: string; html: string } {
    const title = escapeHtml((listing.title || '').trim() || 'your listing');
    // Sent back and sent again: say so, so it doesn't read as a first go.
    const again = !!listing.declined_at;
    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">Hello ' + escapeHtml(greetingName(host as any, 'there')) + ',</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Thanks for sending us <strong>' + title + '</strong>'
            + (again ? ' again with your changes' : '') + '. It’s in review.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">We check every listing before guests can book it, and we’ll email you as soon as we’ve looked — whether it’s live or needs a few changes.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">You can keep editing your listing while you wait — anything you change is part of what we review.</p>'
            + button(listingEditorLink(listing.id), 'See your listing'),
        'You are receiving this because you sent a listing to Galloway Getaways for review.',
        undefined,
        COTTAGE_SUBTITLE
    );
    return { subject: LISTING_SUBMITTED_SUBJECT, html };
}

export async function confirmListingSubmission(
    to: string | null | undefined,
    listing: { id: string; title?: string | null; declined_at?: string | null },
    host: { first_name?: string | null; full_name?: string | null; preferred_name?: string | null } | null,
): Promise<boolean> {
    if (!to) return false;
    const { subject, html } = listingSubmittedEmail(listing, host);
    return sendEmail(String(to), subject, html);
}
