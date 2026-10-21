-- Revoke the vestigial anon INSERT/UPDATE grants on listings and
-- calendar_overrides.
--
-- WHY. Supabase's default "GRANT ALL on a new table" left anon holding INSERT
-- and UPDATE on nearly every column of listings (including street_address,
-- postcode, latitude, longitude, ical_token, commission_rate) and all of
-- calendar_overrides (price_override, is_blocked, …). Not exploitable today —
-- the RLS write policies require auth.uid() = host_id / has_listing_permission,
-- and anon's auth.uid() is null, so every anon POST/PATCH is refused — but the
-- grants should not exist: if an anon-facing write policy were ever added or
-- loosened, these columns (price and commission among them) become writable
-- with no second gate. Audit 2026-10-21, finding F3. Defence in depth.
--
-- Anon KEEPS its SELECT grants (the public grids read listings as the anon
-- role); only the write grants go. authenticated is untouched (addhome drafts,
-- host edits), its writes still gated by RLS.
--
-- PRE-FLIGHT: none. REVOKE loses no data and needs no --destructive.

revoke insert, update on public.listings from anon;
revoke insert, update on public.calendar_overrides from anon;

notify pgrst, 'reload schema';

-- Read back (what to confirm on apply):
--   select table_name, privilege_type, count(*) cols
--     from information_schema.role_column_grants
--    where grantee='anon' and table_name in ('listings','calendar_overrides')
--      and privilege_type in ('INSERT','UPDATE')
--    group by 1,2;
--   -- expected: no rows.
