-- A co-host with can_messages may read and write sent_scheduled_messages,
-- exactly as the owner does.
--
-- WHY. The 19 Oct co-host migration (20261019184759) widened bookings,
-- messages, calendar_overrides, listing_extras and reviews for co-hosts but
-- missed sent_scheduled_messages. Its two policies still allow only the owner
-- (bookings.host_id = auth.uid()). So when a co-host accepts a booking, the
-- booking status update succeeds (that policy WAS widened) but the follow-up
-- "claim" insert into sent_scheduled_messages is refused by RLS, and
-- components/BookingActions.tsx aborts (if (claimError) return) before sending
-- the host's on-accept welcome message. The guest silently never gets it — the
-- on-accept confirmation is sent only from the browser, never the cron. Audit
-- 2026-10-21, finding F1.
--
-- FIX. Add the same has_booking_permission(booking_id, 'can_messages') branch
-- the other co-host policies use (it mirrors lib/access checkListing; the
-- welcome message itself needs can_messages, so matching that permission is
-- consistent). The SELECT dedupe BookingActions runs first then works for the
-- co-host too, so no double-send results.
--
-- PRE-FLIGHT: none. ALTER POLICY changes a policy expression, loses no data,
-- needs no --destructive.

alter policy "host reads own sent log" on public.sent_scheduled_messages
    using (
        exists (
            select 1 from public.bookings b
            where b.id = sent_scheduled_messages.booking_id
              and b.host_id = auth.uid()
        )
        or public.has_booking_permission(sent_scheduled_messages.booking_id, 'can_messages')
    );

alter policy "host writes own sent log" on public.sent_scheduled_messages
    with check (
        exists (
            select 1 from public.bookings b
            where b.id = sent_scheduled_messages.booking_id
              and b.host_id = auth.uid()
        )
        or public.has_booking_permission(sent_scheduled_messages.booking_id, 'can_messages')
    );

notify pgrst, 'reload schema';

-- Read back (what to confirm on apply):
--   select policyname, cmd,
--          (coalesce(qual,'') || coalesce(with_check,'')) ilike '%has_booking_permission%' as has_cohost_branch
--     from pg_policies where tablename='sent_scheduled_messages' order by policyname;
--   -- expected: both rows has_cohost_branch = true.
