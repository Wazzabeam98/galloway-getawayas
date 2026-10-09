-- Per hour: the fewest hours a guest can book an hourly offering.
--
-- Per hour (9 Oct 2026, Liam) is for a provider who comes to the guest — a dog
-- walker, a guide — and multiplies by the HOURS the guest picks, never by the
-- number of people. A provider can set the fewest hours they'll come out for.
--
-- WHAT THIS ADDS. One nullable column on service_provider_items:
--   - min_hours: the smallest number of hours a guest may book. Null = one hour
--     is fine. Only meaningful when unit = 'hour'; the save routes write null
--     otherwise. Capped at 24 — a day — as a sanity bound, not a business rule.
--
-- MONEY. The order route reads it as the floor on the quantity of an hourly
-- booking (quantity = hours), refusing fewer. The order snapshots quantity and
-- unit_price as today, so nothing downstream changes.
--
-- GRANTS. service_provider_items is owner-managed under RLS, table-granted, so
-- the new column is readable publicly and writable by the owner the same as
-- price/unit — no allow-list entry needed.
--
-- Additive and idempotent. Lands on PRODUCTION first, then test, then the code.

alter table "public"."service_provider_items"
    add column if not exists "min_hours" integer
        check ("min_hours" is null or ("min_hours" >= 1 and "min_hours" <= 24));

notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_provider_items'
--      and column_name = 'min_hours';
