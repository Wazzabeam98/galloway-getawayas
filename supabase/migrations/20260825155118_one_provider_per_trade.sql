-- One business per trade, per person.
--
-- Somebody in Galloway may well run a cleaning firm and a window cleaning
-- round. They are different trades, so `trade` is enough to tell them apart
-- and the application can stay keyed on (owner, trade) rather than needing a
-- provider id in every URL. Two separate cleaning firms is not a case worth
-- carrying the extra routing for; if it ever arrives, this constraint is what
-- would be dropped.
--
-- The constraint is the point, not the multiple-business support. `owner_id`
-- had an index and no uniqueness, so a duplicate row was possible — and both
-- client pages read with maybeSingle(), which does not return the first row
-- when there are two, it errors. A duplicate therefore broke the picker and
-- the application outright rather than degrading. Better an impossible state
-- than a page that dies.
--
-- If this fails with a uniqueness violation, there are already duplicates.
-- Find them before deciding which to keep — do not guess:
--
--   select owner_id, trade, count(*), array_agg(id order by created_at)
--     from public.service_providers
--    group by owner_id, trade having count(*) > 1;
--
-- Pre-flight:
--   select conname from pg_constraint
--    where conname = 'service_providers_owner_trade_key';
--
-- Safe to run twice. Run on test first, then production.

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_owner_trade_key'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_owner_trade_key" unique ("owner_id", "trade");
    end if;
end $$;
