-- A private host note per booking, kept where the guest can never reach it.
--
-- host_note is the host's own scratch note about a reservation — a gate-code
-- reminder, "allergic to the dog", "arriving late". It is written and read only
-- by someone who manages the booking (can_bookings), through a service-role
-- route, and must NEVER reach the guest.
--
-- WHY A SEPARATE TABLE, not a column on bookings. `bookings` has a table-level
-- SELECT grant to `authenticated` and a policy that lets a guest read their own
-- row from PostgREST; under a table grant a per-column revoke is a no-op, so a
-- column there would be guest-readable. Converting bookings to a by-name column
-- allow-list would also break browser INSERTs that return the row (RETURNING
-- would hit the ungranted column). So the note lives in its own table with NO
-- browser grants at all — exactly how listing_access_codes holds the door code.
-- The table is the wall: anon and authenticated cannot touch it however the
-- query is phrased, and the route (service role, can_bookings-checked) is the
-- whole surface.
--
-- Safe to run twice.

create table if not exists public.booking_host_notes (
    -- One note per booking, so the booking is the key.
    booking_id  uuid primary key references public.bookings (id) on delete cascade,
    host_note   text,
    updated_at  timestamptz not null default now(),
    -- Who last wrote it — a co-host or the owner. Informational only.
    updated_by  uuid references auth.users (id) on delete set null
);

comment on table public.booking_host_notes is
    'The host''s private note on a booking (the host_note field). Read/written only via /api/bookings/host-note (can_bookings, service role). No anon/authenticated grants — the guest must never read it.';

-- The wall. Row-level security on, and no grants to the browser roles: the
-- service role (which the route uses) bypasses both, everyone else is refused.
alter table public.booking_host_notes enable row level security;
revoke all on public.booking_host_notes from anon;
revoke all on public.booking_host_notes from authenticated;

-- Read back:
--   select count(*) from information_schema.role_table_grants
--    where table_name='booking_host_notes' and grantee in ('anon','authenticated'); -- expect 0
