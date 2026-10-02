-- A per-BOOKING door-code override, so a host can give one guest a different
-- entry code from the property's standing code without changing it for
-- everyone else.
--
-- The standing code lives per LISTING in listing_access_codes. This table is
-- the exception: one row per booking, holding a code that takes precedence over
-- the listing code for THAT booking only. No row means "use the listing code".
--
-- WHY A SEPARATE TABLE, and RLS-walled exactly like listing_access_codes and
-- booking_host_notes: the door code is a secret. `bookings` has a table-level
-- SELECT grant and a policy letting a guest read their own row, so a column
-- there would be guest-readable — and the whole point of the code wall is that
-- the value never reaches a browser except through the gated arrival screen
-- (confirmed + paid, within the check-in window). So the override lives in its
-- own table with NO browser grants at all: anon and authenticated cannot touch
-- it however the query is phrased, and the service-role routes (the host editor,
-- gated on can_listing; the arrival screen and the scheduled-message sender,
-- gated on the entitlement) are the whole surface.
--
-- Safe to run twice.

create table if not exists public.booking_access_codes (
    -- One override per booking, so the booking is the key.
    booking_id  uuid primary key references public.bookings (id) on delete cascade,
    code        text not null,
    updated_at  timestamptz not null default now(),
    -- Who last set it — the owner or a co-host with can_listing. Informational.
    updated_by  uuid references auth.users (id) on delete set null
);

comment on table public.booking_access_codes is
    'A per-booking door-code override that takes precedence over listing_access_codes for that one booking. Read/written only via service-role routes (host editor gated on can_listing; arrival + scheduled sender gated on the booking entitlement). No anon/authenticated grants — the code is a secret and must never reach a browser except through the gated arrival screen.';

-- The wall. Row-level security on, and no grants to the browser roles: the
-- service role (which the routes use) bypasses both, everyone else is refused.
alter table public.booking_access_codes enable row level security;
revoke all on public.booking_access_codes from anon;
revoke all on public.booking_access_codes from authenticated;

-- Read back:
--   select count(*) from information_schema.role_table_grants
--    where table_name='booking_access_codes' and grantee in ('anon','authenticated'); -- expect 0
