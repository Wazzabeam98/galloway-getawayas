-- HOTFIX. The listing page 404'd for logged-out visitors.
--
-- 20261019113000 added listings.cancellation_custom_days and granted SELECT on
-- it to `authenticated` only. But the public listing page
-- (app/homes/[id]/page.tsx) selects LISTING_PAGE_COLUMNS — which now includes
-- cancellation_custom_days — with the ANON client for a logged-out visitor. A
-- column-level SELECT the anon role lacks makes PostgREST refuse the whole read,
-- so `readable` came back null and the page fell through to notFound(). Every
-- listing page was a 404 for anyone not signed in.
--
-- cancellation_custom_days is public by design: the host's number of days is
-- shown on the listing before booking, exactly like cancellation_policy, which
-- was granted to BOTH anon and authenticated. This grants the companion column
-- to anon too, matching cancellation_policy.
--
-- Forward migration, not an edit of 20261019113000 — that one is already applied
-- to production and must not be rewritten under it (Correct migrations forward).
--
-- PRE-FLIGHT: none. A pure additional grant; loses no data; --destructive is not
-- required and must never be used. The pgrst reload makes it take effect on the
-- live API at once, so the listing pages recover without a deploy.

grant select (cancellation_custom_days) on public.listings to anon;

notify pgrst, 'reload schema';

-- Read back:
--   select grantee from information_schema.column_privileges
--    where table_name='listings' and column_name='cancellation_custom_days'
--      and privilege_type='SELECT' and grantee in ('anon','authenticated')
--    order by grantee;
--   -- expected: anon AND authenticated.
