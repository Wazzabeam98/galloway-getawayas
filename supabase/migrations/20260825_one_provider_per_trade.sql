-- One listing per trade, per business.
--
-- Somebody in Galloway may well run a cleaning firm and a window cleaning
-- round, or plumb on Monday and joiner on Tuesday. Those are different trades,
-- so `trade` is enough to tell their listings apart and the sign-up can stay
-- keyed on the trade rather than needing a listing id in every URL.
--
-- Two separate cleaning firms under one login is not a case worth carrying the
-- extra routing for; if it ever arrives, this constraint is what would be
-- dropped, along with `service_businesses_owner_key`.
--
-- The constraint is the point, not the multiple-trade support — that comes
-- free from the row being per trade. `business_id` had an index and no
-- uniqueness, so a duplicate row was possible — and both client pages read
-- with maybeSingle(), which does not return the first row when there are two,
-- it errors. A duplicate therefore broke the picker and the application
-- outright rather than degrading. Better an impossible state than a page that
-- dies.
--
-- If this fails with a uniqueness violation, there are already duplicates.
-- Find them before deciding which to keep — do not guess:
--
--   select business_id, trade, count(*), array_agg(id order by created_at)
--     from public.service_providers
--    group by business_id, trade having count(*) > 1;
--
-- Pre-flight:
--   select conname from pg_constraint
--    where conname = 'service_providers_business_trade_key';
--
-- Safe to run twice. Run on test first, then production.

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_business_trade_key'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_business_trade_key" unique ("business_id", "trade");
    end if;
end $$;
