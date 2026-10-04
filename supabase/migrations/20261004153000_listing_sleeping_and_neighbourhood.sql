-- Airbnb-style listing upgrades: per-room sleeping arrangements and a
-- host-written neighbourhood description.
--
-- Two new PUBLIC columns on listings:
--   sleeping_arrangements  jsonb  — the beds in each room, room by room, the way
--                                   Airbnb's "Where you'll sleep" shows them. The
--                                   flat `beds`/`bedrooms` integers stay in sync,
--                                   derived from this by the editor, so the cards,
--                                   search and schema.org keep reading them.
--   neighbourhood          text   — the host's "Where you'll be" prose under the
--                                   map. Distinct from `nearby` (a list of points)
--                                   and from `description` (the place itself).
--
-- Both are host-written but ONLY through /api/listings/save (service role),
-- never a direct browser UPDATE — so they are granted SELECT (public content on
-- the listing page) and NOT UPDATE, and are classified PLATFORM_ONLY in
-- tests/listings-writable-columns-guard.test.ts with that reason, exactly like
-- cleaning_fee / nearby / damage_deposit before them.

alter table "public"."listings"
    add column if not exists "sleeping_arrangements" jsonb not null default '[]'::jsonb;

alter table "public"."listings"
    add column if not exists "neighbourhood" text;

-- A ceiling on the prose, the way host_bio is capped — generous, but bounded so
-- a paste cannot run to unbounded length.
alter table "public"."listings"
    drop constraint if exists "listings_neighbourhood_len";
alter table "public"."listings"
    add constraint "listings_neighbourhood_len"
    check (neighbourhood is null or char_length(neighbourhood) <= 2000);

-- Public content: both browser roles read them on the listing page. Additive to
-- the existing column allow-lists (anon in 20260828224500, authenticated in
-- 20260903154419) — the two columns join the list, nothing else changes.
grant select ("sleeping_arrangements", "neighbourhood") on "public"."listings" to "anon";
grant select ("sleeping_arrangements", "neighbourhood") on "public"."listings" to "authenticated";

-- Deliberately NOT granted UPDATE to either browser role: the editor writes them
-- through /api/listings/save, which runs as the service role. A direct browser
-- UPDATE of them stays refused, as with every other service-route-written column.

-- listing_private is `select l.*`, which Postgres froze to the columns that
-- existed when it was last created — so the two new columns are invisible to the
-- owner's editor until the view is recreated. Recreate it (same body) so l.*
-- picks them up, and re-apply the read-only grant (the browser-views write trap,
-- 20260903011803).
create or replace view "public"."listing_private" as
    select l.*
      from "public"."listings" l
     where l."host_id" = auth.uid()
        or exists (
            select 1 from "public"."listing_access" la
             where la."listing_id" = l."id"
               and la."user_id" = auth.uid()
               and la."status" = 'active'
        );

revoke all on "public"."listing_private" from "anon", "authenticated";
grant select on "public"."listing_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."listing_private" from "authenticated", "anon";

-- PostgREST caches the schema; nudge it so the new columns and the recreated
-- view are reachable over the API the moment this lands.
notify pgrst, 'reload schema';

-- Read back:
--   select column_name from information_schema.role_column_grants
--    where table_name='listings' and grantee='anon' and privilege_type='SELECT'
--      and column_name in ('sleeping_arrangements','neighbourhood');
--   -- expected: both rows
--   select grantee, privilege_type from information_schema.role_column_grants
--    where table_name='listings' and privilege_type='UPDATE'
--      and column_name in ('sleeping_arrangements','neighbourhood');
--   -- expected: no rows (no browser UPDATE on either)
