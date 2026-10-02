-- Make the private-note tables APPEND-ONLY logs.
--
-- booking_host_notes (the host's private note on a stay) and order_host_notes
-- (the provider's private note on an experience order) were each ONE editable
-- row per booking/order. The host/provider now ADDS notes: each is stamped with
-- when it was written, and nothing is edited or deleted once saved. That needs
-- many rows per booking/order, so the primary key moves off booking_id/order_id
-- onto a per-entry id, and the timestamp becomes created_at.
--
-- Both tables were created empty for PR #174 and nothing live writes to them yet
-- (the feature is unmerged), so they are dropped and recreated in the new shape
-- rather than migrated in place — no data exists to preserve.
--
-- The wall is unchanged: RLS on, no anon/authenticated grants, so the
-- service-role routes are the whole surface. Those routes only INSERT (never
-- UPDATE or DELETE), so the log is append-only in code as well as in the schema.
--
-- Safe to run twice.

drop table if exists public.booking_host_notes cascade;
create table public.booking_host_notes (
    id          uuid primary key default gen_random_uuid(),
    booking_id  uuid not null references public.bookings (id) on delete cascade,
    host_note   text not null,
    created_at  timestamptz not null default now(),
    created_by  uuid references auth.users (id) on delete set null
);
create index if not exists booking_host_notes_booking_created_idx
    on public.booking_host_notes (booking_id, created_at);
comment on table public.booking_host_notes is
    'Append-only log of the host''s private notes on a booking. One row per note, stamped created_at/created_by. Written only via /api/bookings/host-note (can_bookings, service role, INSERT only — never updated or deleted). No anon/authenticated grants — the guest must never read it.';
alter table public.booking_host_notes enable row level security;
revoke all on public.booking_host_notes from anon;
revoke all on public.booking_host_notes from authenticated;

drop table if exists public.order_host_notes cascade;
create table public.order_host_notes (
    id          uuid primary key default gen_random_uuid(),
    order_id    uuid not null references public.service_orders (id) on delete cascade,
    host_note   text not null,
    created_at  timestamptz not null default now(),
    created_by  uuid references auth.users (id) on delete set null
);
create index if not exists order_host_notes_order_created_idx
    on public.order_host_notes (order_id, created_at);
comment on table public.order_host_notes is
    'Append-only log of the provider''s private notes on an experience order. One row per note, stamped created_at/created_by. Written only via /api/services/orders/host-note (owner of the order''s provider, service role, INSERT only — never updated or deleted). No anon/authenticated grants — the guest must never read it.';
alter table public.order_host_notes enable row level security;
revoke all on public.order_host_notes from anon;
revoke all on public.order_host_notes from authenticated;

-- Read back (each should be 0):
--   select table_name, count(*) from information_schema.role_table_grants
--    where table_name in ('booking_host_notes','order_host_notes')
--      and grantee in ('anon','authenticated') group by table_name;
