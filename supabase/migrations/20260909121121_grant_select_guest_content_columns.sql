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
-- A sweep of every column added since the allow-list switch found the gap is
-- wider: the provider sign-up wizard's own-provider load reads several columns
-- the `authenticated` role can't select. Each one below is granted because the
-- signed-in OWNER reads it to repopulate their form (RLS still limits WHICH
-- rows). It is NOT a blanket grant of every ungranted column — audit fields
-- (category_assigned_at/by), the service-role-only booking fields
-- (cancellation_window_hours, exclusive_per_date), and unread legacy fields
-- (experience_price) stay revoked, and based_line / provider_name were dropped
-- from the wizard's select rather than granted because it never used them.
--
--   declarations, guest_details  — the content answers, restored for editing
--   custom_label                 — reverse-maps the chosen category on reopen
--   dietary_note                 — the dietary note, restored
--   headshot                     — the provider's photo, restored
--   shape                        — the booking shape, drives the per-shape fields
--   lead_time_days               — made-to-order notice, restored
--   slot_length_minutes,
--   slot_capacity                — the slot's length and size, restored

grant
    select (declarations),
    select (guest_details),
    select (custom_label),
    select (dietary_note),
    select (headshot),
    select (shape),
    select (lead_time_days),
    select (slot_length_minutes),
    select (slot_capacity)
    on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';

-- Read back (both columns selectable by authenticated):
--   select column_name from information_schema.column_privileges
--    where table_name = 'service_providers' and grantee = 'authenticated'
--      and privilege_type = 'SELECT'
--      and column_name in ('declarations','guest_details');
