-- A pending TIME on a date/time-change request for a request-shape order
-- (made_to_order / comes_to_you). These shapes now carry a service_time — the
-- provider offers a set of times and the guest picks one at booking — so a
-- "change date or time" request must be able to park a new time alongside the
-- new date it already parks in `pending_service_date`. The provider accepts both
-- at once (service_time := pending_service_time) or declines and both clear.
--
-- Null when there is no pending change, or when only the date is being changed.
-- The 48-hour answer window is the existing `pending_change_expires_at`.
alter table public.service_orders
    add column if not exists pending_service_time time;

notify pgrst, 'reload schema';
