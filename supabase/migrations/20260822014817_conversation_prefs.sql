-- Starring and archiving a conversation, per person rather than per thread.
--
-- Run this on both projects before the code that goes with it deploys.
--
-- It is a new table with no constraint on anything that already exists, so
-- there is no pre-flight query to run first and nothing here can refuse to
-- apply because of existing data. It is safe to run twice.
--
-- A host and a guest share one conversation. It is the same booking, the same
-- row, the same list of messages. So a flag stored on the booking, or on the
-- thread, would mean one of them archiving it took it away from the other as
-- well — the host tidying up his inbox would silently empty the guest's. That
-- is why this is its own table keyed on the pair (user_id, booking_id): one
-- row per person per conversation, and nobody can write anybody else's.
--
-- Note that a conversation is not always two people. booking_guests lets a
-- companion on someone else's trip message the host, so a single booking can
-- have three or more people reading it. Keying on the person rather than on
-- "host or guest" is what makes that work without a special case.

create table if not exists "public"."conversation_prefs" (
    -- References profiles, matching messages.sender_id and .recipient_id,
    -- rather than auth.users.
    "user_id"     uuid not null references "public"."profiles"("id") on delete cascade,
    "booking_id"  uuid not null references "public"."bookings"("id") on delete cascade,

    -- Timestamps rather than booleans, and not only because knowing when
    -- somebody archived something is useful. archived_at is load-bearing.
    --
    -- Archiving here means "done with this for now", not "stop telling me".
    -- A new message from the other person brings the conversation back into
    -- the inbox, because the worst thing this site can do is let a guest ask
    -- about next week's stay and have nobody see it.
    --
    -- That rule is worked out by comparing archived_at against the messages,
    -- not stored: a conversation counts as archived only while archived_at is
    -- set AND no message has arrived for that person since. So a message
    -- landing afterwards un-archives it on its own, with nothing to write and
    -- nothing to go wrong if a write were missed. A boolean could not express
    -- that without a trigger on every message insert.
    --
    -- Re-archiving simply moves archived_at forward past those messages.
    "archived_at" timestamptz,

    -- Starring is what it looks like: a flag and a filter, nothing derived.
    "starred_at"  timestamptz,

    "created_at"  timestamptz not null default now(),

    -- One row per person per conversation. The upsert the inbox does relies
    -- on this being the conflict target.
    primary key ("user_id", "booking_id")
);

-- The inbox reads all of one person's rows at once to build the list, and the
-- primary key already leads on user_id, so that lookup is covered already.
-- These two are for the folder filters, and both stay small because most
-- conversations are neither starred nor archived.
create index if not exists "conversation_prefs_archived_idx"
    on "public"."conversation_prefs" ("user_id", "archived_at")
    where "archived_at" is not null;

create index if not exists "conversation_prefs_starred_idx"
    on "public"."conversation_prefs" ("user_id", "starred_at")
    where "starred_at" is not null;

-- Own rows only, the same shape as quick_replies. The browser writes these
-- directly, so row-level security is the whole of the protection and it has
-- to cover all four verbs.
--
-- Note this is safe for a co-host, who is neither the guest nor the host on
-- the booking: the row being written is their own regardless, so unlike the
-- rest of the messages feature this needs no service key.
alter table "public"."conversation_prefs" enable row level security;

drop policy if exists "own conversation prefs select" on "public"."conversation_prefs";
create policy "own conversation prefs select" on "public"."conversation_prefs"
    for select using ("auth"."uid"() = "user_id");

drop policy if exists "own conversation prefs insert" on "public"."conversation_prefs";
create policy "own conversation prefs insert" on "public"."conversation_prefs"
    for insert with check ("auth"."uid"() = "user_id");

drop policy if exists "own conversation prefs update" on "public"."conversation_prefs";
create policy "own conversation prefs update" on "public"."conversation_prefs"
    for update using ("auth"."uid"() = "user_id") with check ("auth"."uid"() = "user_id");

drop policy if exists "own conversation prefs delete" on "public"."conversation_prefs";
create policy "own conversation prefs delete" on "public"."conversation_prefs"
    for delete using ("auth"."uid"() = "user_id");

grant all on table "public"."conversation_prefs" to "anon";
grant all on table "public"."conversation_prefs" to "authenticated";
grant all on table "public"."conversation_prefs" to "service_role";

comment on table "public"."conversation_prefs" is
    'Per-person starring and archiving of a conversation. One row per person '
    'per booking, so a host archiving a thread does not remove it from the '
    'guest''s inbox.';

comment on column "public"."conversation_prefs"."archived_at" is
    'When this person archived the conversation. It counts as archived only '
    'while no message has arrived for them since — a later message brings it '
    'back to the inbox.';
