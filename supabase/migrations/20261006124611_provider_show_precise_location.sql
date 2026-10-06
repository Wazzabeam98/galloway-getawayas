-- Airbnb's "Location sharing → Show the precise location" for guest experiences,
-- the same control holiday lets gained in 20261005164016.
--
-- One new column on service_providers:
--   show_precise_location  boolean not null default false
--
-- Off (every existing provider, and every new one until they say otherwise) the
-- public experience map keeps the approximate, jittered pin exactly as now. On,
-- the experience page shows the venue point unjittered. The written collection
-- address is untouched: it still only reaches a guest after a confirmed booking.
--
-- NO BROWSER GRANT. The experience page reads this flag through the service role
-- on the server (lib/experiencesData), and the provider writes it through
-- /api/services/listing/save (service role, ownership-checked), never a browser
-- write. provider_private is a narrow view (id, owner_id, collection_*), so this
-- column is not exposed through it either. It is therefore classified
-- PLATFORM_ONLY in tests/provider-writable-columns-guard.test.ts and revoked /
-- never-browser-read in tests/select-grant-decision-guard.test.ts, mirroring
-- venue_lat / venue_lng.

alter table "public"."service_providers"
    add column if not exists "show_precise_location" boolean not null default false;

-- PostgREST caches the schema; the new column is invisible over the API until
-- it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'service_providers' and column_name = 'show_precise_location';
--   -- expected: boolean, NO, false
--   select count(*) from information_schema.role_column_grants
--    where table_name = 'service_providers' and column_name = 'show_precise_location'
--      and grantee in ('anon', 'authenticated');
--   -- expected: 0
--   select count(*) filter (where show_precise_location) from public.service_providers;
--   -- expected: 0 (nothing changes for any provider)
