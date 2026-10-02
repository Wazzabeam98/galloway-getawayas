-- Revoke SELECT on service_providers.commission_rate and .settlement from the
-- browser roles (anon, authenticated).
--
-- WHY. These two columns sit in the service_providers SELECT allow-list granted
-- to anon and authenticated (20260828202340_contact_details_are_not_public.sql).
-- commission_rate is the platform's per-provider cut (e.g. 0.10) and settlement
-- is the payout-settlement mode — both commercial, neither guest-facing. Anyone
-- holding the public anon key can read them for every provider. That breaks the
-- house rule ("money columns are revoked from authenticated") and is inconsistent
-- with the twin table: listings.commission_rate was deliberately kept OUT of the
-- browser SELECT allow-list for exactly this reason (20260903154419), and
-- service_providers was never brought into line. Found in the 2026-09-13 audit;
-- proven live on production before this ran.
--
-- WHAT READS THEM, CHECKED FIRST. Nothing legitimate breaks:
--   - settlement: no reader anywhere in lib/ or app/. Dormant column.
--   - commission_rate on service_providers: read only by the two service-role
--     routes that price an order — app/api/services/order/route.ts and
--     app/api/services/slots/book/route.ts, both via adminClient() (the service
--     role, which bypasses column grants). commissionRateFor() (lib/serviceProviders)
--     runs only inside those server routes. The sign-up wizard reads neither
--     column. The many other service_providers reads do not select these columns.
-- So the service role keeps its access; only the browser roles lose a read they
-- never legitimately used.
--
-- SCOPE. SELECT only, and only these two columns; every other granted column is
-- left exactly as it was. service_role is untouched, so the pricing routes keep
-- working. Additive-safe and reversible (re-grant to undo).
--
-- PRE-FLIGHT. None — a REVOKE loses no data. Runs cleanly and is safe to run
-- twice (revoking an absent grant is a no-op).

revoke select ("commission_rate", "settlement")
    on table "public"."service_providers"
    from "anon", "authenticated";

-- PostgREST caches the schema and grants; without this the columns stay readable
-- over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand):
--   -- neither column is SELECTable by the browser roles any more (expect 0 rows):
--   select grantee, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='service_providers'
--      and grantee in ('anon','authenticated')
--      and column_name in ('commission_rate','settlement');
--   -- the service role still can (expect commission_rate + settlement):
--   select column_name from information_schema.column_privileges
--    where table_schema='public' and table_name='service_providers'
--      and grantee='service_role' and privilege_type='SELECT'
--      and column_name in ('commission_rate','settlement') order by 1;
