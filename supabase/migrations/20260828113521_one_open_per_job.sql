-- A pending quote must not block a burst pipe.
--
-- WHAT WENT WRONG
--
-- 20260828104048 put one live enquiry per (host, provider, trade) and stopped there.
-- The rule was written against duplicate nagging — the same thing sent four
-- times because nobody answered — and on that it was right. But "the same
-- thing" was defined as "the same tradesman", which is much broader, and the
-- consequence found on the second walk-through is as bad as this flow gets: a
-- host with a planned bathroom quote outstanding tried to send the same
-- plumber an EMERGENCY and was refused. Told, in effect, that their burst pipe
-- was a duplicate of a bathroom quote.
--
-- WHAT A DUPLICATE ACTUALLY IS
--
-- Same host, same tradesman, same trade — and also:
--
--   the same urgency    A quote request, a broken door and a flood are three
--                       different jobs, not one job asked three ways. Somebody
--                       sending all three is a customer, not a nuisance. What
--                       IS a nuisance is the same urgency twice, which is the
--                       resend-because-nobody-answered case the rule was for.
--
--   the same property   A host with four cottages can genuinely have a leak in
--                       one and no heating in another, both today, both for
--                       the same plumber. Blocking the second is refusing real
--                       work on the grounds that it resembles other real work.
--
-- COALESCE, BECAUSE NULLS ARE DISTINCT IN A UNIQUE INDEX
--
-- `listing_id` is nullable — "not one of mine" is a real answer. Postgres
-- treats two NULLs as different values, so adding the bare column would have
-- excused every enquiry without a property from the rule ENTIRELY, which is
-- the one place unlimited resending is easiest. The nil uuid gives those rows
-- one shared value to collide on.
--
-- WHAT IS STILL BLOCKED, AND IT IS THE THING THAT MATTERED
--
-- Sending the same tradesman the same urgency about the same property while
-- already waiting to hear back. Withdraw it or wait; a settled one — declined,
-- expired, released, withdrawn — never blocks anything, because asking again
-- next month is ordinary.
--
-- Pre-flight:
--   select host_id, provider_id, trade, urgency, listing_id, count(*)
--     from public.service_enquiries where status in ('sent','viewed')
--    group by 1,2,3,4,5 having count(*) > 1;
--
-- Safe to run twice. Run on test first, then production.

drop index if exists "public"."service_enquiries_one_open_idx";

create unique index if not exists "service_enquiries_one_open_idx"
    on "public"."service_enquiries" (
        "host_id",
        "provider_id",
        "trade",
        "urgency",
        coalesce("listing_id", '00000000-0000-0000-0000-000000000000'::uuid)
    )
    where "status" in ('sent', 'viewed');

-- Read back:
--   select indexdef from pg_indexes
--    where indexname = 'service_enquiries_one_open_idx';
--
-- Expected: five columns, the last a coalesce, and the partial WHERE intact.
