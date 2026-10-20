-- A display order for the public grids, set by the admin "Arrange listings" tool.
--
-- WHAT IT IS. One nullable integer per row — `display_order` — on `listings` and
-- `service_providers`. Lower sorts earlier. The admin drag-and-drop page writes a
-- contiguous 1..N sequence over the published listings (and the approved,
-- displayable experiences); a row that has never been placed stays NULL and sorts
-- to the BOTTOM, after everything with a number. Every public grid orders the
-- same way — `display_order asc nulls last`, then the page's existing tie-break
-- (created_at desc for cottages, photo-first-then-name for experiences) — so the
-- arrange page is the single source of truth and a new listing lands at the end
-- until the owner moves it. lib/listingOrder.ts is the one place that order lives.
--
-- WHO MAY WRITE IT. Only the admin arrange route (app/api/admin/arrange), which
-- checks profiles.is_admin and writes with the service role. No browser role is
-- granted INSERT/UPDATE on it: it is PLATFORM_ONLY on both tables
-- (listings-writable-columns-guard, provider-writable-columns-guard). listings
-- carries a table-level INSERT grant to anon/authenticated (addhome drafts), but
-- RLS limits that to the writer's own draft row, publishing needs admin approval,
-- and the arrange tool rewrites the sequence regardless — a draft cannot jump the
-- published grid. UPDATE for authenticated is a column allow-list that this does
-- not join, so no host can reorder.
--
-- WHO MAY READ IT. The cottage grids (home page and the area pages) read listings
-- through the ANON/authenticated Supabase client, and ordering by a column needs
-- SELECT on it, so `display_order` is granted SELECT to anon and authenticated on
-- `listings` (it is not sensitive — a position in a list). It is also named in
-- those pages' select lists, so public-page-anon-grants-guard checks the grant.
-- The experiences grid reads service_providers through the SERVICE ROLE
-- (lib/experiencesData), which is not subject to column grants, so
-- `service_providers.display_order` is granted to no browser role and stays
-- server-only (select-grant-decision-guard REVOKED).
--
-- PRE-FLIGHT: none. Two additive nullable columns plus pure additional grants;
-- loses no data; --destructive is not required and must never be used.

alter table public.listings add column if not exists display_order integer;
alter table public.service_providers add column if not exists display_order integer;

-- listings: readable by the public grids (needed to ORDER BY it as anon), never
-- browser-writable (set only by the admin arrange route via the service role).
grant select (display_order) on public.listings to anon, authenticated;

-- service_providers: no browser grant at all. The experiences grid reads it with
-- the service role; the admin route writes it with the service role.

notify pgrst, 'reload schema';

-- Read back:
--   select
--     (select count(*) from information_schema.columns
--       where table_schema='public' and table_name='listings' and column_name='display_order') as listings_col,
--     (select count(*) from information_schema.columns
--       where table_schema='public' and table_name='service_providers' and column_name='display_order') as providers_col,
--     (select count(*) from information_schema.column_privileges
--       where table_name='listings' and column_name='display_order'
--         and privilege_type='SELECT' and grantee in ('anon','authenticated')) as listings_select_grantees;
--   -- expected: listings_col=1, providers_col=1, listings_select_grantees=2.
