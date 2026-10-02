-- The adults/children split on a booked experience.
--
-- A HEADCOUNT split for the provider's benefit — how many towels, how many in the
-- barrel — NOT a pricing tier: every seat costs the same. The authoritative total
-- for money stays exactly where it was (attendees for a private session, quantity
-- for a per-person one); these two columns only record how that total breaks down.
--
-- Backfilled as NULL, deliberately, not "all adults": no split was recorded for a
-- pre-existing order and a guess would be indistinguishable from a real all-adult
-- party later. NULL means "not recorded".

alter table public.service_orders add column if not exists adults integer;
alter table public.service_orders add column if not exists children integer;

-- Both null (no split recorded), or a real split: at least one adult, children
-- non-negative, and — when there is an authoritative headcount on the row — the
-- split sums to it. coalesce(attendees, quantity) is that headcount: a private
-- session carries it in attendees, a per-person one in quantity. The money total
-- is never read FROM the split; this only stops the two disagreeing.
alter table public.service_orders drop constraint if exists service_orders_party_split;
alter table public.service_orders add constraint service_orders_party_split check (
    (adults is null and children is null)
    or (
        adults >= 1 and children >= 0
        and (coalesce(attendees, quantity) is null or adults + children = coalesce(attendees, quantity))
    )
);

comment on column public.service_orders.adults is
    'Party split: adults (13+). NULL = no split recorded. adults+children equals the money headcount (coalesce(attendees, quantity)); the split is never the source of the money total.';
comment on column public.service_orders.children is
    'Party split: children (4-12). NULL = no split recorded. Same seat price as an adult — a headcount detail for the provider, not a pricing tier.';
