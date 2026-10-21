// What an experience review needs before it is posted — one rule for the form
// (components/marketplace/ExperienceReviewForm greys Post until it passes) and
// the route that saves it (/api/services/reviews refuses the same). Who may
// review which booking is the database's to decide (order_reviewable_by and the
// window trigger); this is only the shape of the review itself.

export const REVIEW_MIN_COMMENT = 10;

export function reviewSubmissionProblem(orderId: string, rating: number, comment: string): string | null {
    if (!orderId) return 'That booking couldn’t be found.';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a star rating.';
    if (String(comment || '').trim().length < REVIEW_MIN_COMMENT) return 'Write a sentence or two about it.';
    return null;
}
