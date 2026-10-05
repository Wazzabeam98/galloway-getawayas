-- provider venue point: the "Where you'll be" map for every venue provider
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- An experience listing shows a "Where you'll be" map when the provider has a
-- place guests go to (a set-times session, or a made-to-order collection point).
-- The page read the point from a service_areas row with centre_lat/lng — which
-- only the seed scripts ever wrote. A provider who signed up for real typed a
-- postcode that nothing geocoded, so no genuine venue provider ever got a map.
--
-- service_areas was also the wrong home: the sign-up wizard and the listing
-- editor delete and re-insert a provider's areas on every save, so a point kept
-- there would vanish on the next edit, and its town label would show up among a
-- 'both' provider's travel regions.
--
-- So the point lives on the provider row, written only by the server
-- (lib/venuePoint.ts), from the collection postcode's centroid (postcodes.io),
-- ROUNDED TO THREE DECIMAL PLACES — about 110m, the same precision a cottage's
-- public pin uses (listings.approx_latitude). The exact address stays private
-- until a booking is confirmed; the map also jitters the pin.
--
-- Written: after the wizard saves (POST /api/services/venue-point), when the
-- listing editor saves the address, and on admin approval for any provider
-- without one. Null for a provider with no place (comes-to-you, delivery-only).
--
-- GRANTS — NONE, ON PURPOSE, AND NO REVOKE EITHER. service_providers is
-- granted column by column (no table-level SELECT/INSERT/UPDATE for anon or
-- authenticated), so a new column carries no browser privilege. That is the
-- decision: the listing data is read with the service role
-- (lib/experiencesData.ts), and only the server writes it. Recorded in
-- tests/select-grant-decision-guard.test.ts and
-- tests/provider-writable-columns-guard.test.ts.
--
-- Do NOT add `revoke select, insert, update ("venue_lat", "venue_lng") …`. A
-- column list binds only to the privilege written immediately before it, so
-- that revokes SELECT and INSERT on the WHOLE TABLE — every column grant with
-- them. A first draft of this file did exactly that on TEST (5 Oct 2026); the
-- grants were restored from production's, column for column. Written per
-- privilege it would be correct, and a no-op.

alter table "public"."service_providers"
    add column if not exists "venue_lat" numeric,
    add column if not exists "venue_lng" numeric;

comment on column "public"."service_providers"."venue_lat" is
    'venue latitude for the public map, rounded to ~110m (3dp); server-written from the collection postcode (lib/venuePoint.ts)';
comment on column "public"."service_providers"."venue_lng" is
    'venue longitude for the public map, rounded to ~110m (3dp); server-written from the collection postcode (lib/venuePoint.ts)';

notify pgrst, 'reload schema';

-- Read back:
--   select count(*) = 2 from information_schema.columns
--    where table_schema='public' and table_name='service_providers' and column_name in ('venue_lat','venue_lng');
--     -- true
--   select count(*) = 0 from information_schema.column_privileges
--    where table_name='service_providers' and column_name in ('venue_lat','venue_lng') and grantee in ('anon','authenticated');
--     -- true
