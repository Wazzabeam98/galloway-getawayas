-- One offering, two prices: a place each, or the whole session for one group.
--
-- A provider who sells both — a sauna round at £18 a person, or the whole barrel
-- for one group at £90 — used to have to create the experience twice: one
-- offering priced per person, another priced per group, each with its own name,
-- description and photo. They are one experience priced two ways (Liam, 9 Oct
-- 2026), the way Airbnb has a price per guest and a private-group price on the
-- same experience.
--
-- WHAT THIS ADDS. One nullable column on service_provider_items:
--   - group_price: on a PER-PERSON offering, the price for one group to book the
--     whole session (or, for a provider who comes to the guest, the whole
--     booking). The group pays it in full however many come, up to the maximum.
--     Null = the offering is sold per person only (every existing row reads
--     exactly as before).
-- Only meaningful when unit = 'person'; the save route writes null otherwise.
-- Unlike Airbnb's "private group minimum" it is a fixed price, not a floor.
--
-- MONEY. A group booking of such an offering is snapshotted on the order as a
-- whole-group hire — item_unit 'flat', unit_price = group_price, quantity 1 — so
-- every later step (cancellation, refunds, changing the head count, the provider
-- panel) reads it exactly like a booking of a per-group offering today.
--
-- GRANTS. service_provider_items is owner-managed under RLS, table-granted to
-- anon/authenticated/service_role, so the new column is readable publicly and
-- writable by the owner the same as price/unit — no allow-list entry needed.
--
-- Additive and idempotent. Lands on PRODUCTION first, then test, then the code.

alter table "public"."service_provider_items"
    add column if not exists "group_price" numeric
        check ("group_price" is null or "group_price" > 0);

notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_provider_items'
--      and column_name = 'group_price';
