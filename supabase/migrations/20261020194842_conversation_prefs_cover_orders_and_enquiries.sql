-- conversation prefs cover orders and enquiries
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- conversation_prefs holds one person's per-conversation flags — starred_at and
-- archived_at — so a host tidying his inbox never empties the guest's. It was
-- keyed on (user_id, booking_id), so only a BOOKING thread could carry those
-- flags. The one inbox now also lists experience-order threads (guest↔provider)
-- and trade-enquiry threads (host↔provider), and those had nowhere to store a
-- star or an archive — the row menu was hidden on them for exactly that reason.
--
-- THE CHANGE
--
-- Give the table the same generic identity the read markers already use
-- (thread_reads: thread_kind + thread_id), so one row addresses any kind of
-- thread. The three kinds each keep their own foreign key — booking_id, order_id,
-- enquiry_id — so a row still cascades away when its thread is deleted, exactly
-- as the booking cascade does today. booking_id STAYS POPULATED for booking rows,
-- so lib/badgeCounts and the needs-reply cron, which read prefs by booking_id,
-- carry on untouched.
--
-- The browser upsert now conflicts on (user_id, thread_kind, thread_id) instead
-- of (user_id, booking_id); the primary key is moved to match.
--
-- RLS is unchanged on purpose: every policy is auth.uid() = user_id, which never
-- mentioned the thread, so a guest, an owner or a co-host writing their OWN row
-- for an order or an enquiry is already allowed — the row is theirs whatever kind
-- of thread it points at. Grants are table-level (all to authenticated), so the
-- new columns are writable without a per-column grant.
--
-- Safe to run twice.

-- The generic identity, and a foreign key per kind so each cascades on delete.
alter table "public"."conversation_prefs"
    add column if not exists "thread_kind" text,
    add column if not exists "thread_id"   uuid,
    add column if not exists "order_id"    uuid references "public"."service_orders"("id") on delete cascade,
    add column if not exists "enquiry_id"  uuid references "public"."service_enquiries"("id") on delete cascade;

-- Existing rows are all bookings. Point the generic identity at the booking they
-- already carry; nothing else changes for them.
update "public"."conversation_prefs"
   set "thread_kind" = 'booking', "thread_id" = "booking_id"
 where "thread_kind" is null and "booking_id" is not null;

-- Drop the old key FIRST: booking_id cannot lose NOT NULL while it is still part
-- of a primary key. (Postgres refuses "drop not null" on a PK column.)
alter table "public"."conversation_prefs" drop constraint if exists "conversation_prefs_pkey";

-- booking_id is no longer required — order and enquiry rows leave it null and set
-- their own id column instead.
alter table "public"."conversation_prefs" alter column "booking_id" drop not null;

-- Exactly one kind per row, and the kind's own id column must equal the generic
-- thread_id. This is what keeps booking_id populated for bookings (so the
-- booking_id readers keep working) while forbidding a row that sets two kinds.
alter table "public"."conversation_prefs" drop constraint if exists "conversation_prefs_one_kind";
alter table "public"."conversation_prefs"
    add constraint "conversation_prefs_one_kind" check (
        (    "thread_kind" = 'booking' and "thread_id" = "booking_id"
         and "order_id" is null and "enquiry_id" is null )
     or (    "thread_kind" = 'order'   and "thread_id" = "order_id"
         and "booking_id" is null and "enquiry_id" is null )
     or (    "thread_kind" = 'enquiry' and "thread_id" = "enquiry_id"
         and "booking_id" is null and "order_id" is null )
    );

-- Now that every row carries it, the generic identity can be required and can
-- become the key the upsert conflicts on.
alter table "public"."conversation_prefs" alter column "thread_kind" set not null;
alter table "public"."conversation_prefs" alter column "thread_id"   set not null;

alter table "public"."conversation_prefs"
    add constraint "conversation_prefs_pkey" primary key ("user_id", "thread_kind", "thread_id");

-- The folder-filter indexes were on (user_id, archived_at|starred_at) and are
-- unaffected, so there is nothing to recreate.

comment on column "public"."conversation_prefs"."thread_kind" is
    'booking | order | enquiry — which kind of thread this preference is for. '
    'With thread_id it is the row identity; the matching booking_id/order_id/'
    'enquiry_id foreign key carries the on-delete cascade.';
