-- ensure_booking_seats must name the SAME partial index its ON CONFLICT infers.
--
-- The per-experience invite migration (20260920013334_experience_invite_list)
-- rescoped the live-seat unique index so a companion row can belong to a booking
-- OR an order:
--
--     drop index booking_guests_live_seat;
--     create unique index booking_guests_live_seat
--         on booking_guests (booking_id, seat_index)
--         where booking_id is not null and status <> 'removed';   -- predicate CHANGED
--
-- but ensure_booking_seats (20260903174512) still declared
--
--     on conflict (booking_id, seat_index) where (status <> 'removed')
--
-- Postgres matches a partial-index arbiter by its predicate, so once the index
-- gained `booking_id is not null` the old ON CONFLICT matched NO index and the
-- function raised "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification". Every booking seat top-up has thrown since: the invite
-- sheet minted nothing, so a party of four showed "Everyone's in" with the button
-- greyed. ensure_order_seats was written with the full predicate and was fine;
-- this brings the booking twin back into line. Function body is otherwise
-- unchanged from 20260903174512.

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
        on conflict (booking_id, seat_index) where (booking_id is not null and status <> 'removed') do nothing
        returning 1
    )
    select count(*) into v_minted from ins;

    return coalesce(v_minted, 0);
end;
$fn$;

revoke all on function public.ensure_booking_seats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_booking_seats(uuid, uuid) to service_role;
