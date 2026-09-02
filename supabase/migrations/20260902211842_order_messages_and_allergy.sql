-- A guest experience order can carry a message thread, and an allergy.
--
-- Until now messages hung off EXACTLY ONE of a booking or an enquiry. A guest's
-- confirmed order — a chef coming to the cottage, a cake to collect — is the
-- third thing close enough to a booking to want the same thing: a written way
-- to settle the details (the allergy included) without swapping numbers.
--
-- WHO CAN READ ONE
--
-- The two parties to the order: the guest who placed it, and the owner of the
-- provider it was placed with. Like the booking and enquiry policies, these are
-- permissive and sit alongside the others without widening them — an order
-- message has booking_id AND enquiry_id null, so it matches neither existing
-- pair, and a booking/enquiry message has order_id null and never matches here.
-- The three existing policies fail CLOSED on an order message (they key on
-- booking membership or enquiry participation, which an order row has neither
-- of), which is why this pair has to exist for an order thread to be readable
-- at all.
--
-- THE CONSTRAINT IS NOW THREE-WAY, NOT XOR
--
-- messages_one_thread was `(booking_id is not null) <> (enquiry_id is not null)`
-- — a two-operand boolean XOR that does not generalise. "Exactly one of three"
-- is a cardinality count. Every existing row has order_id null, so it still
-- satisfies the new form; nothing to backfill.
--
-- read_at is stamped by the service role (see api/messages/mark-read), so no
-- update policy is added here, same as bookings and enquiries.
--
-- Safe to run twice. Run on test first, then production.

-- --------------------------------------------------------------------------
-- 1. The thread key, its index, and the three-way constraint.
-- --------------------------------------------------------------------------
alter table "public"."messages"
    add column if not exists "order_id" uuid
    references "public"."service_orders"("id") on delete cascade;

create index if not exists "messages_order_created_idx"
    on "public"."messages" ("order_id", "created_at" desc);

-- Exactly one of booking / enquiry / order. Counting the non-null keys is the
-- form that generalises; the old `<>` did not.
alter table "public"."messages"
    drop constraint if exists "messages_one_thread";
alter table "public"."messages"
    add constraint "messages_one_thread"
    check (
        ("booking_id" is not null)::int
      + ("enquiry_id" is not null)::int
      + ("order_id"   is not null)::int
      = 1
    );

-- --------------------------------------------------------------------------
-- 2. Who may read and send on an order thread — the two parties to the order.
-- --------------------------------------------------------------------------
drop policy if exists "order participants view messages" on "public"."messages";
create policy "order participants view messages" on "public"."messages"
    for select to "authenticated"
    using ("order_id" in (
        select o."id" from "public"."service_orders" o
        where o."guest_id" = "auth"."uid"()
           or o."provider_id" in (
               select p."id" from "public"."service_providers" p
               where p."owner_id" = "auth"."uid"()
           )
    ));

drop policy if exists "order participants send messages" on "public"."messages";
create policy "order participants send messages" on "public"."messages"
    for insert to "authenticated"
    with check (
        "sender_id" = "auth"."uid"()
        and "order_id" in (
            select o."id" from "public"."service_orders" o
            where o."guest_id" = "auth"."uid"()
               or o."provider_id" in (
                   select p."id" from "public"."service_providers" p
                   where p."owner_id" = "auth"."uid"()
               )
        )
    );

-- --------------------------------------------------------------------------
-- 3. The allergy, its own column beside the free-text note.
--    Kept separate from `note` so the safety line can be routed on its own —
--    flagged in the provider email subject, shown as its own badge — and so an
--    order with no allergy stated reads differently from an order with no note.
--    Snapshotted like note and the rest of the order.
-- --------------------------------------------------------------------------
alter table "public"."service_orders"
    add column if not exists "allergy" text;

comment on column "public"."service_orders"."allergy" is
    'A food order''s stated allergy/dietary need, captured at order and released '
    'to the provider. Separate from note so it can be routed and shown on its own.';
