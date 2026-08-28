-- An emergency waits twenty minutes, and planned work carries a date.
--
-- TWO CHANGES, ONE FILE, BECAUSE BOTH CAME OUT OF THE SAME WALK-THROUGH.
--
-- ---------------------------------------------------------------------------
-- 1. THE EMERGENCY REVERSAL
-- ---------------------------------------------------------------------------
--
-- 20260828104048 built an emergency as no enquiry at all: the number went straight to
-- the host and the row was written afterwards as a record. That is reversed
-- here, and the reason is not about the host.
--
-- Every trade in this flow is free for ninety days and then twenty pounds a
-- month. The only argument for the twenty pounds is "you got five jobs out of
-- us", and an introduction nobody accepted is not evidence of anything. Handing
-- the number over unasked means the accept never happens, and the record that
-- the platform did the work quietly stops existing — on precisely the trades
-- that have to be talked into paying.
--
-- So an emergency is sent and waits, for MINUTES rather than days, and silence
-- RELEASES the number instead of giving up on it. The host is never left
-- holding nothing: worst case they wait twenty minutes and get exactly what
-- they would have had immediately.
--
--   'direct'    is gone. It meant "the number was handed over and nobody was
--               ever asked", which is now not a thing that can happen.
--   'released'  replaces it: asked, not answered in time, number handed over
--               automatically. It is 'expired' with the opposite ending, and
--               keeping them as two words is the point — one means "try
--               somebody else" and the other means "ring this number".
--
-- The expiry constraint flips with it. It used to insist an emergency had NO
-- deadline; now everything has one, and an emergency simply has the shortest.
-- The window itself is EMERGENCY_MINUTES in lib/serviceEnquiries.ts, not a
-- number in this file: the thing to argue with once there are real ones to
-- count is the ratio of accepted to released, and that argument should not
-- need a migration.
--
-- ---------------------------------------------------------------------------
-- 2. A DATE, AND A WINDOW THAT PROMISES NOTHING
-- ---------------------------------------------------------------------------
--
-- Hosts think in changeovers: somebody on the 3rd, between eleven and three,
-- in the gap between one guest leaving and the next arriving. As free text
-- that arrives as "sometime the week after next if that's ok?" and costs a
-- phone call to pin down.
--
-- THERE IS NO CAPACITY MODEL BEHIND THESE COLUMNS AND THERE MUST NOT APPEAR TO
-- BE. Nothing knows whether he is free on the 3rd, nothing holds the window,
-- and nothing stops four hosts asking for the same one. They are a REQUEST.
-- The wording that keeps them one lives in `requestedWhen`, which always
-- begins "Asked for" — see the note above it for the list of things
-- deliberately not built, so the next person knows they were decisions.
--
-- Both times or neither, and the end after the start. A half-window is a
-- half-typed one, and it would be quoted at a tradesman as nonsense.
--
-- Pre-flight:
--   select status, urgency, count(*) from public.service_enquiries
--    group by status, urgency;
--
-- RUN AFTER 20260828104048. Safe to run twice. Run on test first, then production.

-- The rows move before the constraint, or the new check rejects them.
update "public"."service_enquiries"
   set status = 'released', updated_at = now()
 where status = 'direct';

alter table "public"."service_enquiries"
    drop constraint if exists "service_enquiries_status_check";

alter table "public"."service_enquiries"
    add constraint "service_enquiries_status_check"
    check ("status" in (
        'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'released'
    ));

-- Anything written under the old rule has no deadline and would fail the new
-- one. Give it the ordinary 48 hours rather than a made-up short window: those
-- rows were never waiting for anybody, so the number is only there to satisfy
-- a constraint and should be the boring one.
update "public"."service_enquiries"
   set expires_at = sent_at + interval '48 hours', updated_at = now()
 where expires_at is null;

alter table "public"."service_enquiries"
    drop constraint if exists "service_enquiries_expiry_check";

alter table "public"."service_enquiries"
    alter column "expires_at" set not null;

-- When the number went across on its own, as opposed to when he answered.
-- Separate from responded_at on purpose: one is a person deciding and the
-- other is a clock running out, and counting them together would flatter the
-- accept rate that this whole change exists to produce.
alter table "public"."service_enquiries"
    add column if not exists "released_at" timestamptz;

alter table "public"."service_enquiries"
    add column if not exists "preferred_date" date;
alter table "public"."service_enquiries"
    add column if not exists "window_from" time;
alter table "public"."service_enquiries"
    add column if not exists "window_to" time;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_enquiries_window_check'
    ) then
        alter table "public"."service_enquiries"
            add constraint "service_enquiries_window_check"
            check (
                ("window_from" is null and "window_to" is null)
                or ("window_from" is not null and "window_to" is not null
                    and "window_to" > "window_from")
            );
    end if;
end $$;

-- The host writes these three, the same as everything else describing the job.
-- `released_at` is NOT granted: a clock running out is the platform's to
-- record, and a host who could write it could hand themselves a phone number.
grant insert ("preferred_date", "window_from", "window_to")
    on table "public"."service_enquiries" to "authenticated";

-- Read back:
--   select conname from pg_constraint
--    where conrelid = 'public.service_enquiries'::regclass order by conname;
--
-- Expected: status check without 'direct', window check present, expiry check
-- gone, expires_at not null.
