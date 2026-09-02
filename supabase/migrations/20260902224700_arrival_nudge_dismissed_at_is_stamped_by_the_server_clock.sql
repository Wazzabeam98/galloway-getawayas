-- The database stamps arrival_nudge_prefs.dismissed_at, not the browser.
--
-- Run this on both projects. It goes with 20260902224612_arrival_secrets_and_nudge_prefs.sql
-- (which creates the table, and sorts before this) and is safe to run twice.
--
-- WHY THIS EXISTS
--
-- Whether an arrival nudge is dismissed is decided in ArrivalNudge.tsx by
-- comparing this row's dismissed_at against the created_at of the listing's
-- upcoming bookings: a dismissal holds only until a booking made AFTER it
-- arrives. created_at is written by the database. dismissed_at was written by
-- the browser (ArrivalNudgeCard.dismiss: `dismissed_at: new Date().toISOString()`).
--
-- So the comparison was between two clocks — exactly the conversation_prefs bug
-- fixed in 20260822014818_conversation_prefs_server_clock.sql. A host whose
-- laptop runs a little slow dismisses the nudge, but the stamp it writes is
-- older than a booking that is already sitting there, the booking looks newer
-- than the dismissal, and the nudge bounces straight back as though Dismiss did
-- nothing. A clock running fast does the opposite: a genuinely new booking
-- fails to bring the nudge back.
--
-- The fix is the same: stamp it here, where created_at is written, so both
-- sides of the comparison come from one clock. The browser still sends a value
-- and it is overwritten — meant to be, so the row stays sane if this trigger is
-- ever dropped.

create or replace function "public"."arrival_nudge_prefs_stamp"()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
    -- An upsert is INSERT ... ON CONFLICT DO UPDATE, and the BEFORE INSERT
    -- trigger fires before the conflict is noticed. Whatever is put in NEW here
    -- becomes `excluded` for the update that follows, so on a row that already
    -- exists we must NOT stamp in the INSERT branch — we leave it to the UPDATE
    -- branch, which can see OLD. Stamping in both would hand the update a value
    -- that always looks new. (This is the trap conversation_prefs hit.)
    if TG_OP = 'INSERT' then
        if not exists (
            select 1 from "public"."arrival_nudge_prefs" p
            where p."user_id" = NEW."user_id" and p."listing_id" = NEW."listing_id"
        ) then
            if NEW."dismissed_at" is not null then NEW."dismissed_at" := now(); end if;
        end if;
    else
        -- Only restamp a value that actually just changed; clearing to null
        -- passes through, so an un-dismiss (were one ever added) still works.
        if NEW."dismissed_at" is not null
           and NEW."dismissed_at" is distinct from OLD."dismissed_at" then
            NEW."dismissed_at" := now();
        end if;
    end if;
    return NEW;
end;
$$;

drop trigger if exists "arrival_nudge_prefs_stamp_trigger" on "public"."arrival_nudge_prefs";

create trigger "arrival_nudge_prefs_stamp_trigger"
    before insert or update on "public"."arrival_nudge_prefs"
    for each row execute function "public"."arrival_nudge_prefs_stamp"();

comment on function "public"."arrival_nudge_prefs_stamp"() is
    'Puts the server clock on arrival_nudge_prefs.dismissed_at. Whether a nudge '
    'is dismissed is decided by comparing it against booking created_at, which '
    'the database wrote, so both must come from the same clock — a browser''s '
    'clock running slow made Dismiss look broken (see conversation_prefs).';
