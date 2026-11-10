-- Per-date overrides for a hotel room type — the hotel twin of calendar_overrides
-- (Liam's second walkthrough: a per-room-type availability calendar with close
-- dates and seasonal prices). A row closes a room type for a night (is_blocked)
-- and/or overrides its nightly price (price_override). "Rooms left on a date" is
-- NOT stored — it is inventory_count minus the bookings overlapping that night
-- (minus the whole inventory when is_blocked), computed in lib/hotelAvailability.
--
-- WHO MAY READ-WRITE. SELECT for the owner and calendar co-hosts (the dashboard
-- calendar reads it with the browser client, like the cottage one), gated by
-- has_hotel_permission(hotel, 'can_calendar') joined through the room type. All
-- WRITES go through the service-role route /api/hotels/calendar — the browser
-- gets no insert/update/delete — exactly as the cottage calendar writes through
-- /api/listings/calendar. anon gets nothing (the public page needs no calendar;
-- checkout reads overrides server-side with the service role).
--
-- Not destructive: one new table, TEST only, behind hotelsOpen().

create table if not exists public.hotel_room_overrides (
    id uuid primary key default gen_random_uuid(),
    room_type_id uuid not null references public.hotel_room_types (id) on delete cascade,
    date date not null,
    is_blocked boolean not null default false,
    price_override numeric,
    created_at timestamptz not null default now(),
    unique (room_type_id, date)
);

create index if not exists hotel_room_overrides_room_idx on public.hotel_room_overrides (room_type_id, date);

alter table public.hotel_room_overrides enable row level security;

drop policy if exists "owner and calendar co-hosts read room overrides" on public.hotel_room_overrides;
create policy "owner and calendar co-hosts read room overrides" on public.hotel_room_overrides
    for select to authenticated
    using (exists (
        select 1 from public.hotel_room_types rt
         where rt.id = room_type_id and public.has_hotel_permission(rt.hotel_id, 'can_calendar')
    ));

revoke all on public.hotel_room_overrides from anon, authenticated;
grant select on public.hotel_room_overrides to authenticated;

comment on table public.hotel_room_overrides is
    'Per-date block / price override for a hotel room type. Owner/calendar co-host SELECT via has_hotel_permission; all writes service-role (/api/hotels/calendar). Mirrors calendar_overrides.';

notify pgrst, 'reload schema';

-- Read back:
--   select relrowsecurity from pg_class where relname='hotel_room_overrides';  -- true
--   select count(*) from information_schema.role_table_grants where table_name='hotel_room_overrides' and grantee='anon';  -- 0
