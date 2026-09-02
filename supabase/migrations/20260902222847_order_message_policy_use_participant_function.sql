-- Make every apply order converge on the fixed order-message policies.
--
-- Two sessions built the order-message feature in parallel. 20260902103004
-- moved the membership test into is_order_message_participant() — a SECURITY
-- DEFINER function — because reading service_orders inline in an RLS policy
-- refuses EVERY ordinary booking-message insert (service_orders is revoked from
-- authenticated, and Postgres evaluates every permissive policy's expression).
-- But 20260902211842, from the other branch, re-creates the INLINE version, and
-- it sorts AFTER 103004 by filename — so a fresh or in-order apply runs it last
-- and silently re-breaks messaging. Production escaped only because the two were
-- applied out of filename order on the day (211842 at 10:40, 103004 at 10:46).
--
-- This migration sorts after BOTH, so it runs last whatever the order, and the
-- fixed policies are the final word. It edits no already-applied file. The
-- function it uses is created by 103004 (which sorts earlier), so it exists by
-- the time this runs. The policy definitions are identical to 103004's.
--
-- Safe to run twice. Run on test first, then production.

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
