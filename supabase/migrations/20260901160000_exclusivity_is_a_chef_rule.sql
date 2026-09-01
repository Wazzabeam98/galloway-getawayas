-- One-per-date is a CHEF rule, not a guest-trade rule.
--
-- 20260901120000 added a partial unique index that refused a second live order
-- for the same provider on the same date. That is right for a chef — they cook
-- one evening and cannot be in two cottages at once — but wrong for every other
-- guest trade. A baker can bake five cakes for one Saturday; a hamper maker can
-- make ten. Under the old index the second guest ordering a cake for a date
-- another guest already took was rejected, and the baker quietly lost the order.
--
-- So the exclusivity is scoped to the one trade it is true for. The predicate
-- here matches exclusivePerDate() in lib/serviceOrders.ts and the order route's
-- clash pre-check — if the exclusive-trade list ever grows, all three move
-- together.
--
-- Lands on test first, then production. Dropping the old index and adding the
-- narrower one changes no row; it only widens what is allowed (a non-chef can
-- now hold two orders for a date), so nothing that was valid becomes invalid.

drop index if exists public.service_orders_one_live_per_provider_date;

create unique index if not exists service_orders_one_chef_booking_per_date
    on public.service_orders (provider_id, service_date)
    where status in ('authorised', 'confirmed') and trade = 'chef';

comment on index public.service_orders_one_chef_booking_per_date is
    'One live order per CHEF per date (chef only — a baker/hamper can fulfil '
    'many per date). Live = authorised or confirmed. See exclusivePerDate() in '
    'lib/serviceOrders.ts and the order route pre-check.';
