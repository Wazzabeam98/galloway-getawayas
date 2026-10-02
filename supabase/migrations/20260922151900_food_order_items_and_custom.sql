-- Made-to-order food orders: a cart of items, and standard-vs-custom items.
--
-- Two changes on PR #173:
--
--  1. service_provider_items.is_custom — a made-to-order provider marks each item
--     STANDARD (off-the-shelf, books and charges instantly) or CUSTOM (needs the
--     provider to agree, so the whole order is held as a request). Null/false is
--     standard, the safe default; only a made-to-order provider sets it.
--
--  2. service_orders.line_items — a made-to-order order is now a CART: several
--     items, each with a quantity, in one order and one payment. The lines are
--     frozen here as [{item_id, name, unit, qty, unit_price, line_total, is_custom}]
--     so the order page, the breakdown and the provider both read exactly what was
--     ordered without re-pricing. Null on a single-item order (every other shape).
alter table public.service_provider_items
    add column if not exists is_custom boolean not null default false;

alter table public.service_orders
    add column if not exists line_items jsonb;

notify pgrst, 'reload schema';
