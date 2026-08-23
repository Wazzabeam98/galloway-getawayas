// Rules for turning individual reviews into the numbers a listing shows.
//
// Two deliberate softenings sit in here, both aimed at the fact that a mean
// over a handful of reviews swings wildly:
//
//  1. A listing needs MIN_PUBLIC_REVIEWS before it shows a score at all.
//     Below that it reads "New" — one review averaged with nothing else is
//     not a rating, it is a single opinion wearing a rating's clothes.
//
//  2. The Guest favourite badge ignores a listing's single worst review
//     while it still has few of them. One bad stay on a young listing
//     otherwise costs the badge for over a dozen subsequent stays; two bad
//     stays still cost it, which is the line we actually want to draw.
//
// Neither rule touches the displayed average. That stays an honest mean.

export const MIN_PUBLIC_REVIEWS = 3;

export const GUEST_FAVOURITE_THRESHOLD = 4.8;
export const GUEST_FAVOURITE_MIN_REVIEWS = 5;

// Above this many reviews the grace rule switches off: a single bad review
// no longer moves the average enough to matter, so forgiving it would just
// be handing out the badge.
export const WORST_REVIEW_GRACE_BELOW = 20;

export const CATEGORY_KEYS = [
    'cleanliness',
    'accuracy',
    'checkin',
    'communication',
    'location',
    'value',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/**
 * Mean of some ratings, rounded to 2dp the way Postgres rounds: exactly, and
 * with halves going away from zero.
 *
 * Doing this in plain floating point does not match. `(3.67 + 4.00) / 2` is
 * 3.8349999... in binary, so toFixed(2) gives 3.83 while the database's
 * round(avg(rating), 2) gives 3.84 — and the two numbers end up on the same
 * page. Working in integer hundredths keeps every surface agreeing.
 */
export function meanTo2dp(values: number[]): number | null {
    if (!values.length) return null;
    const n = values.length;
    const sum = values.reduce((total, v) => total + Math.round(Number(v) * 100), 0);
    const whole = Math.floor(sum / n);
    const remainder = sum - whole * n;
    // Ratings are always positive, so "half up" and "half away from zero" agree.
    return (remainder * 2 >= n ? whole + 1 : whole) / 100;
}

/** Whether a listing has enough reviews to show a number rather than "New". */
export function hasPublicScore(reviewCount: number): boolean {
    return reviewCount >= MIN_PUBLIC_REVIEWS;
}

/**
 * The score the Guest favourite badge is judged on. This is NOT the score a
 * listing displays — while a listing has few reviews, its single lowest one
 * is set aside here so that one bad stay does not undo a good record.
 */
export function guestFavouriteScore(ratings: number[]): number | null {
    if (!ratings.length) return null;
    const sorted = ratings.map(Number).sort((a, b) => a - b);
    const considered =
        sorted.length < WORST_REVIEW_GRACE_BELOW ? sorted.slice(1) : sorted;
    return meanTo2dp(considered);
}

/**
 * Whether the grace rule is the thing holding the badge up — the listing has
 * it, but its plain average alone would not have earned it.
 *
 * Used to explain the badge on screen. A listing showing "Guest favourite"
 * above an average of 4.33 looks like a contradiction unless we say why.
 */
export function isGraceHoldingBadge(ratings: number[]): boolean {
    if (!isGuestFavourite(ratings)) return false;
    const plain = meanTo2dp(ratings);
    return plain !== null && plain < GUEST_FAVOURITE_THRESHOLD;
}

export function isGuestFavourite(ratings: number[]): boolean {
    if (ratings.length < GUEST_FAVOURITE_MIN_REVIEWS) return false;
    const score = guestFavouriteScore(ratings);
    return score !== null && score >= GUEST_FAVOURITE_THRESHOLD;
}
