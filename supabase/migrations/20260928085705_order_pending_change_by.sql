-- WHO PROPOSED THE PENDING DATE/TIME CHANGE.
--
-- PR #173 gave an order a single pending_service_date the *guest* proposed and
-- the *provider* answered. A provider can now propose one too (the guest then
-- answers), so a marker is needed to route the answer to the right party:
--
--   'guest'    — the guest asked; the provider accepts/declines (the PR #173 case)
--   'provider' — the provider asked; the guest accepts/declines (the new case)
--
-- Null means no pending change. A legacy pending row written before this column
-- existed is read as 'guest' (the only kind that could have been created then),
-- so nothing already parked changes hands.
alter table public.service_orders
    add column if not exists pending_change_by text
        check (pending_change_by in ('guest', 'provider'));

notify pgrst, 'reload schema';
