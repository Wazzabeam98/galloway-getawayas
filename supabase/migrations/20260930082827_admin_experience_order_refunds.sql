-- An admin refunding all or part of an experience order.
--
-- Two things, both service-role only:
--
-- 1. service_order_refunds — one row per admin refund, written BEFORE the money
--    moves and completed after it. It is three things at once:
--
--      * THE IDEMPOTENCY ANCHOR. The row's id is generated here, by the
--        database, and the Stripe idempotency key is built from it
--        ('admin-exp-refund-' + id). Nothing a retry or a browser can reset is
--        in the key: the id exists once, is written before Stripe is called,
--        and is never reused.
--      * THE DOUBLE-CLICK WALL. At most one refund per order may be 'pending'
--        (unique partial index below). A second click that lands while the
--        first is still at Stripe cannot insert its row, so it cannot reach
--        Stripe at all.
--      * THE AUDIT TRAIL. Who refunded what, why, when, which way the money
--        went (held/direct, before/after payout), the Stripe refund id, the
--        reversal and any shortfall. admin_actions is listing-shaped (its
--        listing_id and action list are about moderating listings), so an
--        order refund gets its own trail rather than a row that half-fits.
--
--    order_id and admin_id are copied in, not foreign keys — the same call
--    admin_actions made for host_id. A money trail has to outlive the rows it
--    describes (and the seed scripts' resets, which delete orders and users).
--
-- 2. record_order_refund(order, amount) — adds to service_orders.amount_refunded
--    under a row lock, clamped at what was paid, and returns how much actually
--    fit. The order twin of record_booking_refund: two refunds landing together
--    SUM rather than the later one overwriting the figure the earlier one read.
--
-- Safe to run twice.

create table if not exists public.service_order_refunds (
    id               uuid primary key default gen_random_uuid(),
    order_id         uuid not null,
    provider_id      uuid,
    admin_id         uuid not null,

    -- What the admin asked to refund, in pounds, and why (typed at the time;
    -- the same rule the form and the route share, lib/adminOrderRefund.ts).
    amount           numeric not null check (amount > 0),
    reason           text not null check (btrim(reason) <> ''),

    -- Which way the order's money went, and whether the provider had already
    -- been paid when this refund was made — decides where the money came from.
    funds_flow       text not null check (funds_flow in ('direct', 'held')),
    after_payout     boolean not null default false,

    -- What Stripe said had already been refunded on the charge when this
    -- request was made, in pounds. Evidence, not arithmetic.
    refunded_before  numeric not null default 0,

    status           text not null default 'pending'
        check (status in ('pending', 'succeeded', 'failed', 'abandoned')),

    stripe_refund_id text,
    -- The transfer reversal: a direct order's refund reverses the provider's
    -- transfer itself; a held order paid out is clawed back after the refund.
    reversal_id      text,
    reversed         numeric not null default 0,
    -- What could not be pulled back from the provider's Stripe balance —
    -- recorded on the order (payout_clawback_owed) and emailed to the directors.
    shortfall        numeric not null default 0,
    error            text,

    created_at       timestamptz not null default now(),
    completed_at     timestamptz
);

create unique index if not exists service_order_refunds_one_in_flight
    on public.service_order_refunds (order_id)
    where status = 'pending';

create index if not exists service_order_refunds_order_idx
    on public.service_order_refunds (order_id, created_at desc);

alter table public.service_order_refunds enable row level security;
revoke all on public.service_order_refunds from anon, authenticated;
grant all on public.service_order_refunds to service_role;

comment on table public.service_order_refunds is
    'An admin refund of an experience order: written before the money moves (its id is the Stripe '
    'idempotency key, and only one may be pending per order), completed after. The audit trail of '
    'who refunded what, why and when. Service role only.';

create or replace function public.record_order_refund(
    p_order  uuid,
    p_amount numeric
)
returns table (
    new_amount_refunded numeric,
    price               numeric,
    applied             numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    old_refunded numeric;
    v_price      numeric;
    v_new        numeric;
begin
    -- A second refund on the same order waits here until this one has written.
    select round(coalesce(o.amount_refunded, 0), 2), round(coalesce(o.price, 0), 2)
      into old_refunded, v_price
      from public.service_orders o
     where o.id = p_order
       for update;

    if not found then
        return;
    end if;

    -- Never above what was paid; a bad negative can never pull it below what
    -- has already gone back.
    v_new := least(v_price, round(old_refunded + p_amount, 2));
    if v_new < old_refunded then
        v_new := old_refunded;
    end if;

    update public.service_orders o
       set amount_refunded = v_new
     where o.id = p_order;

    new_amount_refunded := v_new;
    price               := v_price;
    applied             := round(v_new - old_refunded, 2);
    return next;
end;
$fn$;

-- SECURITY DEFINER functions are granted to PUBLIC by default. amount_refunded is
-- a money column the browser cannot touch; the function that writes it is the
-- same. Only the service-role admin route calls it.
revoke all on function public.record_order_refund(uuid, numeric) from public;
revoke all on function public.record_order_refund(uuid, numeric) from anon;
revoke all on function public.record_order_refund(uuid, numeric) from authenticated;

notify pgrst, 'reload schema';
