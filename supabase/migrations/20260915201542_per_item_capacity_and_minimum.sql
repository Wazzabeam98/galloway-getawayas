-- Per-item seats and minimum — the phased move of a slot's capacity and
-- per-person minimum off the PROVIDER and onto the ITEM that actually uses them.
--
-- WHY. slot_capacity (seats) and slot_min_people (the minimum to run) only mean
-- anything for a PER-PERSON item — seats at a shared table, and how many must
-- book. A whole-session private hire is sold whole whoever comes, so the provider
-- numbers are meaningless for it. A provider offering both (a £40 private hour AND
-- a £20pp seat) has one provider number that is wrong for one of its two items.
--
-- PHASED, NOT A HARD CUT. These columns are NULLABLE. The item value WINS when
-- set; a null item falls back to the provider's slot_capacity / slot_min_people.
-- So nothing changes on day one — every existing item is null and reads the
-- provider value exactly as before — and providers migrate as they edit an item.
-- The seat engine (lib/serviceSlots) is untouched: one resolver, seatConfig(),
-- feeds it the effective value on every surface (panel, book route, diary), so
-- the panel and the route can't drift.
--
-- GRANTS. service_provider_items is owner-managed under RLS (owner_id = auth.uid()
-- via the provider), the same as name/price/unit/duration, so a new column is
-- writable by the owner and needs no allow-list entry. The booking route and the
-- panel read it (the item is already selected there).

alter table "public"."service_provider_items"
    add column if not exists "capacity" integer
        check ("capacity" is null or "capacity" >= 1),
    add column if not exists "min_people" integer
        check ("min_people" is null or "min_people" >= 1);

-- PostgREST caches the schema; the new columns are invisible over the API until
-- it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   select column_name, is_nullable from information_schema.columns
--    where table_name='service_provider_items' and column_name in ('capacity','min_people');
--   -- both nullable; every existing row is null (falls back to the provider).
