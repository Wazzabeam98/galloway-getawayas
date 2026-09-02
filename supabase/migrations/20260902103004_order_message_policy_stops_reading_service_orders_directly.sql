-- An order-message policy must not read service_orders inline, or it breaks
-- messaging on ordinary bookings.
--
-- THE BUG THIS FIXES
--
-- `messages` carries three kinds of thread — a booking, an enquiry, or a
-- service order — and each has its own permissive INSERT policy, OR'd together.
-- The order ones checked membership with an inline `select ... from
-- service_orders`. But service_orders holds money and is revoked from
-- `authenticated` entirely (no table grant, no column grant) — the house rule
-- for money-bearing tables. Postgres still has to evaluate every permissive
-- policy's expression to insert a row, so a guest sending a message on a plain
-- BOOKING thread — nothing to do with services — had their insert refused with
-- "permission denied for table service_orders". The "Message host" button was
-- dead for every guest and host. (The view policy has the same shape and would
-- refuse a client-side read of an order thread the same way.)
--
-- Reproduced before this fix: an INSERT to /rest/v1/messages as the seeded
-- guest, on a booking thread, returned 42501 permission-denied on
-- service_orders. An audit of every RLS policy in the schema found this the
-- ONLY case — service_orders is the only table with no read grant of any kind,
-- and only these two policies read it. profiles and service_providers look
-- similar but have column-level SELECT, so they do not bite.
--
-- THE FIX
--
-- Move the membership test into a SECURITY DEFINER function, exactly as
-- may_read_listing (20260828193000) and is_admin (20260829160000) already do.
-- The function runs as its owner, so reading service_orders needs no grant on
-- the caller's side, and the policy expression no longer names a table the
-- caller cannot read. The three-party meaning is unchanged: an order's guest,
-- or the owner of the provider it was sent to — nobody else.
--
-- WHY THE COLUMN/CONSTRAINT/INDEX ARE (RE)DECLARED HERE
--
-- The order-message feature — messages.order_id, its 3-way messages_one_thread
-- constraint, its index, and these two policies — was never in a migration; it
-- was applied to the database by hand and drifted out of version control. This
-- migration adopts it, so a fresh database matches the one in use and the fixed
-- policies are reproducible. Everything is guarded, so it is safe to run on a
-- database that already has any of it.
--
-- Safe to run twice.

-- ---- adopt the drifted order-thread shape (no-ops where it already exists) ----

alter table "public"."messages"
    add column if not exists "order_id" uuid
    references "public"."service_orders"("id") on delete cascade;

create index if not exists "messages_order_created_idx"
    on "public"."messages" ("order_id", "created_at" desc);

-- Exactly one of booking / enquiry / order per message.
alter table "public"."messages"
    drop constraint if exists "messages_one_thread";
alter table "public"."messages"
    add constraint "messages_one_thread"
    check (
        (("booking_id" is not null))::integer
      + (("enquiry_id" is not null))::integer
      + (("order_id"   is not null))::integer
      = 1
    );

-- ---- the membership test, as a function the caller need not have grants for --

create or replace function "public"."is_order_message_participant"(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from service_orders o
        where o.id = p_order
          and (
              o.guest_id = auth.uid()
              or o.provider_id in (
                  select p.id from service_providers p
                  where p.owner_id = auth.uid()
              )
          )
    );
$$;

comment on function "public"."is_order_message_participant"(uuid) is
    'Whether the current user is the guest or the provider-owner on a service '
    'order. SECURITY DEFINER on purpose: service_orders is revoked from '
    'authenticated, so reading it inline in an RLS policy refused unrelated '
    'booking-message inserts (permission denied for table service_orders).';

-- SECURITY DEFINER functions are granted to PUBLIC by default; lock it down and
-- hand it only to signed-in users, the only ones these policies apply to.
revoke all on function "public"."is_order_message_participant"(uuid) from public;
grant execute on function "public"."is_order_message_participant"(uuid) to "authenticated";

-- ---- recreate the two order policies through the function ----------------------

drop policy if exists "order participants send messages" on "public"."messages";
create policy "order participants send messages" on "public"."messages"
    for insert to "authenticated"
    with check (
        "sender_id" = "auth"."uid"()
        and "order_id" is not null
        and "public"."is_order_message_participant"("order_id")
    );

drop policy if exists "order participants view messages" on "public"."messages";
create policy "order participants view messages" on "public"."messages"
    for select to "authenticated"
    using (
        "order_id" is not null
        and "public"."is_order_message_participant"("order_id")
    );
