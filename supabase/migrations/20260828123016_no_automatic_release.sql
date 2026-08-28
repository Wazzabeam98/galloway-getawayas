-- An accept is the only way to a phone number.
--
-- WHAT IS BEING REMOVED, AND WHY IT WAS THERE
--
-- 20260828111354 gave an unanswered emergency a second ending: after twenty
-- minutes the tradesman's number went to the host automatically, so nobody
-- with a flood was left with nothing. It was built as a safety net, and then
-- deliberately hidden so hosts would not learn to wait for it.
--
-- Both of those are now gone, and the reason is the same one that removed the
-- immediate hand-over before it. The platform sells an introduction. The
-- accept is the only event that evidences one, and it is the whole of the
-- argument at day ninety when a subscription starts being charged. A release
-- manufactures an introduction that cannot be pointed at: the tradesman never
-- agreed to it, so it proves nothing about him, and the host got what they
-- came for without the platform doing the thing it charges for.
--
-- Hiding it made that worse rather than better — a mechanism nobody is told
-- about is one nobody can be charged for either.
--
-- SO: EVERY URGENCY ENDS THE SAME WAY. Silence expires the enquiry and the
-- host is told to try somebody else. An emergency is a shorter clock and a
-- louder email, and nothing more. A host with a flood and no answer gets
-- nothing from us and rings somebody themselves. That is uncomfortable and it
-- is the decision.
--
-- It also closes a question that had no good answer: a tradesman's number
-- going to a stranger because he was slow to look at his phone, on the
-- strength of a tick box from weeks earlier. Nothing is released, so nothing
-- needs consenting to.
--
-- DESTRUCTIVE, AND SAFELY SO
--
-- `released_at` is dropped. It was written by one code path that no longer
-- exists, and there are no rows in this table on test or production — the
-- flow has never been live. If that stops being true, read the count below
-- before running this rather than after.
--
-- Pre-flight, and this is the one that matters:
--   select count(*) as rows, count(released_at) as releases
--     from public.service_enquiries;
--
-- Expect 0 and 0. Anything else means somebody's enquiry is about to lose the
-- record of how it ended, and this file wants changing to preserve it.
--
-- Needs --destructive as well as --apply. Safe to run twice. Test first.

-- Nothing should match. If anything does, its history is being flattened into
-- "nobody answered", which is true enough for a host and loses the fact that
-- the platform handed the number over.
update "public"."service_enquiries"
   set status = 'expired', updated_at = now()
 where status = 'released';

alter table "public"."service_enquiries"
    drop constraint if exists "service_enquiries_status_check";

alter table "public"."service_enquiries"
    add constraint "service_enquiries_status_check"
    check ("status" in (
        'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn'
    ));

alter table "public"."service_enquiries"
    drop column if exists "released_at";

-- Read back:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'service_enquiries_status_check';
--   select column_name from information_schema.columns
--    where table_name = 'service_enquiries' and column_name = 'released_at';
--
-- Expected: six statuses, no 'released'; and no released_at row.
