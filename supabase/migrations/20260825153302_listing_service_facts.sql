-- The two facts about a property that only the services side needs.
--
-- Both are answered once by the host and never again. Neither can be derived:
-- `bedrooms` is already on the listing and carries the cleaning and waste
-- bands for free, but nothing on here says how big the garden is or how high
-- the windows go.
--
--   plot_band    gardening prices by plot, because bedrooms tell you nothing
--                about a garden — a two-bed cottage can sit in an acre. Added
--                in 20260825022434_service_pricing.sql, where nothing wrote it.
--   storey_band  window cleaning prices by how high the windows go, because
--                ladder work is the cost driver.
--
-- Both are one choice from three, with the options worded as physical things
-- rather than as sizes, so that two hosts reading them mean the same thing.
-- "Medium garden" and "two storeys" are both read differently by different
-- people; "about the size of a tennis court" and "upstairs windows need a
-- ladder" are not.
--
-- Per-pane pricing for windows was considered and rejected: a six-over-six
-- sash is one window and twelve panes, which is a factor-of-six disagreement
-- nobody discovers until somebody is standing in the garden. It would also
-- have been the only place on the site where a host has to go outside and
-- count something.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'listings'
--      and column_name in ('plot_band', 'storey_band');
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."listings"
    add column if not exists "storey_band" text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'listings_storey_band_check'
    ) then
        alter table "public"."listings"
            add constraint "listings_storey_band_check"
            check ("storey_band" is null or "storey_band" in ('storeys_one', 'storeys_two', 'storeys_three_plus'));
    end if;
end $$;
