// The host's "New review" email: a guest has reviewed their stay. The stay twin
// of experienceReviewReceivedEmail (lib/experienceReviewEmails), sent from
// /api/reviews to the host and to co-hosts with the messages permission (who
// can read and reply to reviews — the reviews page rides with it).
//
// One difference, and it is Airbnb's: stay reviews are double-blind. Until the
// host has reviewed the guest too (or 14 days after check-out), the guest's
// review is hidden — so the email says it arrived and how to read it, and
// carries neither the stars nor the words. Once it is published (the host
// reviewed first), the email shows it, exactly as the provider's does.
//
// A plain builder, so its words are tested without a route.

import { emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from './email';

export const STAY_REVIEW_RECEIVED_SUBJECT_PREFIX = 'New review of ';

export function stayReviewReceivedEmail(input: {
    title: string;
    reviewerFirst: string;
    rating: number;
    comment: string;
    published: boolean;
}): { subject: string; html: string } {
    const plainTitle = (input.title || '').trim() || 'your property';
    const who = escapeHtml(input.reviewerFirst || 'Your guest');
    let body: string;
    if (input.published) {
        const stars = Math.max(1, Math.min(5, Math.round(Number(input.rating) || 0)));
        body = '<p style="margin:0 0 16px;font-size:16px;"><strong>' + who + '</strong> reviewed their stay at <strong>'
            + escapeHtml(plainTitle) + '</strong> — ' + stars + ' star' + (stars === 1 ? '' : 's') + '.</p>'
            + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">'
            + '<tr><td style="border-left:4px solid #e5e7eb;padding:2px 0 2px 16px;">'
            + '<p style="margin:0;font-size:16px;color:#374151;">' + escapeHtml(input.comment || '').split('\n').join('<br>') + '</p>'
            + '</td></tr></table>'
            + '<p style="margin:0 0 16px;font-size:16px;">It’s on your listing now. You can reply once, publicly, from your Reviews.</p>'
            + button(SITE_URL + '/dashboard/reviews', 'Read and reply');
    } else {
        body = '<p style="margin:0 0 16px;font-size:16px;"><strong>' + who + '</strong> reviewed their stay at <strong>'
            + escapeHtml(plainTitle) + '</strong>.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Write your review of ' + who + ' to read theirs. Reviews stay hidden until you’ve both written one, or until 14 days after check-out — whichever comes first.</p>'
            + button(SITE_URL + '/dashboard/reviews', 'Write your review');
    }
    const html = emailLayout(
        body,
        'You are receiving this because a guest reviewed a stay at a property you host on Galloway Getaways.',
        undefined,
        NEUTRAL_SUBTITLE
    );
    return { subject: STAY_REVIEW_RECEIVED_SUBJECT_PREFIX + plainTitle, html };
}
