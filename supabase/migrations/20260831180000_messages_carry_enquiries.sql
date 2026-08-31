-- Messages can carry an enquiry thread, not only a booking.
--
-- An accepted job is close to a booking, and a booking has a thread: a written
-- record of what was agreed and a way to talk without swapping numbers. So a
-- message now hangs off EXACTLY ONE of a booking or an enquiry.
--
-- WHO CAN READ ONE
--
-- The booking policies key on booking membership (guest or host). These key on
-- the enquiry: its host, and the owner of the provider it was sent to — nobody
-- else. Both are permissive, so they sit alongside the booking policies without
-- widening them: a booking message has enquiry_id null and never matches here;
-- an enquiry message has booking_id null and never matches the booking ones.
-- The three-party test is the gate — an unrelated account must read neither.
--
-- read_at is stamped by the service role (see api/messages/mark-read), so no
-- update policy is added here, same as bookings.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."messages"
    alter column "booking_id" drop not null;

alter table "public"."messages"
    add column if not exists "enquiry_id" uuid
    references "public"."service_enquiries"("id") on delete cascade;

-- Exactly one thread per message. Boolean XOR: true when precisely one is set.
alter table "public"."messages"
    drop constraint if exists "messages_one_thread";
alter table "public"."messages"
    add constraint "messages_one_thread"
    check (("booking_id" is not null) <> ("enquiry_id" is not null));

create index if not exists "messages_enquiry_created_idx"
    on "public"."messages" ("enquiry_id", "created_at" desc);

drop policy if exists "enquiry participants view messages" on "public"."messages";
create policy "enquiry participants view messages" on "public"."messages"
    for select to "authenticated"
    using ("enquiry_id" in (
        select e."id" from "public"."service_enquiries" e
        where e."host_id" = "auth"."uid"()
           or e."provider_id" in (
               select p."id" from "public"."service_providers" p
               where p."owner_id" = "auth"."uid"()
           )
    ));

drop policy if exists "enquiry participants send messages" on "public"."messages";
create policy "enquiry participants send messages" on "public"."messages"
    for insert to "authenticated"
    with check (
        "sender_id" = "auth"."uid"()
        and "enquiry_id" in (
            select e."id" from "public"."service_enquiries" e
            where e."host_id" = "auth"."uid"()
               or e."provider_id" in (
                   select p."id" from "public"."service_providers" p
                   where p."owner_id" = "auth"."uid"()
               )
        )
    );
