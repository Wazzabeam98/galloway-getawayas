-- Per-experience invite list, reusing booking_guests.
--
-- A companion row now belongs to EITHER a booking (a stay's party) or a
-- service_order (an experience's guest list), never both. Everything else — the
-- single-use invite_token, the seat model, the /trip-invite claim — is the same
-- machine. The connection to a stay is a convenience (the picker prefills from
-- the stay's party), not the mechanism: an experience booked with no cottage
-- stay at all still has its own list.

-- 1. The order parent. Nullable; cascades so removing an order takes its invite
--    list with it.
alter table public.booking_guests
    add column if not exists order_id uuid references public.service_orders(id) on delete cascade;

-- 2. booking_id is no longer mandatory — a standalone experience order has no stay.
alter table public.booking_guests
    alter column booking_id drop not null;

-- 3. Exactly one parent, always.
alter table public.booking_guests
    drop constraint if exists booking_guests_one_parent;
alter table public.booking_guests
    add constraint booking_guests_one_parent check (num_nonnulls(booking_id, order_id) = 1);

-- 4. Live-seat uniqueness, per parent. The existing index assumed a non-null
--    booking_id; scope it to that and add the mirror for orders.
drop index if exists public.booking_guests_live_seat;
create unique index if not exists booking_guests_live_seat
    on public.booking_guests (booking_id, seat_index)
    where booking_id is not null and status <> 'removed';
create unique index if not exists booking_guests_live_seat_order
    on public.booking_guests (order_id, seat_index)
    where order_id is not null and status <> 'removed';

-- 5. Read access for order rows, additive (permissive policies OR together, so
--    booking rows keep their existing policy untouched): the order's booker, or
--    the companion who has claimed the seat. Writes stay service-role only,
--    through /api/booking-guests, exactly as the booking side does.
drop policy if exists "order guests readable" on public.booking_guests;
create policy "order guests readable" on public.booking_guests
    for select using (
        order_id is not null and (
            exists (
                select 1 from public.service_orders o
                 where o.id = booking_guests.order_id and o.guest_id = auth.uid()
            )
            or booking_guests.user_id = auth.uid()
        )
    );

-- 6. The atomic seat top-up for an order, capped at the places BOOKED minus the
--    booker's own place: someone who booked two places can invite one, no more.
--    Mirrors ensure_booking_seats — security definer, service-role only, called
--    after the route has checked the caller owns the order.
create or replace function public.ensure_order_seats(p_order uuid, p_inviter uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_cap    integer;
    v_minted integer;
begin
    select greatest(0, coalesce(attendees, 1) - 1) into v_cap
      from public.service_orders where id = p_order;

    with want as (
        select generate_series(1, v_cap) as idx
    ),
    ins as (
        insert into public.booking_guests (order_id, seat_index, invited_by)
        select p_order, w.idx, p_inviter
          from want w
         where not exists (
                 select 1 from public.booking_guests bg
                  where bg.order_id = p_order
                    and bg.seat_index = w.idx
                    and bg.status <> 'removed'
             )
        on conflict (order_id, seat_index) where (order_id is not null and status <> 'removed') do nothing
        returning 1
    )
    select count(*) into v_minted from ins;

    return coalesce(v_minted, 0);
end;
$fn$;

revoke all on function public.ensure_order_seats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_order_seats(uuid, uuid) to service_role;
