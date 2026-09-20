-- Adding guests to a per-person slot booking, as a CHILD order.
--
-- When a guest buys another place on a per-person session they have already
-- booked, we do NOT rewrite the original order's total. We record a second
-- service_orders row — its own charge, its own PaymentIntent, its own seats on
-- the same session — linked to the original by parent_order_id. The whole slot
-- machine is reused verbatim: the seat is claimed by the same compare-and-swap,
-- held 'holding' for the hold window, confirmed by the same webhook, and swept
-- and released if never paid. Per-charge payout and per-charge refund fall out
-- of this for free, which is why it is a row and not a mutated total.
--
-- A top-up is an amendment to the ORDER, not a second booking on the stay, so it
-- carries NO booking_id (parent_order_id is its only link). That is deliberate:
-- it is what makes the two cancel paths — the stay cascade (booking-scoped) and
-- the direct order cancel (single-row) — each have to reach for the family
-- rather than settling one row and leaving the top-up's money and seats behind.

-- 1. The link. Nullable (only a top-up has one); cascades so a deleted parent
--    takes its top-ups with it, mirroring booking_guests.order_id.
alter table public.service_orders
    add column if not exists parent_order_id uuid
        references public.service_orders(id) on delete cascade;

create index if not exists service_orders_parent_order_id
    on public.service_orders (parent_order_id)
    where parent_order_id is not null;

comment on column public.service_orders.parent_order_id is
    'Set on a per-person slot TOP-UP: the original order this added-seats charge '
    'belongs to. Its own row, PaymentIntent, seats and holding→confirmed lifecycle; '
    'the parent''s total is never rewritten. NULL for an original order. A top-up '
    'carries no booking_id — parent_order_id is its only link — so both cancel '
    'paths must settle the whole family, not just the parent row.';

-- 2. The invite cap must read the seats actually PAID FOR across the family.
--
-- ensure_order_seats sized the list at coalesce(attendees, 1) - 1. For a
-- per-person order attendees is NULL (quantity is its head count), so the cap
-- computed to 0 and a per-person order could invite nobody — wrong before
-- top-ups existed, and the thing a bought place must now raise. The head count
-- is coalesce(attendees, sum of confirmed quantity across the order + its
-- top-ups): a private order keeps its attendees, a per-person one totals the
-- confirmed seats of the whole family. The booker holds one place, so the list
-- runs to head - 1. A confirmed top-up raises `sum(quantity)` and so raises the
-- cap on its next mint; nothing else changed.
create or replace function public.ensure_order_seats(p_order uuid, p_inviter uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_head   integer;
    v_cap    integer;
    v_minted integer;
begin
    select coalesce(
             o.attendees,
             (select sum(coalesce(s.quantity, 0))
                from public.service_orders s
               where (s.id = o.id or s.parent_order_id = o.id)
                 and s.status = 'confirmed')
           )
      into v_head
      from public.service_orders o
     where o.id = p_order;

    v_cap := greatest(0, coalesce(v_head, 1) - 1);

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

-- PostgREST caches the schema; the new column is invisible over the API (orders
-- are written under the service role) until it reloads.
notify pgrst, 'reload schema';
