-- A price that isn't always one number.
--
-- experience offerings have carried a single `price`. A real provider asked for
-- two more shapes, because their work doesn't have one price:
--   - a RANGE: "£475–£675 depending on numbers" — a min and a max, shown as a
--     range, agreed with the provider;
--   - PRICE ON ENQUIRY: no figure up front at all; the guest asks and the
--     provider quotes.
--
-- WHAT THIS ADDS. Two nullable/defaulted columns on service_provider_items:
--   - price_mode: 'fixed' (today's behaviour, the default — every existing row
--     reads exactly as before), 'range', or 'enquiry'.
--   - price_max: the top of a range. Null for fixed and enquiry.
-- `price` keeps its meaning: the single figure for 'fixed', the FROM figure for
-- 'range', and ignored for 'enquiry' (where it is left at 0, since the column is
-- NOT NULL and nothing reads it in that mode).
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE. Only FIXED offerings are instant-booked
-- and reach an order; a range or enquiry offering is shown on the listing with a
-- "Message the provider" path instead, so the order snapshot (service_orders) is
-- untouched and no money maths changes. lib/pricing.ts is not involved — this is
-- the experience side.
--
-- GRANTS. service_provider_items is owner-managed under RLS (owner_id = auth.uid()
-- via the provider), table-granted to anon/authenticated/service_role, so a new
-- column is writable by the owner and readable publicly the same as name/price/
-- unit — no allow-list entry needed (same as the capacity/min columns).
--
-- Additive and idempotent. Lands on PRODUCTION first, then test, then the code.

alter table "public"."service_provider_items"
    add column if not exists "price_mode" text not null default 'fixed'
        check ("price_mode" in ('fixed', 'range', 'enquiry')),
    add column if not exists "price_max" numeric
        check ("price_max" is null or "price_max" >= 0);

-- A range's top must be at or above its from-price. Enforced only for a real
-- range (both numbers present); fixed/enquiry leave price_max null and are
-- unaffected. Named so a re-run can find and skip it.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'service_provider_items_price_max_ge_price'
    ) then
        alter table "public"."service_provider_items"
            add constraint "service_provider_items_price_max_ge_price"
            check ("price_max" is null or "price_max" >= "price");
    end if;
end $$;

-- PostgREST caches the schema; the new columns are invisible over the API until
-- it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'service_provider_items'
--      and column_name in ('price_mode', 'price_max');
--   -- price_mode: NOT NULL default 'fixed'; price_max: nullable, no default.
