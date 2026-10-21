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

// How long a guest has to review: 14 days after the experience's day, the same
// window a stay has after check-out (and the database's — order_reviewable_by
// and check_experience_review_window refuse from day 15). Days left counting
// today, so 0 is the last day and below 0 means the window has closed. Both
// arguments are YYYY-MM-DD day keys.
export const REVIEW_WINDOW_DAYS = 14;

export function experienceReviewDaysLeft(serviceDate: string, todayKey: string): number {
    const day = Date.parse(String(serviceDate || '').slice(0, 10) + 'T00:00:00Z');
    const today = Date.parse(String(todayKey || '').slice(0, 10) + 'T00:00:00Z');
    return Math.round((day - today) / 86400000) + REVIEW_WINDOW_DAYS;
}
