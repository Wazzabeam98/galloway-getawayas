-- Grant SELECT on the guest-content columns to signed-in users.
--
-- service_providers switched to column-level SELECT grants in
-- 20260828202340_contact_details_are_not_public.sql (revoke the table, grant an
-- allow-list of columns). Two later migrations added columns but never added
-- them to that allow-list:
--   - declarations   (20260905151351) — no grant at all
--   - guest_details  (20260906143712) — insert/update granted, SELECT missing
--
-- So a browser (the `authenticated` role) reading either column gets a 403.
-- The provider sign-up wizard's own-provider load selects both, to restore a
-- returning applicant's answers — it was 403ing, and (until the load now checks
-- its error) silently rendering a BLANK new-application form over a real record.
-- The public listing was unaffected because it reads via the service role,
-- which bypasses grants.
--
-- Grant SELECT so a signed-in provider can read their own row (RLS still limits
-- WHICH rows). Both are listing content — a professional title, qualifications,
-- what-happens, dietary, the confirmed declarations — not secrets; the service
-- role already reads them for the shop.

grant select (declarations), select (guest_details)
    on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';

-- Read back (both columns selectable by authenticated):
--   select column_name from information_schema.column_privileges
--    where table_name = 'service_providers' and grantee = 'authenticated'
--      and privilege_type = 'SELECT'
--      and column_name in ('declarations','guest_details');
