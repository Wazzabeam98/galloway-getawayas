-- The order freezes the fulfilment DIRECTION it was booked at.
--
-- WHY. What a guest bought must not change when the provider edits their setup —
-- the same rule that already freezes item_name, unit_price, price and the slot
-- duration onto the order. Until now the order page re-derived "where" from the
-- provider's CURRENT fulfilment (app/experiences/order/[orderId]/page.tsx): an
-- order booked come-to-me flipped to "comes to your cottage" the moment the
-- provider switched to travelling, silently rewriting a past booking's
-- arrangement. Same class as the duration bug.
--
-- WHAT IS AND ISN'T FROZEN. Only the DIRECTION (delivery / collection / both) is
-- snapshotted — the arrangement the guest agreed to. The collection ADDRESS is
-- deliberately NOT frozen: it stays live from the provider, because if the studio
-- moves the guest must be told where to actually turn up, not sent to a stale
-- address. Freeze the deal, not the mutable operational detail.
--
-- NULL is a real value here: a slot whose provider never set a direction reads as
-- come-to-me exactly as it does today (null is not 'delivery'). For a SLOT the
-- read side now uses ONLY this frozen column, never the provider's live one, so a
-- later provider edit cannot reach a booked slot. A made-to-order product still
-- reads the provider's live fulfilment for now — its freeze is a follow-up (it is
-- written in the Stripe webhook, a watched money path) — but this column is
-- backfilled for those rows too, so that piece needs no second migration.
--
-- service_orders is written by the service role (the slot claim and the Stripe
-- webhook) and revoked from anon/authenticated (read via the service role only),
-- so this column is non-browser-facing and needs no grant. TEST ONLY until it
-- ships — must not merge to master until it is on production (the deploy-time
-- gate enforces that; preview builds fail open).

alter table public.service_orders
    add column if not exists fulfilment text
        check (fulfilment is null or fulfilment in ('delivery', 'collection', 'both'));

comment on column public.service_orders.fulfilment is
    'The fulfilment DIRECTION the order was booked at, frozen like price/duration: '
    '''delivery'' = the provider travels to the cottage, ''collection''/''both'' = '
    'come-to-me. Read INSTEAD of the provider''s live fulfilment so a later setup '
    'edit never rewrites a booked order. The address itself is NOT frozen (it stays '
    'live so a moved studio still directs the guest correctly). NULL = come-to-me.';

-- Backfill existing rows from the provider's CURRENT direction. That is the only
-- direction these orders were ever booked at — fulfilment did not vary per order
-- before this column existed — so it is the honest snapshot for history. New rows
-- are frozen at booking by the claim and the webhook, not here.
update public.service_orders o
   set fulfilment = p.fulfilment
  from public.service_providers p
 where o.provider_id = p.id
   and o.fulfilment is null
   and p.fulfilment is not null;

-- PostgREST caches the schema; the new column is invisible over the API (written
-- and read under the service role) until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name='service_orders' and column_name='fulfilment';
--   select count(*) filter (where fulfilment is not null) as frozen,
--          count(*) as total from public.service_orders;
