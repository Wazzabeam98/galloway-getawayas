-- A pending DATE-change request on a confirmed request-shape order (made_to_order
-- / comes_to_you). A date change moves no money, so it can't ride the
-- authorise/capture hold the way a paid increase does; instead the requested new
-- date is parked here on the still-confirmed order and the provider accepts it
-- (service_date := pending_service_date) or declines it (cleared). The 48-hour
-- answer window is `pending_change_expires_at`; the service-orders cron clears an
-- unanswered request past it. Both null on an order with no pending date change.
alter table public.service_orders
    add column if not exists pending_service_date date,
    add column if not exists pending_change_expires_at timestamptz;

notify pgrst, 'reload schema';
