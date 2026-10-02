-- Per-item location — a slot provider who runs BOTH studio sessions and
-- travelling sessions on one listing.
--
-- WHAT. Today "Where does it happen?" (g_slot_where) is one provider-level
-- answer: come-to-me (fulfilment='collection') OR travel (fulfilment='delivery').
-- A yoga teacher with studio classes AND cottage 1:1s has to pick one. This adds
-- a third answer, 'both' (a value the fulfilment column already allows), and with
-- it the location becomes a PER-ITEM question: this class is at my studio, that
-- session is at yours.
--
-- HOW. A new nullable `fulfilment` on service_provider_items:
--   NULL       — inherit the provider's single-place answer (every provider who
--                picks one place, and every existing row — unchanged).
--   'collection' — this item happens at the provider's place (studio).
--   'delivery'   — this item is travelled to the guest's cottage.
-- Only a provider whose service_providers.fulfilment = 'both' sets it per item.
--
-- WHY IT REUSES THE fulfilment VOCABULARY. The order already freezes a single
-- direction (service_orders.fulfilment). For a 'both' provider the booked item's
-- direction is what the order should freeze, so the item speaks the same three
-- words the provider and order already do — the booking resolves
-- item.fulfilment ?? provider.fulfilment and freezes that, no new vocabulary.
--
-- THE RULE THAT RIDES ALONG (enforced in the wizard + booking, noted here):
-- a TRAVELLING item is always PRIVATE — one group at one fixed price whoever
-- turns up, no capacity cap — because nobody joins a class held in someone else's
-- cottage. A STUDIO item may be shared or private. So a delivery item is always
-- unit='flat'; the check below encodes that so a bad row can't be written.
--
-- GRANTS. service_provider_items is granted to the roles and public-read for
-- approved providers (RLS), so a new column is writable by the owner and readable
-- by the guest with no extra grant — same as duration_minutes (20260913210406).
--
-- TEST ONLY until it ships. Additive and idempotent; safe to run twice.

alter table public.service_provider_items
    add column if not exists fulfilment text
        check (fulfilment is null or fulfilment in ('collection', 'delivery'));

comment on column public.service_provider_items.fulfilment is
    'Per-item location for a provider whose service_providers.fulfilment = ''both'': '
    '''collection'' = at the provider''s place, ''delivery'' = travelled to the '
    'guest''s cottage. NULL = inherit the provider''s single-place answer (every '
    'one-place provider and every pre-existing row). A ''delivery'' item is always '
    'private (unit=''flat''); the booking freezes item.fulfilment ?? provider one '
    'onto the order.';

-- PostgREST caches the schema; the new column is invisible over the API until it
-- reloads. (service_provider_items is written by the owner and read by guests.)
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name='service_provider_items' and column_name='fulfilment';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.service_provider_items'::regclass and conname like '%fulfilment%';
