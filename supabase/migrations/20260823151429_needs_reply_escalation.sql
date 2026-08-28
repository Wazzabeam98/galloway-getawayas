-- Needs-reply: acknowledging a message without answering it, and the nudge
-- that goes out when nobody does either.
--
-- Run this on both projects before the code that goes with it deploys. Both
-- objects are additive — a new column on a table nothing else constrains, and
-- a new table — so there is no pre-flight query and it is safe to run twice.
--
-- WHY THE FLAG LIVES HERE
--
-- "Needs reply" is worked out, not stored: the newest message in the thread
-- was not sent by you. That is right, and it is also why a thread ending in
-- "thanks!" sits in the count forever — there is no answer to write, so
-- nothing ever clears it, and a count that is wrong often enough stops being
-- read at all.
--
-- So this is the same shape as archiving, in the same table and for the same
-- reason: one person deciding they are done with a conversation must not
-- decide it for the other. A host marking "no reply needed" changes nothing
-- in the guest's inbox.

alter table "public"."conversation_prefs"
    add column if not exists "no_reply_needed_at" timestamptz;

-- Like archived_at, this is compared against message timestamps rather than
-- read as a boolean: it holds only while nothing newer has been said. A guest
-- who follows "thanks!" with an actual question puts the thread back in the
-- count on their own, with nothing to write and nothing to miss.
comment on column "public"."conversation_prefs"."no_reply_needed_at" is
    'When this person marked the conversation as needing no reply. It counts '
    'only while no newer message has arrived — a later message puts the '
    'thread back in the needs-reply count by itself.';

create index if not exists "conversation_prefs_no_reply_idx"
    on "public"."conversation_prefs" ("user_id", "no_reply_needed_at")
    where "no_reply_needed_at" is not null;

-- The server clock stamps this one too, for exactly the reason the other two
-- are stamped here — see 20260822014818_conversation_prefs_server_clock.sql. It is
-- compared against created_at on the messages, which the database wrote, and
-- a browser a few seconds slow would mark a thread answered-for and watch it
-- come straight back looking as though the link had not worked.
create or replace function "public"."conversation_prefs_stamp"()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
    -- Only a value that has actually just been set gets restamped. See the
    -- original function for why the INSERT branch checks for the row first.
    if TG_OP = 'INSERT' then
        if not exists (
            select 1 from "public"."conversation_prefs" p
            where p."user_id" = NEW."user_id" and p."booking_id" = NEW."booking_id"
        ) then
            if NEW."archived_at" is not null then NEW."archived_at" := now(); end if;
            if NEW."starred_at" is not null then NEW."starred_at" := now(); end if;
            if NEW."no_reply_needed_at" is not null then NEW."no_reply_needed_at" := now(); end if;
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
        if NEW."no_reply_needed_at" is not null
           and NEW."no_reply_needed_at" is distinct from OLD."no_reply_needed_at" then
            NEW."no_reply_needed_at" := now();
        end if;
    end if;

    return NEW;
end;
$$;

drop trigger if exists "conversation_prefs_stamp_trigger" on "public"."conversation_prefs";

create trigger "conversation_prefs_stamp_trigger"
    before insert or update on "public"."conversation_prefs"
    for each row execute function "public"."conversation_prefs_stamp"();

-- One row per person per conversation, holding the last time they were told a
-- guest was waiting. The nudge run reads it for two things: not sending the
-- same reminder every hour, and not starting again from scratch on a thread it
-- has already chased today.
--
-- Written only by the cron, which uses the service key, so there is no policy
-- for anybody else. Row-level security is on with no policies at all, which
-- denies every signed-in reader — deliberate: this is bookkeeping, not
-- something a person needs to read.
create table if not exists "public"."sent_reply_nudges" (
    "user_id"    uuid not null references "public"."profiles"("id") on delete cascade,
    "booking_id" uuid not null references "public"."bookings"("id") on delete cascade,

    -- The message that was waiting when the reminder went out. Kept so the
    -- run can tell "still the same unanswered message" from "they have since
    -- said something else", which is worth knowing when reading these rows
    -- back to work out why somebody was or was not chased.
    "message_id" uuid,

    "sent_at"    timestamptz not null default now(),

    primary key ("user_id", "booking_id")
);

alter table "public"."sent_reply_nudges" enable row level security;

grant all on table "public"."sent_reply_nudges" to "service_role";

comment on table "public"."sent_reply_nudges" is
    'When each person was last reminded that a message of theirs is waiting. '
    'Written by /api/cron/needs-reply so a thread is chased once a day at '
    'most, however long it stays unanswered.';
