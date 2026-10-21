// The two experience-review emails, the experience twins of a stay's:
//
//   experienceReviewRequestEmail   to the guest, the day after (from the
//                                  experience-review-reminders cron) — a stay's
//                                  "How was your stay at …?"
//   experienceReviewReceivedEmail  to the provider when a guest reviews them
//                                  (from /api/services/reviews), linking to
//                                  their Reviews page to read it and reply
//
// Plain builders, so their words are tested without a cron or a route.

import { emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from './email';

export const REVIEW_RECEIVED_SUBJECT_PREFIX = 'New review for ';

export function experienceReviewRequestEmail(input: { orderId: string; title: string; guestFirst: string; unsubscribeToken: string | null }): { subject: string; html: string } {
    const plainTitle = (input.title || '').trim() || 'your experience';
    const title = escapeHtml(plainTitle);
    const html = emailLayout(
        '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">How was ' + title + '?</h1>'
            + '<p style="margin:0 0 8px 0;">Hi ' + escapeHtml(input.guestFirst) + ' &mdash; hope you enjoyed it.</p>'
            + '<p style="margin:0;">It takes about a minute: a star rating and a sentence or two. Your review helps the next guest choose, and helps good providers stand out.</p>'
            + button(SITE_URL + '/experiences/review/' + input.orderId, 'Leave your review')
            + '<p style="margin:0;font-size:14px;color:#6b7280;">Your review goes on the experience’s page under your first name.</p>',
        "You're receiving this because review reminders are switched on in your notification settings.",
        input.unsubscribeToken
            ? SITE_URL + '/unsubscribe?token=' + input.unsubscribeToken + '&type=review_prompts'
            : undefined,
        NEUTRAL_SUBTITLE
    );
    return { subject: 'How was ' + plainTitle + '?', html };
}

export function experienceReviewReceivedEmail(input: { title: string; reviewerFirst: string; rating: number; comment: string }): { subject: string; html: string } {
    const plainTitle = (input.title || '').trim() || 'your experience';
    const stars = Math.max(1, Math.min(5, Math.round(Number(input.rating) || 0)));
    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;"><strong>' + escapeHtml(input.reviewerFirst || 'A guest') + '</strong> reviewed <strong>'
            + escapeHtml(plainTitle) + '</strong> — ' + stars + ' star' + (stars === 1 ? '' : 's') + '.</p>'
            + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">'
            + '<tr><td style="border-left:4px solid #e5e7eb;padding:2px 0 2px 16px;">'
            + '<p style="margin:0;font-size:16px;color:#374151;">' + escapeHtml(input.comment || '').split('\n').join('<br>') + '</p>'
            + '</td></tr></table>'
            + '<p style="margin:0 0 16px;font-size:16px;">It’s on your experience’s page now. You can reply once, publicly, from your Reviews.</p>'
            + button(SITE_URL + '/services/dashboard/reviews', 'Read and reply'),
        'You are receiving this because a guest reviewed your experience on Galloway Getaways.',
        undefined,
        NEUTRAL_SUBTITLE
    );
    return { subject: REVIEW_RECEIVED_SUBJECT_PREFIX + plainTitle, html };
}
