-- The 72h escalation sweep now also picks up requests stuck in
-- 'awaiting_guest_payment' — a guest who accepted but never paid (see
-- app/api/cron/resolutions). Widen the partial index that backs that sweep's
-- working set so it stays an index scan rather than a table scan; the base
-- 20260924203041 built it over ('pending','countered') only.
--
-- A partial index's predicate can't be altered in place, so drop and recreate.
-- Additive/safe to run twice. Test first, then production.

drop index if exists public.booking_resolutions_due_idx;

create index if not exists booking_resolutions_due_idx
    on public.booking_resolutions (expires_at)
    where status in ('pending', 'countered', 'awaiting_guest_payment');
