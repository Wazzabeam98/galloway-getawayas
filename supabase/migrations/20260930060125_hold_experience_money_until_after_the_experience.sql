-- Hold experience money until after the experience, the way a stay is held.
--
-- WHAT CHANGES
--
-- Until now an experience charge was a DESTINATION charge: on_behalf_of the
-- provider, transfer_data.destination = the provider, our 10% as an
-- application fee. The provider's 90% landed in their own Stripe balance the
-- moment the card was captured (on confirm, or at once for a slot), and Stripe
-- paid it out on the provider's schedule. If they then did not turn up, the
-- money was already theirs and a refund had to pull it back out of them.
--
-- From this change a new order is still made on_behalf_of the provider — they
-- stay the seller, and their name is on the guest's statement — but with no
-- transfer_data and no application fee. The whole amount sits on the Galloway
-- Getaways balance until the day after the experience, when the
-- experience-payouts run transfers `total − 10%` to the provider (drawn on the
-- order's own charge, `source_transaction`), exactly as a host is paid the day
-- after check-in. A refund before that is simply a refund from us; there is
-- nothing to reverse.
--
-- WHY A PER-ORDER MARKER, NOT A DATE
--
-- Every order already paid (or held, or part-way through Checkout) was made
-- under the old flow, and its money has gone — or will go, on capture — straight
-- to the provider. Those orders must never be paid a second time by the new run,
-- and must keep refunding the old way (refund_application_fee + reverse_transfer).
-- So each order says which flow its money took, and every money path branches
-- on it:
--
--   funds_flow = 'direct'  destination charge; provider paid by Stripe at capture
--   funds_flow = 'held'    on_behalf_of only (no transfer); provider paid by the payout run
--
-- The DEFAULT IS 'direct' ON PURPOSE. This migration reaches production before
-- the code that writes 'held' (the house rule), and until that code deploys
-- every order written is still a destination charge — so a row that says
-- nothing must mean 'direct'. Only the new code, creating a held charge in
-- the same breath, writes 'held'. That also backfills every existing row to
-- 'direct' with no UPDATE to run.
--
-- Safe to run twice.

alter table public.service_orders
    add column if not exists funds_flow text not null default 'direct',
    -- Our fee on this order in POUNDS, frozen when the charge is created — the
    -- figure that used to be the application fee. The payout is the charge less
    -- this, so a provider is paid exactly what the old flow would have left
    -- them (commission on items only, never on a delivery fee).
    add column if not exists platform_fee numeric,
    -- The payout the run made. paid_out_at is the run's "done" stamp; the
    -- transfer id is what a later refund reverses.
    add column if not exists paid_out_at timestamptz,
    add column if not exists payout_amount numeric,
    add column if not exists payout_transfer_id text,
    -- How much of that payout has been pulled back by a refund after it went.
    add column if not exists payout_reversed numeric not null default 0,
    -- What a refund after payout could NOT pull back from the provider's
    -- Stripe balance — owed to us, and reported to the directors.
    add column if not exists payout_clawback_owed numeric not null default 0;

alter table public.service_orders
    drop constraint if exists service_orders_funds_flow_check;
alter table public.service_orders
    add constraint service_orders_funds_flow_check
        check (funds_flow in ('direct', 'held'));

-- Only a held order is ever paid out by us.
alter table public.service_orders
    drop constraint if exists service_orders_payout_only_when_held;
alter table public.service_orders
    add constraint service_orders_payout_only_when_held
        check (paid_out_at is null or funds_flow = 'held');

-- One transfer pays one order, never two.
create unique index if not exists service_orders_payout_transfer_once
    on public.service_orders (payout_transfer_id)
    where payout_transfer_id is not null;

-- What the payout run reads every day.
create index if not exists service_orders_held_awaiting_payout
    on public.service_orders (service_date)
    where funds_flow = 'held' and paid_out_at is null;

-- THE WALL: neither the flow nor a payout can be undone by a later write.
--
-- A 'direct' order flipped to 'held' would be paid a second time by the run; a
-- paid_out_at cleared would do the same. Both are refused in the database, so no
-- route, script or hand edit can reset them. (The flow may still be set while
-- the order has no PaymentIntent — a slot hold is written a moment before its
-- Checkout — but never once money is attached.)
create or replace function public.service_orders_money_is_final()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
    if new.funds_flow is distinct from old.funds_flow
       and old.stripe_payment_intent_id is not null then
        raise exception 'service_orders.funds_flow cannot change once a payment is attached (order %)', old.id;
    end if;
    if old.paid_out_at is not null and (
           new.paid_out_at is null
        or new.payout_transfer_id is distinct from old.payout_transfer_id
        or new.payout_amount is distinct from old.payout_amount
    ) then
        raise exception 'service_orders payout is final once made (order %)', old.id;
    end if;
    return new;
end;
$fn$;

drop trigger if exists service_orders_money_is_final on public.service_orders;
create trigger service_orders_money_is_final
    before update on public.service_orders
    for each row execute function public.service_orders_money_is_final();

comment on column public.service_orders.funds_flow is
    'Which way this order''s money went. direct = destination charge (on_behalf_of + '
    'transfer_data), provider paid by Stripe at capture, refunds reverse the transfer; '
    'every order before 30 Sep 2026. held = charge on_behalf_of the provider (still the '
    'seller) with no transfer, money held by Galloway Getaways until the day after '
    'service_date, paid by /api/cron/experience-payouts. '
    'Default direct so a row written by pre-change code is never paid twice.';
comment on column public.service_orders.platform_fee is
    'Our fee in pounds, frozen at charge time (was the application fee). Held orders only.';
comment on column public.service_orders.paid_out_at is
    'When the experience-payouts run transferred the provider''s share. Final once set.';

notify pgrst, 'reload schema';
