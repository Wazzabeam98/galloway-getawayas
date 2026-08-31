-- A review stops being something anybody can write about anybody.
--
-- WHAT WAS WRONG
--
-- Three INSERT policies on reviews. Two of them are careful:
--
--   "Guests can review after their completed stay"
--       review_type = 'guest_to_host' AND reviewer_id = auth.uid()
--       AND booking_id IN (that user's own confirmed, finished bookings)
--
--   "Hosts can review guests after a completed stay"
--       the same shape, from the host's side
--
-- And the third one:
--
--   "reviews - write own"     WITH CHECK (auth.uid() = reviewer_id)
--
-- PERMISSIVE POLICIES ARE OR'd. Postgres allows the row if ANY of them allows
-- it, so the third grants everything the first two withhold. Every careful
-- word in those two policies had no effect for as long as this one existed.
--
-- The reviews_check_window trigger still ran, and still does — the booking
-- must exist, the stay must have finished, and it must be within fourteen
-- days. But that trigger never checks WHOSE booking it was. So any signed-in
-- account could one-star any stay that ended in the last fortnight, on any
-- listing, having never been near it.
--
-- Proven against PRODUCTION on 29 August 2026: an account with no connection
-- to a booking wrote a review against it and the insert was accepted. Deleted
-- again immediately.
--
-- There was a second edge. publish_paired_reviews fires AFTER INSERT and
-- publishes both sides as soon as a counterpart exists, so inserting the
-- opposite review_type on somebody else's booking forced their genuine review
-- out of its blind window early. Closing the policy closes that too — there is
-- no longer a way to write the counterpart.
--
-- Evidence: audit-evidence/01-before-all-four.txt (before),
--           audit-evidence/05-after-reviews.txt (after).
--
-- CHECKED BEFORE DROPPING IT, because removing a permissive policy can only
-- ever take permission away and the two that remain are much narrower:
--
--   * production holds no reviews at all, so no existing row is orphaned.
--   * the two strict policies key on status = 'confirmed'. Nothing anywhere in
--     the codebase ever sets a booking to 'completed' — grepped — so
--     'confirmed' IS the state a finished stay sits in and the policies match
--     what really happens.
--   * components/LeaveReviewForm.tsx sends review_type, which both strict
--     policies require. A form that omitted it would now be refused.
--
-- THE GRANT IS NARROWED TOO, and this half matters on its own. The policies
-- decide which ROWS; is_published and published_at are COLUMNS, and they were
-- writable. "reviews - edit own while hidden" is USING (reviewer_id =
-- auth.uid() AND is_published = false) — a reviewer could satisfy that policy
-- and, in the same statement, set is_published = true, publishing their own
-- review out of the blind window and reading the other side's before writing
-- their own. The columns below are exactly what the two browser forms send.
--
-- Nothing in app/ or components/ updates a review other than
-- components/HostReplyBox.tsx, so UPDATE is granted on those two columns only.
-- That leaves "reviews - edit own while hidden" with no columns it can reach,
-- which is deliberate: there is no edit UI, and if one is built it will need a
-- grant, which is the right way round.
--
-- Safe to run twice. Run on test first, then production.

-- The policy that defeated the other two.
drop policy if exists "reviews - write own" on "public"."reviews";

revoke insert, update on table "public"."reviews" from "anon", "authenticated";

-- Exactly what components/LeaveReviewForm.tsx sends.
grant insert (
    "booking_id", "listing_id", "reviewer_id", "reviewee_id", "review_type",
    "rating", "comment", "cleanliness_rating", "accuracy_rating",
    "checkin_rating", "communication_rating", "location_rating", "value_rating"
) on table "public"."reviews" to "authenticated";

-- Exactly what components/HostReplyBox.tsx sends.
grant update ("host_reply", "host_reply_at")
    on table "public"."reviews" to "authenticated";

-- Read back. The first must return exactly the two strict policies, and the
-- second must return no rows:
--
--   select policyname from pg_policies
--    where tablename = 'reviews' and cmd = 'INSERT';
--
--   select column_name from information_schema.column_privileges
--    where table_name = 'reviews' and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE')
--      and column_name in ('is_published','published_at','edited_at');
