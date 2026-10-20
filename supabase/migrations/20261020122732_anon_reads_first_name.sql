-- A logged-out visitor may read profiles.first_name — the public-safe name.
--
-- WHAT IS WRONG WITHOUT IT. first_name is the one part of a person's name the
-- site shows in public ("Hosted by Callum"): profiles-anon-name-privacy-guard
-- forbids anon on full_name/preferred_name/show_full_name/last_name but
-- deliberately leaves first_name OUT, because a first name being anon-readable
-- is allowed, not a leak. But 20261019153817_profiles_first_and_last_name.sql
-- granted SELECT on first_name to `authenticated` ONLY — never to anon.
--
-- So the grant does not match the decision. Today every public page that shows a
-- host's first name reads it through the SERVICE ROLE (adminClient), which is not
-- subject to column grants, so nothing 404s yet. But the public-page anon-grants
-- guard treats first_name as anon-readable, and the moment any public page embeds
-- it with the anon client — host:profiles(first_name), exactly the shape that
-- guard's parser test uses — PostgREST would refuse the whole row and the page
-- would 404 for logged-out visitors. That is the #426 failure
-- (20261019142600_anon_reads_cancellation_custom_days.sql), waiting to happen.
--
-- This grants first_name to anon so the grant matches the public-safe decision.
-- It is the SAME fix #426 made for listings.cancellation_custom_days: a pure
-- additional column grant, plus a schema reload so the live API picks it up at
-- once.
--
-- NEVER last_name. A surname is not public (profiles-anon-name-privacy-guard).
-- This touches first_name and nothing else.
--
-- Forward migration, not an edit of 20261019153817 — that one is already applied
-- to production and must not be rewritten under it (Correct migrations forward).
--
-- PRE-FLIGHT: none. A pure additional grant; loses no data; --destructive is not
-- required and must never be used.

grant select (first_name) on public.profiles to anon;

notify pgrst, 'reload schema';

-- Read back:
--   select grantee from information_schema.column_privileges
--    where table_name='profiles' and column_name='first_name'
--      and privilege_type='SELECT' and grantee in ('anon','authenticated')
--    order by grantee;
--   -- expected: anon AND authenticated.
--   select grantee from information_schema.column_privileges
--    where table_name='profiles' and column_name='last_name'
--      and privilege_type='SELECT' and grantee='anon';
--   -- expected: no rows (last_name is never anon-readable).
