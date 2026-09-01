-- A photo and a unit on every menu item.
--
-- TWO GAPS THIS CLOSES
--
-- 1. A PHOTO PER ITEM. A guest provider's photos used to live in a single
--    provider gallery, separate from the item list — so a baker's eight cakes
--    and their eight prices sat in two places and a guest could not tell which
--    picture was the £45 one. The photo belongs ON the item. The provider
--    gallery folds into this: the item photos ARE the gallery now.
--
-- 2. A UNIT PER ITEM, AND IT MULTIPLIES. "£45" on its own says nothing — per
--    person, per night, per hour, per ticket, per item. A chef charges per head,
--    a guide per person, a baker per cake. So each item carries a unit, and for
--    every unit except 'flat' the guest picks a quantity and the charge is
--    unit price × quantity. 'flat' is the set-price case (a chef who prices the
--    whole evening): no quantity, charged once.
--
-- WHAT THE ORDER KEEPS. The order already snapshots the item's name, price and
-- description so editing the live menu never rewrites a placed order. It now
-- also snapshots the unit, the per-unit price and the quantity, for the same
-- reason: what the guest agreed to and what the provider is turning up to must
-- outlive any later edit. `price` stays the TOTAL actually charged.

-- --------------------------------------------------------------------------
-- The item: a photo and a unit.
-- --------------------------------------------------------------------------
alter table public.service_provider_items
    -- One storage path, the same owner-prefixed bucket the gallery used.
    add column if not exists image text,
    -- 'flat' | 'person' | 'night' | 'hour' | 'ticket' | 'item'. Defaulted to
    -- 'flat' so every existing item keeps charging its one price exactly as
    -- before — a silent behaviour change on live items is the thing to avoid.
    add column if not exists unit text not null default 'flat';

-- --------------------------------------------------------------------------
-- The order: snapshot the unit, the per-unit price and the quantity.
-- --------------------------------------------------------------------------
alter table public.service_orders
    -- How many units this order was for. 1 for a flat item, or the number the
    -- guest chose. Defaulted to 1 so every existing order reads as "one of".
    add column if not exists quantity integer not null default 1,
    -- The unit at the moment of purchase, frozen like the name and description.
    add column if not exists item_unit text,
    -- The per-unit price, frozen. price / quantity, kept explicitly so the
    -- provider's "6 × £30" reads back without a division that could drift.
    add column if not exists unit_price numeric;

-- Backfill the per-unit price for orders placed before this column existed.
-- They were all single-unit, so the per-unit price is simply the total.
update public.service_orders
   set unit_price = price
 where unit_price is null;

comment on column public.service_provider_items.unit is
    'How the price is charged: flat (once), or per person/night/hour/ticket/item '
    '(multiplied by a quantity the guest picks). See lib/serviceOrders.ts.';
comment on column public.service_orders.quantity is
    'Units bought — 1 for a flat item, else the guest''s chosen count. '
    'price is the total; unit_price is price / quantity, both snapshotted.';
