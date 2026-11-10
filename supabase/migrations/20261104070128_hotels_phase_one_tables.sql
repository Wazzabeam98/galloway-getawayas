-- Hotels, phase one: a property with room types, sold per room type.
--
-- WHAT THIS IS FOR. A cottage is ONE unit (one listings row, booked at most once
-- for a given set of nights by the exclusion constraint). A hotel is a property
-- with several ROOM TYPES, each a count of identical rooms, sold per room type.
-- These tables add the hotel side. The whole feature is held off production by
-- lib/hotels hotelsOpen() until Liam opens it; this migration is applied to TEST
-- only for now. HOTELS-PLAN.md is the full design.
--
-- THE REUSE DECISION. A hotel stay still becomes a normal `bookings` row, so the
-- entire money path (checkout recompute, Stripe Connect, the webhook,
-- settlePaidBooking, host-payouts, clawback, cancellation, refunds, messaging)
-- is reused unchanged. A hotel booking just carries room_type_id + rooms_booked
-- and leaves listing_id NULL, which keeps it out of the cottage exclusion
-- constraint with no change to that constraint. The two genuine hotel
-- divergences — counting availability instead of unit-uniqueness, and room-type
-- pricing — live in lib/hotelAvailability.ts and lib/hotelPricing.ts, not here.
--
-- WHO MAY READ-WRITE.
--   hotels / hotel_room_types: anyone may SELECT a PUBLISHED hotel and its room
--     types (the public listing pages, cached and shared). The owner and any
--     co-host may also read their own hotel at any status. All WRITES go through
--     the service routes (/api/hotels/save, /publish, /checkout) with the
--     service role — the browser is granted SELECT only, exactly as edit-listing
--     writes everything through /api/listings/save. The money column
--     (commission_rate) and vat_number are NOT granted to the browser at all and
--     are read back by the owner through the hotel_private SECURITY DEFINER view.
--   hotel_access: the co-host grant table (owner_id's equals-by-permission),
--     mirroring listing_access. Service-role only for now — there is no co-host
--     UI in phase one — and read inside has_hotel_permission (SECURITY DEFINER),
--     so it needs no browser grant. A later phase that adds a co-host management
--     screen adds its policies then (and updates tests/table-grants-guard).
--
-- PERSONAL DATA. A hotel is a business property, the same shape as a listings
-- row — it carries no guest personal data, and like listings it is NOT deleted
-- when its owner's account is anonymised (the owner's own name/email live on
-- profiles and are scrubbed there). vat_number is a business identifier, kept
-- out of the browser's reach but not personal data to erase. (When hotels go
-- near production, confirm this against the erasure proof — noted in
-- HOTELS-PLAN.md §7.)
--
-- PRE-FLIGHT. Not destructive: three new tables, one view, one SECURITY DEFINER
-- function, their RLS/grants, and two additive NULLABLE columns on bookings
-- (room_type_id, rooms_booked) that every existing booking leaves null, so no
-- cottage path and no money-path guard changes.

-- ----------------------------------------------------------------- the property
create table if not exists public.hotels (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    status text not null default 'draft'
        check (status in ('draft', 'pending_review', 'published', 'hidden')),
    name text,
    description text,
    star_rating smallint check (star_rating between 1 and 5),
    property_type text check (property_type in ('hotel', 'bnb', 'guesthouse', 'inn', 'aparthotel')),
    -- A hotel publishes its address (unlike a private cottage), so these are
    -- public — this is a place the product genuinely differs from the cottage
    -- model, where the street is hidden until booked.
    location text,
    street_address text,
    postcode text,
    latitude double precision,
    longitude double precision,
    check_in_time text,
    check_in_end_time text,
    check_out_time text,
    facilities text[] not null default '{}',
    house_rules text,
    cancellation_policy text,
    cancellation_custom_days smallint,
    vat_registered boolean not null default false,
    vat_number text,            -- business identifier, kept from the browser
    commission_rate numeric,    -- money column, kept from the browser
    images text[] not null default '{}',
    created_at timestamptz not null default now(),
    declined_at timestamptz
);

create index if not exists hotels_owner_idx on public.hotels (owner_id);
create index if not exists hotels_status_idx on public.hotels (status);

-- ---------------------------------------------------------------- room types
create table if not exists public.hotel_room_types (
    id uuid primary key default gen_random_uuid(),
    hotel_id uuid not null references public.hotels (id) on delete cascade,
    name text not null,
    description text,
    -- How many identical physical rooms of this type exist. The ceiling the
    -- counting-availability model sells against.
    inventory_count smallint not null default 1 check (inventory_count >= 1),
    max_adults smallint not null default 2 check (max_adults >= 1),
    max_children smallint not null default 0 check (max_children >= 0),
    max_occupancy smallint not null default 2 check (max_occupancy >= 1),
    size_sqm smallint,
    bed_config jsonb not null default '[]',
    amenities text[] not null default '{}',
    images text[] not null default '{}',
    price_per_night numeric not null check (price_per_night > 0),
    min_nights smallint not null default 1 check (min_nights >= 1),
    sort_order smallint not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    -- Booking.com's rule: a room never sleeps more than its adults + children.
    constraint hotel_room_types_occupancy check (max_occupancy <= max_adults + max_children)
);

create index if not exists hotel_room_types_hotel_idx on public.hotel_room_types (hotel_id, sort_order);

-- ------------------------------------------------------------- co-host grants
-- Mirrors listing_access: the owner's equals-by-permission. Service-role only
-- for now (no co-host UI yet); read only inside has_hotel_permission.
create table if not exists public.hotel_access (
    id uuid primary key default gen_random_uuid(),
    hotel_id uuid not null references public.hotels (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null default 'co_host' check (role in ('owner', 'co_host', 'staff')),
    status text not null default 'active',
    can_calendar boolean not null default false,
    can_messages boolean not null default false,
    can_bookings boolean not null default false,
    can_listing boolean not null default false,
    can_earnings boolean not null default false,
    created_at timestamptz not null default now(),
    unique (hotel_id, user_id)
);

create index if not exists hotel_access_user_idx on public.hotel_access (user_id, status);

-- ------------------------------------------------- the permission function
-- Answers exactly as lib/hotelAccess checkHotel does: the hotel's owner, or an
-- ACTIVE hotel_access row holding that permission. SECURITY DEFINER so the
-- answer never depends on whether the caller can read the hotel row; it only
-- ever answers about auth.uid(). The same shape as has_listing_permission.
create or replace function public.has_hotel_permission(hotel uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.hotels h where h.id = hotel and h.owner_id = auth.uid())
    or exists (
      select 1 from public.hotel_access ha
       where ha.hotel_id = hotel
         and ha.user_id = auth.uid()
         and ha.status = 'active'
         and case perm
               when 'can_calendar' then ha.can_calendar
               when 'can_messages' then ha.can_messages
               when 'can_bookings' then ha.can_bookings
               when 'can_listing'  then ha.can_listing
               when 'can_earnings' then ha.can_earnings
               else false
             end
    )
  )
$function$;

revoke all on function public.has_hotel_permission(uuid, text) from public, anon;
grant execute on function public.has_hotel_permission(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ hotels RLS
alter table public.hotels enable row level security;

-- Anyone may read a published hotel (the public listing pages). anon never calls
-- the permission function — a published hotel matches on status alone.
drop policy if exists "anyone reads a published hotel" on public.hotels;
create policy "anyone reads a published hotel" on public.hotels
    for select to anon, authenticated
    using (status = 'published');

-- The owner and co-hosts read their own hotel at any status (draft, in review…).
drop policy if exists "owner and co-hosts read their hotel" on public.hotels;
create policy "owner and co-hosts read their hotel" on public.hotels
    for select to authenticated
    using (public.has_hotel_permission(id, 'can_listing'));

-- Browser gets SELECT only, and only on the non-sensitive columns. No
-- insert/update/delete grant: every write goes through a service route. The
-- money column (commission_rate) and vat_number are omitted — the owner reads
-- them back through hotel_private below.
revoke all on public.hotels from anon, authenticated;
grant select (
    id, owner_id, status, name, description, star_rating, property_type,
    location, street_address, postcode, latitude, longitude,
    check_in_time, check_in_end_time, check_out_time, facilities, house_rules,
    cancellation_policy, cancellation_custom_days, vat_registered, images,
    created_at, declined_at
) on public.hotels to anon, authenticated;

comment on table public.hotels is
    'A hotel (property with room types). Public SELECT on published hotels; owner/co-host SELECT at any status via has_hotel_permission. All writes are service-role (/api/hotels/*). commission_rate + vat_number kept from the browser, read via hotel_private.';

-- --------------------------------------------------------- room types RLS
alter table public.hotel_room_types enable row level security;

drop policy if exists "room types of a published hotel are public" on public.hotel_room_types;
create policy "room types of a published hotel are public" on public.hotel_room_types
    for select to anon, authenticated
    using (exists (select 1 from public.hotels h where h.id = hotel_id and h.status = 'published'));

drop policy if exists "owner and co-hosts read their room types" on public.hotel_room_types;
create policy "owner and co-hosts read their room types" on public.hotel_room_types
    for select to authenticated
    using (public.has_hotel_permission(hotel_id, 'can_listing'));

revoke all on public.hotel_room_types from anon, authenticated;
grant select on public.hotel_room_types to anon, authenticated;

comment on table public.hotel_room_types is
    'A room type (a count of identical rooms) of a hotel. Public SELECT when the parent hotel is published; owner/co-host SELECT via has_hotel_permission. Writes are service-role.';

-- --------------------------------------------------------- hotel_access RLS
-- Service-role only: no policy, no browser grant. Read only inside
-- has_hotel_permission (SECURITY DEFINER). Registered in
-- tests/table-grants-guard.test.ts.
alter table public.hotel_access enable row level security;
revoke all on table public.hotel_access from anon;
revoke all on table public.hotel_access from authenticated;

comment on table public.hotel_access is
    'Co-host grants on a hotel (owner_id''s equals-by-permission), mirroring listing_access. Service-role only in phase one; read inside has_hotel_permission.';

-- ------------------------------------------------------ the owner''s private view
-- The sensitive columns the browser SELECT grant omits, exposed to the owner and
-- co-hosts only. SECURITY DEFINER (security_invoker off) so it can read the base
-- table whose sensitive columns the browser cannot; the WHERE pins it to
-- has_hotel_permission, so it only ever returns the caller's own hotels. Same
-- design as listing_private.
drop view if exists public.hotel_private;
create view public.hotel_private
with (security_invoker = false)
as
    select id, owner_id, vat_number, commission_rate
      from public.hotels
     where public.has_hotel_permission(id, 'can_listing');

-- WRITE-REVOKE THE VIEW. Supabase grants ALL on a new view to anon AND
-- authenticated by default, and this view is simple enough to be auto-updatable
-- — and it is SECURITY DEFINER (security_invoker off). Left as granted, the
-- browser could UPDATE hotel_private and have the write land on the base hotels
-- table's commission_rate / vat_number, which the base-table grant deliberately
-- withholds (the payout-hijack class: a definer view that lets the browser write
-- the table underneath it). So revoke everything from both browser roles first,
-- then grant SELECT only. The WHERE already pins reads to the caller's own.
revoke all on public.hotel_private from anon, authenticated;
grant select on public.hotel_private to authenticated;

comment on view public.hotel_private is
    'Owner/co-host read of a hotel''s sensitive columns (vat_number, commission_rate) that the base-table browser grant omits. SECURITY DEFINER; WHERE has_hotel_permission pins it to the caller''s own hotels.';

-- -------------------------------------------------------- bookings additions
-- A hotel booking is a normal bookings row carrying which room type it sold and
-- how many rooms (phase one: always 1). listing_id stays NULL for a hotel
-- booking, keeping it out of the cottage exclusion constraint. Both columns are
-- nullable and null on every existing cottage booking — nothing else changes.
alter table public.bookings
    add column if not exists room_type_id uuid references public.hotel_room_types (id),
    add column if not exists rooms_booked smallint;

create index if not exists bookings_room_type_idx on public.bookings (room_type_id) where room_type_id is not null;

-- The guest reads these back on their own booking (the trip/confirmation pages);
-- they are not sensitive. Writes stay service-role, as all booking money is.
grant select (room_type_id, rooms_booked) on public.bookings to authenticated;

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname in ('hotels','hotel_room_types','hotel_access') order by relname;  -- all true
--   select count(*) from information_schema.role_table_grants where table_name='hotel_access' and grantee in ('anon','authenticated');  -- 0
--   select has_function_privilege('anon','public.has_hotel_permission(uuid,text)','execute');  -- false
--   select has_function_privilege('authenticated','public.has_hotel_permission(uuid,text)','execute');  -- true
--   select column_name from information_schema.column_privileges where table_name='hotels' and grantee='anon' and privilege_type='SELECT' order by column_name;  -- no vat_number / commission_rate
