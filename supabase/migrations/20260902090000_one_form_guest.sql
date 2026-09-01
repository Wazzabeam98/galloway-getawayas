-- One form for anyone: 'other' becomes the only guest shape, renamed 'guest'.
--
-- See GUEST-EXPERIENCES-ONE-FORM.md. Guest providers stop picking a category
-- from a preset list; they describe a business and the owner assigns the
-- category (word + Stripe code + exclusivity) at review. That is exactly what
-- 'other' already did, so this makes 'other' the ONLY guest trade and renames
-- it 'guest' — a word that means something now that everyone is it.
--
-- WHAT THIS PRESERVES
--
-- Every existing guest provider relied on its fixed trade for three things: the
-- word a guest reads (tradeLabel), the Stripe code we charge under (TRADE_MCC),
-- and — for a chef — holding a date exclusively (exclusivePerDate). The trade
-- value is about to stop meaning any of that, so all three are carried onto the
-- row FIRST, then the trade is set to 'guest'. An 'other' provider already
-- carries its own custom_label/stripe_mcc and keeps them untouched (coalesce
-- leaves a value that is already there).
--
-- Production has zero guest providers, so the data update below is a no-op
-- there; it does its work on test, where the chef and baker demos live.
--
-- LOSES NO DATA: adds two columns, rekeys one index off a column that means the
-- same thing, and rewrites the `trade` value of guest rows only. Nothing that
-- was valid becomes invalid — the new index allows a superset of the old.

-- ---------------------------------------------------------------------------
-- 1. Exclusivity becomes a flag, not a hardcoded trade.
-- ---------------------------------------------------------------------------

-- On the provider: the thing the owner sets at review. A private chef or a
-- masseur holds a date; a baker does not.
alter table public.service_providers
    add column if not exists exclusive_per_date boolean not null default false;

-- Snapshotted onto the order the same way `trade` is, because the partial unique
-- index that enforces one-per-date can only see its own table's columns.
alter table public.service_orders
    add column if not exists exclusive_per_date boolean not null default false;

comment on column public.service_providers.exclusive_per_date is
    'Owner-set at review: this provider holds a cottage-date exclusively (a chef, '
    'a masseur), so a second live order for the date is refused. Replaces the '
    'hardcoded trade = ''chef'' rule. Snapshotted onto service_orders.';

-- ---------------------------------------------------------------------------
-- 2. Carry each existing guest provider's category onto the row, then rename.
-- ---------------------------------------------------------------------------

update public.service_providers sp set
    custom_label = coalesce(nullif(btrim(sp.custom_label), ''),
        case sp.trade
            when 'chef'   then 'Private chef'
            when 'cake'   then 'Cakes & baking'
            when 'basket' then 'Hampers & shopping'
        end),
    stripe_mcc = coalesce(nullif(btrim(sp.stripe_mcc), ''),
        case sp.trade
            when 'chef'   then '5811'
            when 'cake'   then '5462'
            when 'basket' then '5411'
        end),
    stripe_product_description = coalesce(nullif(btrim(sp.stripe_product_description), ''),
        case sp.trade
            when 'chef'   then 'Private chef and in-home dining for holiday guests.'
            when 'cake'   then 'Cakes and baking for holiday guests.'
            when 'basket' then 'Welcome hampers and shopping for holiday guests.'
        end),
    exclusive_per_date = (sp.trade = 'chef'),
    trade = 'guest'
where sp.audience = 'guest';

-- Existing orders carry the same exclusivity the old index enforced (chef orders
-- were exclusive; nothing else was), so the rekeyed index behaves identically
-- for anything already in flight.
update public.service_orders set exclusive_per_date = true
where trade = 'chef';

-- ---------------------------------------------------------------------------
-- 3. Rekey the exclusivity index off the flag.
-- ---------------------------------------------------------------------------

drop index if exists public.service_orders_one_chef_booking_per_date;

create unique index if not exists service_orders_one_exclusive_booking_per_date
    on public.service_orders (provider_id, service_date)
    where status in ('authorised', 'confirmed') and exclusive_per_date;

comment on index public.service_orders_one_exclusive_booking_per_date is
    'One live order per exclusive provider per date (a chef/masseur, not a '
    'baker). Live = authorised or confirmed. Keyed on the snapshotted '
    'exclusive_per_date flag; see exclusivePerDate() in lib/serviceOrders.ts '
    'and the order route pre-check.';
