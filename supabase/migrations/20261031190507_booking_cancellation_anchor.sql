-- C2 (AUDIT-OVERNIGHT-2026-10-31): a guest could use a date change to escape the
-- cancellation window.
--
-- The free-cancellation / refund tier is computed live from the booking's
-- check_in (lib/cancellation freeCancelUntilKey / refundFraction; nothing stores
-- a deadline). A guest inside a Firm/Moderate no-refund window could MOVE the
-- stay months out (a zero-cost move applied instantly), which rewrites check_in,
-- and then cancel under the now-reset free window — escaping the penalty and
-- taking the host's income.
--
-- The fix: anchor the cancellation window on the ORIGINAL booking, never a later
-- date a change moved it to. `earliest_check_in` is the earliest check-in the
-- booking has ever held — stamped at creation and only ever moved EARLIER, never
-- later. A trigger maintains it on every write, so no application code has to
-- remember to: least(what it already was, the new check_in). A move LATER leaves
-- it at the original (the refund tier stays as booked); a legitimate move EARLIER
-- lowers it to match the sooner stay. The refund money (the cancel route and the
-- change-flow shortening) reads this instead of check_in.
--
-- ORDERING. Additive and backfilled to each row's current check_in, so existing
-- bookings keep exactly today's window. Lands on TEST and PRODUCTION on its own.
-- Not --destructive.

alter table "public"."bookings"
    add column if not exists "earliest_check_in" date;

-- Backfill: every existing booking anchors on its current check-in (today's
-- behaviour, unchanged).
update "public"."bookings"
   set "earliest_check_in" = "check_in"
 where "earliest_check_in" is null;

create or replace function public.bookings_maintain_earliest_check_in()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
    -- At INSERT (or if somehow still null) the anchor is this check-in; on any
    -- write it can only move earlier, never later.
    if new.earliest_check_in is null then
        new.earliest_check_in := new.check_in;
    else
        new.earliest_check_in := least(new.earliest_check_in, new.check_in);
    end if;
    return new;
end;
$function$;

drop trigger if exists maintain_booking_earliest_check_in on public.bookings;
create trigger maintain_booking_earliest_check_in
    before insert or update on public.bookings
    for each row
    execute function public.bookings_maintain_earliest_check_in();

-- earliest_check_in is server bookkeeping: never a browser write (the refund
-- window depends on it, so a guest who could set it could reopen the window).
-- authenticated already has no table/column write grant that includes it (the
-- bookings write grants are an explicit allow-list), and this keeps it so.
revoke insert ("earliest_check_in"), update ("earliest_check_in")
    on table "public"."bookings" from "authenticated";

notify pgrst, 'reload schema';

-- Read back — the column exists, is backfilled, and the trigger is present:
--   select count(*) filter (where earliest_check_in is null) as nulls,            -- expect 0
--          count(*) filter (where earliest_check_in <> check_in) as moved_anchors, -- 0 right after backfill
--          exists (select 1 from pg_trigger where tgname = 'maintain_booking_earliest_check_in'
--                    and tgrelid = 'public.bookings'::regclass) as has_trigger;    -- expect t
