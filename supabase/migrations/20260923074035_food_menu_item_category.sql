-- A menu section (category) per made-to-order item.
--
-- A made-to-order listing (a baker's) reads like a food-ordering site, and once a
-- menu grows past a handful of items a guest wants it grouped — "Cakes",
-- "Traybakes & boxes" — with sticky tabs that jump between the groups. This is
-- that grouping: a free-text section name the provider types per item in the
-- listing editor. Null when they've left it blank, in which case the item sits in
-- an unnamed group and no tabs show. Only meaningful for a made-to-order menu;
-- harmless (null) on every other shape's items.
alter table public.service_provider_items
    add column if not exists category text;

notify pgrst, 'reload schema';
