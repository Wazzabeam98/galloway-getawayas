-- A flat delivery fee for a provider that travels to the guest.
--
-- A made-to-order baker (or any provider that delivers) can charge one flat fee
-- for delivering an order, added once to a delivery order's total — collection
-- pays nothing extra. Pounds, like every other price on the provider; 0/null when
-- they deliver free or don't deliver at all. The basket adds it when delivery is
-- chosen, the order route charges it as its own line, and it's frozen onto the
-- order alongside the item lines.
alter table public.service_providers
    add column if not exists delivery_fee numeric(10,2) not null default 0;

notify pgrst, 'reload schema';
