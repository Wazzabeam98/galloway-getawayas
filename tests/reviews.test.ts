// The two softenings applied to review scores, and the rounding that keeps
// every surface showing one number.
//
// The rounding half is the subtle one. Postgres computes the stored average
// with exact decimal arithmetic; JavaScript does not. Any code that recomputes
// an average in floats will disagree with the database in the second decimal
// on roughly one listing in thirteen, and both numbers end up on screen
// together. meanTo2dp exists to make that impossible, so the tests below pin
// the exact cases where naive float maths goes the other way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    meanTo2dp,
    hasPublicScore,
    guestFavouriteScore,
    isGuestFavourite,
    isGraceHoldingBadge,
    MIN_PUBLIC_REVIEWS,
    GUEST_FAVOURITE_MIN_REVIEWS,
    WORST_REVIEW_GRACE_BELOW,
} = require('../lib/reviews');

const fives = (n: number) => Array.from({ length: n }, () => 5);

// --------------------------------------------------------------- rounding

test('meanTo2dp rounds halves up, where float maths rounds them down', () => {
    // (3.67 + 4.00) / 2 is 3.8349999... in binary, so toFixed(2) gives 3.83.
    // Postgres round(avg, 2) gives 3.84, and so must we.
    assert.equal(meanTo2dp([3.67, 4.0]), 3.84);
    assert.equal(((3.67 + 4.0) / 2).toFixed(2), '3.83'); // the trap, documented
    assert.equal(meanTo2dp([3.67, 4.5]), 4.09);
    assert.equal(meanTo2dp([4.83, 4.84]), 4.84);
});

test('meanTo2dp handles the ordinary cases', () => {
    assert.equal(meanTo2dp([5]), 5);
    assert.equal(meanTo2dp([5, 5, 5, 5, 5, 1]), 4.33);
    assert.equal(meanTo2dp([4, 5]), 4.5);
    assert.equal(meanTo2dp([]), null);
});

test('meanTo2dp accepts the strings PostgREST can hand back for numerics', () => {
    assert.equal(meanTo2dp(['4.83', '4.84'] as any), 4.84);
});

// ------------------------------------------------- minimum review count (B)

test('a listing shows no score until it has MIN_PUBLIC_REVIEWS', () => {
    assert.equal(MIN_PUBLIC_REVIEWS, 3);
    assert.equal(hasPublicScore(0), false);
    assert.equal(hasPublicScore(1), false);
    assert.equal(hasPublicScore(2), false);
    assert.equal(hasPublicScore(3), true);
    assert.equal(hasPublicScore(50), true);
});

// ------------------------------------------------ drop-the-worst grace (C1)

test('one bad stay no longer costs the badge on a young listing', () => {
    // The case this was built for: five perfect stays, then one 1-star.
    const ratings = [...fives(5), 1];
    assert.equal(meanTo2dp(ratings), 4.33); // displayed average is untouched
    assert.equal(guestFavouriteScore(ratings), 5); // worst one set aside
    assert.equal(isGuestFavourite(ratings), true);
});

test('two bad stays still cost the badge', () => {
    const ratings = [...fives(5), 1, 1];
    assert.equal(isGuestFavourite(ratings), false);
});

test('the grace rule cannot rescue a merely average listing', () => {
    // Dropping the worst of five 4.5s still leaves 4.5. The rule forgives
    // outliers, not mediocrity.
    assert.equal(isGuestFavourite([4.5, 4.5, 4.5, 4.5, 4.5]), false);
    assert.equal(isGuestFavourite([5, 5, 4, 4, 1]), false);
    assert.equal(isGuestFavourite([4, 4, 4, 4, 4, 1]), false);
});

test('a consistently strong listing keeps the badge it already had', () => {
    // Averages 4.798, which the database stores as 4.80 — this listing earns
    // the badge under the old rule too. The grace must not be the only thing
    // holding it up.
    const strong = [4.83, 4.83, 4.67, 4.83, 4.83];
    assert.equal(meanTo2dp(strong), 4.8);
    assert.equal(isGuestFavourite(strong), true);
});

test('the grace switches off once a listing has enough reviews', () => {
    assert.equal(WORST_REVIEW_GRACE_BELOW, 20);

    // 19 perfect stays plus one 1-star: still young, still forgiven.
    const young = [...fives(19), 1];
    assert.equal(young.length, 20);
    assert.equal(isGuestFavourite([...fives(18), 1]), true); // n = 19

    // At 20 reviews the worst one counts again — though by then it barely
    // moves the average, which is exactly why the grace can be withdrawn.
    assert.equal(guestFavouriteScore(young), meanTo2dp(young));
    assert.equal(isGuestFavourite(young), true); // 4.80 on its own merits
    assert.equal(isGuestFavourite([...fives(17), 1, 1, 1]), false);
});

test('the badge still needs a minimum number of reviews', () => {
    assert.equal(GUEST_FAVOURITE_MIN_REVIEWS, 5);
    assert.equal(isGuestFavourite(fives(4)), false);
    assert.equal(isGuestFavourite(fives(5)), true);
    assert.equal(isGuestFavourite([]), false);
});

test('the badge threshold is applied to the exactly-rounded score', () => {
    // Six reviews averaging 4.795 once the worst is dropped would fail a
    // float comparison against 4.8 and pass an exact one.
    const score = guestFavouriteScore([1, 4.83, 4.83, 4.83, 4.83, 4.67]);
    assert.equal(score, 4.8);
    assert.equal(isGuestFavourite([1, 4.83, 4.83, 4.83, 4.83, 4.67]), true);
});

test('the badge explains itself when the grace is what earned it', () => {
    // Badge above an average of 4.33 — the case a guest would query.
    assert.equal(isGraceHoldingBadge([...fives(5), 1]), true);

    // Earned on the plain average, so there is nothing to excuse.
    assert.equal(isGraceHoldingBadge(fives(6)), false);
    assert.equal(isGraceHoldingBadge([4.83, 4.83, 4.67, 4.83, 4.83]), false);

    // No badge at all, so no explanation either.
    assert.equal(isGraceHoldingBadge([...fives(5), 1, 1]), false);
    assert.equal(isGraceHoldingBadge(fives(4)), false);
});
