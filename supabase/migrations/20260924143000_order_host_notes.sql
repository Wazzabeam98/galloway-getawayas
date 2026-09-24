-- A provider's private note per experience order — the experience-side twin of
-- booking_host_notes. The guest's own note lives on service_orders.note (and is
-- shown to the provider read-only, as the guest's words); THIS is the provider's
-- own scratch note about the order, which the guest must never see.
--
-- Same wall as booking_host_notes and listing_access_codes: its own table with
-- RLS on and NO grants to anon/authenticated, so a browser cannot read or write
-- it however the query is phrased. The route (service role, checking the caller
-- owns the order's provider) is the whole surface.
--
-- Safe to run twice.

create table if not exists public.order_host_notes (
    -- One note per order, so the order is the key.
    order_id    uuid primary key references public.service_orders (id) on delete cascade,
    host_note   text,
    updated_at  timestamptz not null default now(),
    -- Who last wrote it. Informational only.
    updated_by  uuid references auth.users (id) on delete set null
);

comment on table public.order_host_notes is
    'The provider''s private note on an experience order (service_orders). Read/written only via /api/services/orders/host-note (owner of the order''s provider, service role). No anon/authenticated grants — the guest must never read it.';

alter table public.order_host_notes enable row level security;
revoke all on public.order_host_notes from anon;
revoke all on public.order_host_notes from authenticated;

-- Read back:
--   select count(*) from information_schema.role_table_grants
--    where table_name='order_host_notes' and grantee in ('anon','authenticated'); -- expect 0
