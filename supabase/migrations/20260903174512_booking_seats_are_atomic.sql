-- Two devices — or two tabs — opening the group sheet at once each read the seat
-- count and each insert the shortfall, so a four-person booking ends up with six
-- or eight seats. The check-then-insert in /api/booking-guests 'ensure-seats' has
-- no defence against a concurrent one.
--
-- The fix is a constraint, not a lock: give every seat an ordinal (1..capacity),
-- unique per booking among LIVE seats, and mint the shortfall as an atomic
-- INSERT ... ON CONFLICT DO NOTHING. Two concurrent calls compute the same
-- missing ordinals and both insert; the partial unique index rejects the
-- duplicates, so exactly one live seat exists per ordinal. No over-mint, whatever
-- the timing.

alter table public.booking_guests add column if not exists seat_index integer;

-- Backfill existing rows — number them per booking, oldest first. Removed rows
-- get a number too, but the partial index below ignores them.
update public.booking_guests bg
   set seat_index = s.rn
  from (
    select id, row_number() over (partition by booking_id order by invited_at, id) as rn
      from public.booking_guests
     where seat_index is null
  ) s
 where bg.id = s.id and bg.seat_index is null;

-- One LIVE seat per ordinal per booking. Removed seats are excluded, so removing
-- a seat frees its ordinal for ensure-seats to refill.
create unique index if not exists booking_guests_live_seat
    on public.booking_guests (booking_id, seat_index)
    where status <> 'removed';

-- The atomic top-up. Returns how many seats it minted. SECURITY DEFINER because
-- the caller (the route) has already checked the signed-in user booked this
-- booking; the function itself only ever tops a booking up to its own party size.
create or replace function public.ensure_booking_seats(p_booking uuid, p_inviter uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_cap    integer;
    v_minted integer;
begin
    select greatest(0, coalesce(guests, 1) - 1) into v_cap
      from public.bookings where id = p_booking;

    with want as (
        select generate_series(1, v_cap) as idx
    ),
    ins as (
        insert into public.booking_guests (booking_id, seat_index, invited_by)
        select p_booking, w.idx, p_inviter
          from want w
         where not exists (
                 select 1 from public.booking_guests bg
                  where bg.booking_id = p_booking
                    and bg.seat_index = w.idx
                    and bg.status <> 'removed'
             )
        on conflict (booking_id, seat_index) where (status <> 'removed') do nothing
        returning 1
    )
    select count(*) into v_minted from ins;

    return coalesce(v_minted, 0);
end;
$fn$;

-- The browser never calls this — only the route, as the service role, after its
-- own ownership check.
revoke all on function public.ensure_booking_seats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_booking_seats(uuid, uuid) to service_role;

-- Read back — fire it twice for one booking and the live count equals capacity,
-- never double:
--   select public.ensure_booking_seats('<booking>', '<inviter>');
