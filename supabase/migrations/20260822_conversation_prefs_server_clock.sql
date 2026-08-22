-- The database stamps archived_at and starred_at, not whoever is writing.
--
-- Run this on both projects. It goes with 20260822_conversation_prefs.sql and
-- is safe to run twice.
--
-- WHY THIS EXISTS
--
-- Whether a conversation is archived is decided by comparing the person's
-- archived_at against the created_at of the messages sent to them. created_at
-- is written by the database. archived_at was being written by the browser,
-- from the clock on whatever machine the person happened to be using.
--
-- So the comparison was between two different clocks. A laptop running a
-- couple of seconds slow would stamp an archive as having happened before the
-- message that was already sitting there, the message would look newer than
-- the archive, and the conversation would bounce straight back into the inbox
-- looking as though Archive had simply not worked. It was caught by the test
-- runner on a machine that was one second behind, which is nothing — people's
-- clocks are out by minutes.
--
-- Rather than trusting the browser and hoping, the timestamp is put on here,
-- where the messages get theirs. Both sides of the comparison then come from
-- the same clock and it cannot drift apart again, whoever does the writing.
--
-- The browser still sends a timestamp. It is overwritten, and it is meant to
-- be — but it means the row is still sane if this trigger is ever dropped.

create or replace function "public"."conversation_prefs_stamp"()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
    -- Only a value that has actually just been set gets restamped.
    --
    -- This is the whole reason for the OLD comparison: an upsert that only
    -- changes starred_at still carries the row's existing archived_at along
    -- with it, and restamping that would silently move the archive forward
    -- past every message in the conversation. Starring something would have
    -- quietly re-archived it.
    --
    -- Clearing a value to null passes straight through, so Move to inbox and
    -- un-starring still work.
    if TG_OP = 'INSERT' then
        -- An upsert is INSERT ... ON CONFLICT DO UPDATE, and the BEFORE INSERT
        -- trigger fires before the conflict is even noticed. Whatever is put
        -- in NEW here becomes `excluded` for the update that follows, so
        -- stamping unconditionally would hand the update a value that always
        -- looks new — and the OLD comparison below would then never spot an
        -- unchanged column. Hence the existence check: stamp only when this
        -- really is a new row, and leave a genuine upsert to the branch that
        -- can see what was there before.
        if not exists (
            select 1 from "public"."conversation_prefs" p
            where p."user_id" = NEW."user_id" and p."booking_id" = NEW."booking_id"
        ) then
            if NEW."archived_at" is not null then NEW."archived_at" := now(); end if;
            if NEW."starred_at" is not null then NEW."starred_at" := now(); end if;
        end if;
    else
        if NEW."archived_at" is not null
           and NEW."archived_at" is distinct from OLD."archived_at" then
            NEW."archived_at" := now();
        end if;
        if NEW."starred_at" is not null
           and NEW."starred_at" is distinct from OLD."starred_at" then
            NEW."starred_at" := now();
        end if;
    end if;

    return NEW;
end;
$$;

drop trigger if exists "conversation_prefs_stamp_trigger" on "public"."conversation_prefs";

create trigger "conversation_prefs_stamp_trigger"
    before insert or update on "public"."conversation_prefs"
    for each row execute function "public"."conversation_prefs_stamp"();

comment on function "public"."conversation_prefs_stamp"() is
    'Puts the server clock on archived_at and starred_at. Whether a '
    'conversation is archived is decided by comparing archived_at against '
    'message timestamps the database wrote, so both must come from the same '
    'clock — a browser''s clock running slow made Archive look broken.';

-- CHECKING IT TOOK, on either project. This should return one row:
--
--   select tgname
--   from pg_trigger
--   where tgrelid = 'public.conversation_prefs'::regclass
--     and not tgisinternal;
--
-- And with a real signed-in account, archiving a conversation whose newest
-- message arrived seconds ago should keep it in the archive rather than
-- letting it bounce straight back into the inbox. That is the symptom this
-- fixes, and it is the fastest way to see it has gone.
