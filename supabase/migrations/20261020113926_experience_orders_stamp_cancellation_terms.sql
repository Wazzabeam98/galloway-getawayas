-- Experience orders keep the cancellation terms they were booked under.
--
-- WHAT THIS DOES, AND WHY — the experience twin of 20261019113000, which did the
-- same for holiday-let bookings.
--
-- Until now every refund rule for an experience order read the provider's
-- CURRENT terms live (service_providers.cancellation_window_hours and
-- guest_details.no_refund). So a provider moving from "Flexible, 24 hours" to
-- "No refund" silently turned every booking already paid for into a
-- non-refundable one — and the other way round. From now each order carries its
-- OWN copy, stamped at checkout by the routes that create it (slot booking,
-- request/cart checkout via the Stripe metadata, and the top-up/change child rows,
-- which copy their parent's), and the cancel route and every change/window check
-- read the stamp (lib/orderCancelTerms.ts).
--
--   service_orders.cancellation_window_hours  integer, stamped at checkout
--   service_orders.no_refund                  boolean, stamped at checkout
--
-- service_orders has no grant of any kind to anon or authenticated (written and
-- read by the service role only), so these columns are not browser-writable and
-- need no revoke.
--
-- EXISTING ORDERS are stamped with the terms their provider has NOW (step 2) —
-- the terms the cancel route would apply to them today — so no in-flight order's
-- refund changes by this migration. A null window after this means only an order
-- inserted by code that predates this change; the helper then falls back to the
-- provider's live terms, exactly as before.
--
-- PRE-FLIGHT: none destructive. Adds a nullable column and a defaulted boolean,
-- adds a CHECK no existing row can fail (the backfill copies from a NOT NULL
-- column the editor already clamps to >= 0), and fills the new columns. No data
-- is lost; --destructive is NOT required and must never be used. TEST first,
-- then production.

-- ---------------------------------------------------------------------------
-- 1) The order's own copy of the terms.
-- ---------------------------------------------------------------------------
alter table public.service_orders
    add column if not exists cancellation_window_hours integer,
    add column if not exists no_refund boolean not null default false;

alter table public.service_orders
    drop constraint if exists service_orders_cancellation_window_hours_check;
alter table public.service_orders
    add constraint service_orders_cancellation_window_hours_check
    check (cancellation_window_hours is null or cancellation_window_hours >= 0);

comment on column public.service_orders.cancellation_window_hours is
    'The provider''s free-cancellation window (hours) stamped on this order at '
    'checkout and never rewritten, so a later change to the provider''s policy '
    'cannot alter the terms of an order already booked. Read by '
    'lib/orderCancelTerms.ts. Null only on an order written before the stamp, '
    'which falls back to the provider''s live window. Service role only.';
comment on column public.service_orders.no_refund is
    'The provider''s "No refund" policy, stamped at checkout beside '
    'cancellation_window_hours. True = no automatic refund whatever the clock '
    'says (the provider can still choose to refund). Service role only.';

-- ---------------------------------------------------------------------------
-- 2) Stamp every existing order with its provider's CURRENT terms.
-- ---------------------------------------------------------------------------
update public.service_orders o
    set cancellation_window_hours = p.cancellation_window_hours,
        no_refund = coalesce(p.guest_details -> 'no_refund' = 'true'::jsonb, false)
    from public.service_providers p
    where o.provider_id = p.id
      and o.cancellation_window_hours is null;

notify pgrst, 'reload schema';

-- Read back (what to confirm on apply):
--   select count(*) filter (where cancellation_window_hours is null) as unstamped,
--          count(*) filter (where no_refund) as no_refund_orders,
--          count(*) as total
--     from public.service_orders;
--   -- expected: unstamped = 0 (every order has a provider), no_refund_orders =
--   -- the orders whose provider is on "No refund" today.
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_name='service_orders'
--      and column_name in ('cancellation_window_hours','no_refund')
--      and grantee in ('anon','authenticated');
--   -- expected: no rows.
